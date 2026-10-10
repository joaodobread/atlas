import type { GithubCommit, GithubPull, GithubRepoDetails, GithubRepoInfo, GithubTreeEntry, IGithubClient } from '../../server/infra/github/IGithubClient.ts';
import type { ILlmProvider, JsonOutputSpec, LlmRequest } from '../../server/infra/llm/ILlmProvider.ts';
import type { RepoFacts } from '../../shared/types.ts';

/** Cliente do GitHub em memória: árvore + arquivos, com hooks para simular falhas. */
export class FakeGithubClient implements IGithubClient {
  files = new Map<string, string>();
  /** Entradas extras da árvore sem conteúdo (só tamanho). */
  extraTree: GithubTreeEntry[] = [];
  repos: GithubRepoInfo[] = [];
  details: GithubRepoDetails | Error = { topics: [], secretScanning: null };
  rules: string[] | Error = [];
  sha = 'a'.repeat(40);
  login = 'me';
  failFiles = new Set<string>();
  closedPulls: GithubPull[] | Error = [];
  openPulls: GithubPull[] | Error = [];
  approverMap = new Map<number, string[]>();
  reviewCounts = new Map<number, number>();
  commitList: GithubCommit[] | Error = [];
  commitPulls = new Map<string, number>();
  fileReads: string[] = [];
  headShaError: Error | null = null;

  constructor(files: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(files)) this.files.set(k, v);
  }

  async viewer(_token: string): Promise<string> {
    return this.login;
  }
  async listRepos(_owner: string, _token: string): Promise<GithubRepoInfo[]> {
    return this.repos;
  }
  async headSha(_o: string, _r: string, _b: string, _t: string): Promise<string> {
    if (this.headShaError) throw this.headShaError;
    return this.sha;
  }
  async tree(_o: string, _r: string, _s: string, _t: string): Promise<GithubTreeEntry[]> {
    const blobs: GithubTreeEntry[] = [...this.files.entries()].map(([path, text]) => ({ path, type: 'blob', size: text.length }));
    return [{ path: 'src', type: 'tree', size: 0 }, ...blobs, ...this.extraTree];
  }
  async file(_o: string, _r: string, _s: string, path: string, _t: string): Promise<string | null> {
    this.fileReads.push(path);
    if (this.failFiles.has(path)) throw new Error(`falha ao ler ${path}`);
    return this.files.get(path) ?? null;
  }
  async repoDetails(_o: string, _r: string, _t: string): Promise<GithubRepoDetails> {
    if (this.details instanceof Error) throw this.details;
    return this.details;
  }
  async branchRules(_o: string, _r: string, _b: string, _t: string): Promise<string[]> {
    if (this.rules instanceof Error) throw this.rules;
    return this.rules;
  }
  async pulls(_o: string, _r: string, state: 'open' | 'closed', _max: number, _t: string): Promise<GithubPull[]> {
    const list = state === 'open' ? this.openPulls : this.closedPulls;
    if (list instanceof Error) throw list;
    return list;
  }
  async approvers(_o: string, _r: string, pull: number, _t: string): Promise<string[]> {
    return this.approverMap.get(pull) ?? [];
  }
  async reviewCount(_o: string, _r: string, pull: number, _t: string): Promise<number> {
    return this.reviewCounts.get(pull) ?? 0;
  }
  async commits(_o: string, _r: string, _b: string, _since: string, _max: number, _t: string): Promise<GithubCommit[]> {
    if (this.commitList instanceof Error) throw this.commitList;
    return this.commitList;
  }
  async commitPullCount(_o: string, _r: string, sha: string, _t: string): Promise<number> {
    return this.commitPulls.get(sha) ?? 0;
  }
}

/** LLM falso: devolve as respostas da fila (ou lança o erro). */
export class FakeLlm implements ILlmProvider {
  readonly provider = 'anthropic' as const;
  readonly model = 'fake';
  requests: LlmRequest[] = [];
  specs: string[] = [];
  constructor(
    public configured: boolean,
    private readonly responses: Array<unknown> = [],
  ) {}

  async complete(_request: LlmRequest): Promise<string> {
    return '';
  }

  async completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    this.requests.push(request);
    this.specs.push(spec.name);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'string') throw next as unknown as Error;
    return spec.parse(next);
  }
}

/** Fatos neutros de um repositório; sobrescreva o necessário. */
export function makeFacts(over: Partial<RepoFacts> = {}): RepoFacts {
  return {
    languages: ['TypeScript'],
    manifests: ['package.json'],
    frameworks: [],
    runtime: null,
    deploy: [],
    workflows: [],
    envVars: [],
    resources: [],
    hosts: [],
    testFiles: 0,
    e2e: false,
    lockfiles: [],
    updateAutomation: null,
    lintConfig: [],
    hasCodeowners: false,
    readmeChars: 0,
    hasChangelog: false,
    committedEnvFiles: [],
    dependencies: [],
    appType: 'service',
    workflowAudit: {
      files: 0,
      dangerousTriggers: [],
      writeAll: [],
      missingPermissions: [],
      unpinnedActions: [],
      sastTools: [],
      secretScanTools: [],
      sendsMetrics: false,
    },
    binaryFiles: [],
    docFiles: { security: false, agents: false, envExample: false, contributing: false },
    dataStores: [],
    realDependencyHarness: null,
    github: { topics: null, secretScanning: null, branchRules: null },
    intel: { vulnerabilities: null, freshness: null, runtimeSupport: null },
    ...over,
  };
}
