import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AppConfig } from '../../server/config/AppConfig.ts';
import { buildContainer } from '../../server/composition/buildContainer.ts';
import type { Container } from '../../server/di/Container.ts';
import { TOKENS } from '../../server/di/tokens.ts';
import type { EmbeddingKind, IEmbeddingProvider } from '../../server/infra/embeddings/IEmbeddingProvider.ts';
import type { GithubCommit, GithubPull, GithubRepoDetails, GithubRepoInfo, GithubTreeEntry, IGithubClient } from '../../server/infra/github/IGithubClient.ts';
import type { Dependency, FreshnessResult, IPackageIntel, RuntimeSupport, VulnerabilityResult } from '../../server/infra/packages/IPackageIntel.ts';
import { MemoryObjectStorage } from './MemoryObjectStorage.ts';
import { resetDatabase, testDatabase, TEST_DATABASE_URL } from './database.ts';

/** Embeddings determinísticos (hash das palavras → vetor normalizado de 384 dimensões). */
export class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly model = 'fake-e5';
  readonly dimensions = 384;
  readonly state = 'ready' as const;
  readonly lastError: string | null = null;

  async embed(texts: readonly string[], _kind: EmbeddingKind): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dimensions);
      for (const word of t.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % this.dimensions]! += 1;
      }
      v[0]! += 0.01;
      const norm = Math.hypot(...v);
      return v.map((x) => x / norm);
    });
  }
}

/** GitHub sem rede: dois repositórios pequenos (um com package.json). */
export class FakeGithubClient implements IGithubClient {
  failViewer = false;
  readonly repos: GithubRepoInfo[] = [
    {
      name: 'api-pagamentos',
      description: 'API de pagamentos',
      defaultBranch: 'main',
      language: 'TypeScript',
      archived: false,
      fork: false,
      pushedAt: new Date().toISOString(),
      htmlUrl: 'https://github.com/acme/api-pagamentos',
    },
    {
      name: 'antigo',
      description: null,
      defaultBranch: 'main',
      language: null,
      archived: true,
      fork: false,
      pushedAt: new Date().toISOString(),
      htmlUrl: 'https://github.com/acme/antigo',
    },
  ];

  async viewer(_token: string): Promise<string> {
    if (this.failViewer) throw new Error('Bad credentials');
    return 'acme-bot';
  }
  async listRepos(_owner: string, _token: string): Promise<GithubRepoInfo[]> {
    return this.repos;
  }
  async headSha(): Promise<string> {
    return 'abc1234def';
  }
  async tree(): Promise<GithubTreeEntry[]> {
    return [
      { path: 'package.json', type: 'blob', size: 120 },
      { path: 'README.md', type: 'blob', size: 40 },
      { path: 'src/index.ts', type: 'blob', size: 60 },
    ];
  }
  async file(_owner: string, _repo: string, _sha: string, p: string): Promise<string | null> {
    if (p === 'package.json') return JSON.stringify({ name: 'api-pagamentos', dependencies: { pg: '^8.0.0', express: '^4.0.0' } });
    if (p === 'README.md') return '# API de pagamentos\nRecebe pagamentos.';
    if (p === 'src/index.ts') return "import express from 'express';\nfetch('https://api.payflow.example/v1/charges');\n";
    return null;
  }
  async repoDetails(): Promise<GithubRepoDetails> {
    return { topics: ['payments'], secretScanning: null };
  }
  async branchRules(): Promise<string[]> {
    return [];
  }
  async pulls(): Promise<GithubPull[]> {
    return [];
  }
  async approvers(): Promise<string[]> {
    return [];
  }
  async reviewCount(): Promise<number> {
    return 0;
  }
  async commits(): Promise<GithubCommit[]> {
    return [];
  }
  async commitPullCount(): Promise<number> {
    return 0;
  }
}

export class FakePackageIntel implements IPackageIntel {
  async vulnerabilities(_deps: readonly Dependency[]): Promise<VulnerabilityResult> {
    return { affected: [] };
  }
  async freshness(deps: readonly Dependency[]): Promise<FreshnessResult> {
    return { averageLibyears: 0, measured: deps.length, outdated: 0 };
  }
  async runtimeSupport(): Promise<RuntimeSupport | null> {
    return null;
  }
}

export interface ApiResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

export interface RequestOptions {
  /** false = não envia o header anti-CSRF. */
  csrf?: boolean;
  /** Corpo bruto (sem JSON.stringify). */
  raw?: string;
  headers?: Record<string, string>;
}

/** Cliente HTTP com "pote" de cookies próprio (cada instância é um navegador). */
export class ApiClient {
  cookie: string | null = null;
  bearer: string | null = null;

  constructor(readonly baseUrl: string) {}

  async request<T = unknown>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...opts.headers };
    if (body !== undefined || opts.raw !== undefined) headers['content-type'] = 'application/json';
    if (opts.csrf !== false) headers['x-requested-with'] = 'comm-graph';
    if (this.cookie) headers.cookie = this.cookie;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await fetch(this.baseUrl + url, { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const i = pair.indexOf('=');
      if (pair.slice(0, i) === 'cg_session') {
        const value = pair.slice(i + 1);
        this.cookie = value ? `cg_session=${value}` : null;
      }
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, headers: res.headers, body: parsed as T };
  }

  get<T = unknown>(url: string, opts?: RequestOptions) {
    return this.request<T>('GET', url, undefined, opts);
  }
  post<T = unknown>(url: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', url, body, opts);
  }
  put<T = unknown>(url: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', url, body, opts);
  }
  patch<T = unknown>(url: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', url, body, opts);
  }
  delete<T = unknown>(url: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', url, undefined, opts);
  }
}

export async function freePort(): Promise<number> {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

export interface TestApp {
  container: Container;
  server: Server;
  baseUrl: string;
  storage: MemoryObjectStorage;
  github: FakeGithubClient;
  staticDir: string;
  config: AppConfig;
  close(): Promise<void>;
}

/** Container real (Postgres de teste) com storage, embeddings, GitHub e fontes públicas falsos; servidor numa porta livre. */
export async function startTestApp(): Promise<TestApp> {
  const db = await testDatabase();
  await resetDatabase(db);
  const port = await freePort();
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-web-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Comm Graph</title>');
  const base = AppConfig.fromEnv(
    {
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: TEST_DATABASE_URL,
      APP_SECRET: 'segredo-de-teste-com-32-caracteres!!',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
    },
    '__no_env_file__',
  );
  const config = Object.assign(Object.create(AppConfig.prototype) as AppConfig, base, { staticDir });

  const container = buildContainer(config);
  const storage = new MemoryObjectStorage();
  const github = new FakeGithubClient();
  container.value(TOKENS.Config, config);
  container.value(TOKENS.Database, db);
  container.value(TOKENS.ObjectStorage, storage);
  container.value(TOKENS.EmbeddingProvider, new FakeEmbeddingProvider());
  container.value(TOKENS.GithubClient, github);
  container.value(TOKENS.PackageIntel, new FakePackageIntel());

  const server = container.resolve(TOKENS.HttpServer).start();
  if (!server.listening) await once(server, 'listening');
  return {
    container,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    storage,
    github,
    staticDir,
    config,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(staticDir, { recursive: true, force: true });
    },
  };
}
