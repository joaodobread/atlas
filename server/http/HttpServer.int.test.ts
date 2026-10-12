import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ApiTokenView,
  AuthStatus,
  CallSite,
  Connection,
  CreatedApiToken,
  DocumentDetail,
  DocumentSummary,
  GithubSettingsView,
  GithubTestResult,
  GraphData,
  GraphInfo,
  GraphNode,
  ImportResult,
  IndexStatus,
  IntrospectionRunState,
  LlmInfo,
  LlmSettingsView,
  LlmTestResult,
  NodeInterface,
  NodeMention,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
  RepoMetricsSnapshot,
  SearchResult,
  SecurityPortfolioView,
  SecurityReportRecord,
  SecurityRepoView,
  User,
  WatchedFolder,
} from '../../shared/types.ts';
import type { ExchangeDocument } from '../../shared/schemas.ts';
import { ApiClient, freePort, startTestApp, type TestApp } from '../../test/support/HttpHarness.ts';
import { TOKENS } from '../di/tokens.ts';
import type { PostgresDatabase } from '../infra/database/PostgresDatabase.ts';
import { HttpServer } from './HttpServer.ts';

interface ErrorBody {
  error: string;
  issues?: Array<{ path: string; message: string }>;
}

const ADMIN = { name: 'Admin', email: 'admin@acme.dev', password: 'senha-forte-1' };

let app: TestApp;
let admin: ApiClient;
let anon: ApiClient;

const until = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('tempo esgotado esperando condição');
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Espera a fila de embeddings esvaziar (o indexador roda em segundo plano após cada upsert). */
const indexIdle = () =>
  until(async () => {
    const s = await admin.get<IndexStatus>('/api/index-status');
    return s.body.embeddingState === 'idle' && s.body.pending === 0;
  });

beforeAll(async () => {
  app = await startTestApp();
  admin = new ApiClient(app.baseUrl);
  anon = new ApiClient(app.baseUrl);
});

afterAll(async () => {
  // Deixa terminar o trabalho em segundo plano (indexação, menções) antes de fechar o banco.
  await indexIdle().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 200));
  await app.close();
});

describe('infra HTTP', () => {
  it('health responde ok sem login e com cabeçalhos de segurança', async () => {
    const res = await anon.get<{ status: string }>('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain('img-src');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('health responde 503 quando o banco está indisponível', async () => {
    const port = await freePort();
    const config = Object.assign(Object.create(Object.getPrototypeOf(app.config) as object) as typeof app.config, app.config, {
      port,
      staticDir: path.join(app.staticDir, 'nao-existe'),
    });
    const brokenDb = { get: () => Promise.reject(new Error('down')) } as unknown as PostgresDatabase;
    const server: Server = new HttpServer(
      config,
      app.container,
      app.container.resolve(TOKENS.ErrorHandler),
      app.container.resolve(TOKENS.AuthMiddleware),
      brokenDb,
    ).start();
    if (!server.listening) await once(server, 'listening');
    try {
      const res = await new ApiClient(`http://127.0.0.1:${port}`).get<{ status: string }>('/api/health');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: 'db-unavailable' });
      // Sem pasta do front: rotas fora da API caem no 404 do Express.
      expect((await fetch(`http://127.0.0.1:${port}/qualquer`)).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('serve o front compilado e devolve o index.html para rotas do SPA', async () => {
    const index = await fetch(`${app.baseUrl}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Comm Graph');
    const deep = await fetch(`${app.baseUrl}/grafos/1/algum-no`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('Comm Graph');
  });

  it('rota de API inexistente não cai no SPA', async () => {
    const res = await fetch(`${app.baseUrl}/api/nao-existe`);
    expect(res.status).toBe(404);
  });
});

describe('autenticação', () => {
  it('status indica que precisa de configuração inicial', async () => {
    const res = await anon.get<AuthStatus>('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsSetup: true, user: null, permissions: [] });
  });

  it('rotas protegidas exigem login (401)', async () => {
    const res = await anon.get<ErrorBody>('/api/graphs');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Faça login para continuar');
  });

  it('mutação sem o header anti-CSRF é barrada (403)', async () => {
    const res = await anon.post<ErrorBody>('/api/auth/setup', ADMIN, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('CSRF');
  });

  it('setup valida a entrada com zod (400)', async () => {
    const res = await anon.post<ErrorBody>('/api/auth/setup', { name: '', email: 'x', password: '1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Dados inválidos');
    expect(res.body.issues?.map((i) => i.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('JSON malformado vira 400', async () => {
    const res = await anon.post<ErrorBody>('/api/auth/login', undefined, { raw: '{"email":' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON inválido');
  });

  it('setup cria o primeiro administrador e abre a sessão via cookie', async () => {
    const res = await admin.post<AuthStatus>('/api/auth/setup', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.needsSetup).toBe(false);
    expect(res.body.user?.role).toBe('admin');
    const setCookie = res.headers.getSetCookie()[0]!;
    expect(setCookie).toMatch(/^cg_session=cgs/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(admin.cookie).not.toBeNull();

    const status = await admin.get<AuthStatus>('/api/auth/status');
    expect(status.body.user?.email).toBe(ADMIN.email);
    expect(status.body.permissions).toContain('users:manage');
  });

  it('setup repetido é regra de negócio (422)', async () => {
    const res = await anon.post<ErrorBody>('/api/auth/setup', { ...ADMIN, email: 'outro@acme.dev' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('O sistema já foi configurado');
  });

  it('login com senha errada devolve 401; com a certa, abre sessão', async () => {
    const browser = new ApiClient(app.baseUrl);
    const wrong = await browser.post<ErrorBody>('/api/auth/login', { email: ADMIN.email, password: 'errada' });
    expect(wrong.status).toBe(401);
    const ok = await browser.post<AuthStatus>('/api/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    expect(ok.status).toBe(200);
    expect(ok.body.user?.email).toBe(ADMIN.email);
    expect(browser.cookie).not.toBeNull();
    expect((await browser.get('/api/graphs')).status).toBe(200);
  });

  it('logout apaga o cookie e invalida a sessão', async () => {
    const browser = new ApiClient(app.baseUrl);
    await browser.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
    const session = browser.cookie;
    const res = await browser.post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toMatch(/^cg_session=;/);
    expect(browser.cookie).toBeNull();
    browser.cookie = session;
    expect((await browser.get('/api/graphs')).status).toBe(401);
  });

  it('logout sem sessão também responde 204', async () => {
    expect((await new ApiClient(app.baseUrl).post('/api/auth/logout')).status).toBe(204);
  });

  it('cookie malformado é ignorado', async () => {
    const res = await anon.get<AuthStatus>('/api/auth/status', { headers: { cookie: 'cg_session=%E0%A4%A; =x; lixo' } });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('onboarding marca e desmarca o tutorial', async () => {
    const done = await admin.post<AuthStatus>('/api/auth/onboarding', { done: true });
    expect(done.status).toBe(200);
    expect(done.body.user?.onboarded_at).not.toBeNull();
    const again = await admin.post<AuthStatus>('/api/auth/onboarding', { done: false });
    expect(again.body.user?.onboarded_at).toBeNull();
    expect((await admin.post('/api/auth/onboarding', { done: 'sim' })).status).toBe(400);
  });

  it('troca de senha valida a atual e permite login com a nova', async () => {
    const wrong = await admin.post<ErrorBody>('/api/auth/password', { currentPassword: 'nada', newPassword: 'nova-senha-123' });
    expect(wrong.status).toBe(422);
    expect((await admin.post('/api/auth/password', { currentPassword: ADMIN.password })).status).toBe(400);
    const ok = await admin.post('/api/auth/password', { currentPassword: ADMIN.password, newPassword: 'nova-senha-123' });
    expect(ok.status).toBe(204);
    const login = await new ApiClient(app.baseUrl).post('/api/auth/login', { email: ADMIN.email, password: 'nova-senha-123' });
    expect(login.status).toBe(200);
    ADMIN.password = 'nova-senha-123';
  });

  it('troca de senha exige login', async () => {
    expect((await anon.post('/api/auth/password', { currentPassword: 'a', newPassword: 'abcdefghi' })).status).toBe(401);
  });

  it('tokens de API: cria, lista, autentica por Bearer (sem CSRF) e revoga', async () => {
    const created = await admin.post<CreatedApiToken>('/api/auth/tokens', { name: 'CI' });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^cgt/);
    expect(created.body.prefix).toBe(created.body.token.slice(0, 10));

    const list = await admin.get<ApiTokenView[]>('/api/auth/tokens');
    expect(list.body.map((t) => t.name)).toEqual(['CI']);
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);

    const bot = new ApiClient(app.baseUrl);
    bot.bearer = created.body.token;
    const graph = await bot.post<GraphInfo>('/api/graphs', { name: 'Via token' }, { csrf: false });
    expect(graph.status).toBe(201);
    const status = await bot.get<AuthStatus>('/api/auth/status');
    expect(status.body.user?.email).toBe(ADMIN.email);

    expect((await admin.post('/api/auth/tokens', { name: '' })).status).toBe(400);
    expect((await admin.delete('/api/auth/tokens/abc')).status).toBe(400);
    expect((await admin.delete('/api/auth/tokens/9999')).status).toBe(404);
    expect((await admin.delete(`/api/auth/tokens/${created.body.id}`)).status).toBe(204);
    expect((await bot.get('/api/graphs')).status).toBe(401);
    expect((await admin.delete(`/api/graphs/${graph.body.id}`)).status).toBe(204);
  });

  it('Bearer inválido não autentica', async () => {
    const bot = new ApiClient(app.baseUrl);
    bot.bearer = 'cgt_invalido';
    expect((await bot.get('/api/graphs')).status).toBe(401);
  });
});

describe('usuários', () => {
  let viewer: ApiClient;
  let editor: ApiClient;
  let viewerId: number;
  let editorId: number;

  beforeAll(async () => {
    viewer = new ApiClient(app.baseUrl);
    editor = new ApiClient(app.baseUrl);
  });

  it('admin cria usuários e valida e-mail duplicado', async () => {
    const v = await admin.post<User>('/api/users', { name: 'Leitor', email: 'leitor@acme.dev', role: 'viewer', password: 'senha-leitor' });
    expect(v.status).toBe(201);
    expect(v.body).not.toHaveProperty('password_hash');
    viewerId = v.body.id;
    const e = await admin.post<User>('/api/users', { name: 'Editor', email: 'editor@acme.dev', role: 'editor', password: 'senha-editor' });
    editorId = e.body.id;
    expect((await admin.post('/api/users', { name: 'Dup', email: 'leitor@acme.dev', role: 'viewer', password: 'senha-leitor' })).status).toBe(422);
    expect((await admin.post('/api/users', { name: 'X', email: 'x@acme.dev', role: 'root', password: 'senha-leitor' })).status).toBe(400);

    const list = await admin.get<User[]>('/api/users');
    expect(list.body.map((u) => u.email).sort()).toEqual(['admin@acme.dev', 'editor@acme.dev', 'leitor@acme.dev']);
    expect((await viewer.post('/api/auth/login', { email: 'leitor@acme.dev', password: 'senha-leitor' })).status).toBe(200);
    expect((await editor.post('/api/auth/login', { email: 'editor@acme.dev', password: 'senha-editor' })).status).toBe(200);
  });

  it('leitor não escreve nem gerencia usuários (403)', async () => {
    const res = await viewer.post<ErrorBody>('/api/graphs', { name: 'Proibido' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Você não tem permissão para esta ação');
    expect((await viewer.get('/api/users')).status).toBe(403);
    expect((await viewer.post('/api/nodes', { graph_id: 1, name: 'X' })).status).toBe(403);
    expect((await viewer.get('/api/graphs')).status).toBe(200);
  });

  it('editor escreve no grafo mas não mexe em configurações', async () => {
    expect((await editor.get('/api/settings/llm')).status).toBe(403);
    expect((await editor.get('/api/users')).status).toBe(403);
    const node = await editor.post<GraphNode>('/api/nodes', { graph_id: 1, name: 'Do editor' });
    expect(node.status).toBe(201);
    expect((await editor.delete(`/api/nodes/${node.body.id}`)).status).toBe(204);
  });

  it('admin atualiza usuários respeitando as regras', async () => {
    const upd = await admin.patch<User>(`/api/users/${viewerId}`, { name: 'Leitora' });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Leitora');
    expect((await admin.patch('/api/users/9999', { name: 'X' })).status).toBe(404);
    expect((await admin.patch(`/api/users/${viewerId}`, { email: 'editor@acme.dev' })).status).toBe(422);
    expect((await admin.patch(`/api/users/${viewerId}`, { nope: 1 })).status).toBe(400);

    const me = (await admin.get<AuthStatus>('/api/auth/status')).body.user!;
    expect((await admin.patch(`/api/users/${me.id}`, { role: 'viewer' })).status).toBe(422);

    // Senha trocada pelo admin derruba as sessões abertas do usuário.
    expect((await admin.patch(`/api/users/${viewerId}`, { password: 'outra-senha-1' })).status).toBe(200);
    expect((await viewer.get('/api/graphs')).status).toBe(401);
    expect((await viewer.post('/api/auth/login', { email: 'leitor@acme.dev', password: 'outra-senha-1' })).status).toBe(200);
  });

  it('admin exclui usuários, mas não a si mesmo', async () => {
    const me = (await admin.get<AuthStatus>('/api/auth/status')).body.user!;
    expect((await admin.delete(`/api/users/${me.id}`)).status).toBe(422);
    expect((await admin.delete('/api/users/9999')).status).toBe(404);
    const temp = await admin.post<User>('/api/users', { name: 'Temp', email: 'temp@acme.dev', role: 'viewer', password: 'senha-temp1' });
    expect((await admin.delete(`/api/users/${temp.body.id}`)).status).toBe(204);
    expect(editorId).toBeGreaterThan(0);
  });
});

describe('grafos e entidades', () => {
  let nodeA: GraphNode;
  let nodeB: GraphNode;
  let iface: NodeInterface;
  let conn: Connection;
  let site: CallSite;

  it('lista, cria, renomeia, mostra e exclui grafos', async () => {
    const list = await admin.get<GraphInfo[]>('/api/graphs');
    expect(list.status).toBe(200);
    expect(list.body.map((g) => g.name)).toContain('Principal');

    const created = await admin.post<GraphInfo>('/api/graphs', { name: 'Secundário', description: 'teste' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/graphs', { name: 'Secundário' })).status).toBe(422);
    expect((await admin.post('/api/graphs', { name: '' })).status).toBe(400);

    const upd = await admin.patch<GraphInfo>(`/api/graphs/${created.body.id}`, { name: 'Renomeado' });
    expect(upd.body.name).toBe('Renomeado');
    expect((await admin.patch('/api/graphs/999', { name: 'X' })).status).toBe(404);

    const show = await admin.get<GraphData>(`/api/graphs/${created.body.id}`);
    expect(show.body).toEqual({ nodes: [], interfaces: [], connections: [], callSites: [] });
    expect((await admin.get('/api/graphs/999')).status).toBe(404);
    expect((await admin.get('/api/graphs/0')).status).toBe(400);

    expect((await admin.delete(`/api/graphs/${created.body.id}`)).status).toBe(204);
    expect((await admin.delete('/api/graphs/1')).status).toBe(422);
  });

  it('from-repos valida a entrada', async () => {
    const empty = await admin.post<ErrorBody>('/api/graphs/from-repos', { name: 'Novo', repoIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.issues?.[0]?.message).toBe('Selecione ao menos um repositório');
    expect((await admin.post('/api/graphs/from-repos', { name: 'Novo', repoIds: [999] })).status).toBe(404);
    expect((await admin.post('/api/graphs/from-repos', { name: 'Novo', repoIds: [1], depth: 'deep' })).status).toBe(400);
  });

  it('CRUD de nós', async () => {
    const a = await admin.post<GraphNode>('/api/nodes', { graph_id: 1, name: 'Checkout', kind: 'service', icon: 'lu:server', tech: 'Node' });
    expect(a.status).toBe(201);
    nodeA = a.body;
    nodeB = (await admin.post<GraphNode>('/api/nodes', { graph_id: 1, name: 'Postgres', kind: 'database' })).body;
    expect((await admin.post('/api/nodes', { graph_id: 1, name: 'X', icon: 'bad' })).status).toBe(400);
    expect((await admin.post('/api/nodes', { graph_id: 1, name: 'X', extra: true })).status).toBe(400);

    const list = await admin.get<GraphNode[]>('/api/nodes');
    expect(list.body.map((n) => n.name)).toEqual(expect.arrayContaining(['Checkout', 'Postgres']));
    expect((await admin.get<GraphNode>(`/api/nodes/${nodeA.id}`)).body.name).toBe('Checkout');
    expect((await admin.get('/api/nodes/9999')).status).toBe(404);

    const upd = await admin.patch<GraphNode>(`/api/nodes/${nodeA.id}`, { description: 'Fluxo de compra' });
    expect(upd.body.description).toBe('Fluxo de compra');
    expect((await admin.patch(`/api/nodes/${nodeA.id}`, { kind: 'banana' })).status).toBe(400);
  });

  it('CRUD de interfaces', async () => {
    const created = await admin.post<NodeInterface>('/api/interfaces', { node_id: nodeB.id, name: 'tabela pedidos', type: 'sql' });
    expect(created.status).toBe(201);
    iface = created.body;
    expect((await admin.post('/api/interfaces', { node_id: 9999, name: 'x' })).status).toBe(400);
    expect((await admin.get<NodeInterface[]>('/api/interfaces')).body).toHaveLength(1);
    expect((await admin.get<NodeInterface>(`/api/interfaces/${iface.id}`)).body.name).toBe('tabela pedidos');
    expect((await admin.patch<NodeInterface>(`/api/interfaces/${iface.id}`, { spec: 'SELECT' })).body.spec).toBe('SELECT');
  });

  it('CRUD de conexões', async () => {
    const created = await admin.post<Connection>('/api/connections', {
      source_id: nodeA.id,
      target_id: nodeB.id,
      target_interface_id: iface.id,
      protocol: 'sql',
    });
    expect(created.status).toBe(201);
    conn = created.body;
    const self = await admin.post<ErrorBody>('/api/connections', { source_id: nodeA.id, target_id: nodeA.id });
    expect(self.status).toBe(400);
    expect(self.body.issues?.[0]?.path).toBe('target_id');
    expect((await admin.get<Connection[]>('/api/connections')).body).toHaveLength(1);
    expect((await admin.get<Connection>(`/api/connections/${conn.id}`)).body.protocol).toBe('sql');
    expect((await admin.patch<Connection>(`/api/connections/${conn.id}`, { description: 'grava pedidos' })).body.description).toBe('grava pedidos');
  });

  it('CRUD de call-sites', async () => {
    const created = await admin.post<CallSite>('/api/call-sites', { connection_id: conn.id, file_path: 'src/db.ts', line: 10, symbol: 'save' });
    expect(created.status).toBe(201);
    site = created.body;
    expect((await admin.post('/api/call-sites', { connection_id: conn.id, file_path: '', line: 0 })).status).toBe(400);
    expect((await admin.get<CallSite[]>('/api/call-sites')).body).toHaveLength(1);
    expect((await admin.get<CallSite>(`/api/call-sites/${site.id}`)).body.file_path).toBe('src/db.ts');
    expect((await admin.patch<CallSite>(`/api/call-sites/${site.id}`, { notes: 'ok' })).body.notes).toBe('ok');
  });

  it('mostra o grafo com todas as entidades', async () => {
    const g = await admin.get<GraphData>('/api/graphs/1');
    expect(g.body.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['Checkout', 'Postgres']));
    expect(g.body.interfaces).toHaveLength(1);
    expect(g.body.connections).toHaveLength(1);
    expect(g.body.callSites).toHaveLength(1);
  });

  it('exporta e importa o grafo', async () => {
    const exp = await admin.get<ExchangeDocument>('/api/graphs/1/export');
    expect(exp.status).toBe(200);
    expect(exp.body.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['Checkout', 'Postgres']));
    expect(exp.body.connections).toHaveLength(1);
    expect((await admin.get('/api/graphs/999/export')).status).toBe(404);

    const target = await admin.post<GraphInfo>('/api/graphs', { name: 'Cópia' });
    const imp = await admin.post<ImportResult>(`/api/graphs/${target.body.id}/import`, exp.body);
    expect(imp.status).toBe(200);
    expect(imp.body.nodesCreated).toBe(2);
    expect(imp.body.connectionsCreated).toBe(1);
    expect(imp.body.callSitesCreated).toBe(1);
    expect((await admin.post('/api/graphs/999/import', exp.body)).status).toBe(404);
    expect((await admin.post(`/api/graphs/${target.body.id}/import`, { mode: 'tudo' })).status).toBe(400);
    expect((await admin.delete(`/api/graphs/${target.body.id}`)).status).toBe(204);
  });

  it('exclui call-site, conexão, interface e nó', async () => {
    expect((await admin.delete(`/api/call-sites/${site.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/connections/${conn.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/interfaces/${iface.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/nodes/${nodeB.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/nodes/${nodeB.id}`)).status).toBe(404);
    expect((await admin.delete('/api/nodes/abc')).status).toBe(400);
  });
});

describe('documentos, busca e pastas', () => {
  let docId: number;
  let folderDir: string;

  beforeAll(() => {
    folderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-docs-'));
    fs.writeFileSync(path.join(folderDir, 'arquitetura.md'), '# Arquitetura\n\nO Checkout grava pedidos no banco.');
    fs.mkdirSync(path.join(folderDir, 'sub'));
    fs.writeFileSync(path.join(folderDir, 'sub', 'filas.md'), '# Filas\n\nEventos de pagamento.');
  });

  afterAll(() => {
    fs.rmSync(folderDir, { recursive: true, force: true });
  });

  it('upsert cria e atualiza pelo path, guardando o original no storage', async () => {
    const created = await admin.post<{ id: number; status: string }>('/api/documents', {
      path: 'docs/checkout.md',
      content: '# Checkout\n\nO Checkout chama o gateway de pagamentos.',
    });
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('created');
    docId = created.body.id;
    expect([...app.storage.objects.keys()].some((k) => k.startsWith('private:documents/'))).toBe(true);

    const same = await admin.post<{ status: string }>('/api/documents', {
      path: 'docs/checkout.md',
      content: '# Checkout\n\nO Checkout chama o gateway de pagamentos.',
    });
    expect(same.body.status).toBe('unchanged');
    const updated = await admin.post<{ status: string }>('/api/documents', {
      path: 'docs/checkout.md',
      title: 'Checkout v2',
      content: '# Checkout\n\nO Checkout chama o gateway de pagamentos e o Postgres.',
    });
    expect(updated.body.status).toBe('updated');
    expect((await admin.post('/api/documents', { path: '', content: 'x' })).status).toBe(400);
  });

  it('importa vários documentos', async () => {
    const res = await admin.post<Array<{ status: string }>>('/api/documents/import', {
      documents: [
        { path: 'docs/a.md', content: '# A\n\nAlpha' },
        { path: 'docs/b.md', content: '# B\n\nBeta', source: 'upload' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.map((d) => d.status)).toEqual(['created', 'created']);
    expect((await admin.post('/api/documents/import', { documents: [] })).status).toBe(400);
  });

  it('lista, mostra e exclui documentos', async () => {
    const list = await admin.get<DocumentSummary[]>('/api/documents');
    expect(list.body.map((d) => d.path)).toEqual(expect.arrayContaining(['docs/checkout.md', 'docs/a.md', 'docs/b.md']));
    const show = await admin.get<DocumentDetail>(`/api/documents/${docId}`);
    expect(show.body.title).toBe('Checkout v2');
    expect(show.body.chunks.length).toBeGreaterThan(0);
    expect((await admin.get('/api/documents/9999')).status).toBe(404);

    const b = list.body.find((d) => d.path === 'docs/b.md')!;
    expect((await admin.delete(`/api/documents/${b.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/documents/${b.id}`)).status).toBe(404);
  });

  it('menções de um nó', async () => {
    const node = (await admin.get<GraphNode[]>('/api/nodes')).body.find((n) => n.name === 'Checkout')!;
    const res = await admin.get<NodeMention[]>(`/api/nodes/${node.id}/mentions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('busca textual, semântica e híbrida', async () => {
    await indexIdle();
    const text = await admin.get<SearchResult>('/api/search?q=gateway&mode=text');
    expect(text.status).toBe(200);
    expect(text.body.hits.length).toBeGreaterThan(0);
    const hybrid = await admin.get<SearchResult>('/api/search?q=gateway%20pagamentos&limit=5');
    expect(hybrid.status).toBe(200);
    const semantic = await admin.get<SearchResult>('/api/search?q=Alpha&mode=semantic');
    expect(semantic.status).toBe(200);
    expect((await admin.get<ErrorBody>('/api/search?q=')).status).toBe(400);
    expect((await admin.get('/api/search?q=x&limit=100')).status).toBe(400);
  });

  it('pergunta ao RAG sem LLM configurado', async () => {
    const res = await admin.post('/api/ask', { question: 'Quem chama o gateway?' });
    expect([200, 422]).toContain(res.status);
    expect((await admin.post('/api/ask', { question: 'x' })).status).toBe(400);
  });

  it('status do índice, info do LLM e reprocessamento de menções', async () => {
    const status = await admin.get<IndexStatus>('/api/index-status');
    expect(status.status).toBe(200);
    expect(status.body.embeddingModel).toBe('fake-e5');
    expect(status.body.llmMentions.state).toBe('disabled');
    const llm = await admin.get<LlmInfo>('/api/llm');
    expect(llm.body).toMatchObject({ configured: false, provider: 'none' });
    const re = await admin.post<IndexStatus>('/api/mentions/reprocess');
    expect(re.status).toBe(200);
    expect(re.body.llmMentions.enabled).toBe(false);
  });

  it('pastas monitoradas: adiciona, lista, reescaneia e remove', async () => {
    expect((await admin.post('/api/folders', { path: 'relativo/docs' })).status).toBe(400);
    expect((await admin.post('/api/folders', { path: path.join(folderDir, 'nao-existe') })).status).toBe(400);

    const added = await admin.post<WatchedFolder>('/api/folders', { path: folderDir });
    expect(added.status).toBe(201);
    expect(added.body.documentCount).toBe(2);
    expect((await admin.post('/api/folders', { path: folderDir })).status).toBe(422);

    const list = await admin.get<WatchedFolder[]>('/api/folders');
    expect(list.body).toHaveLength(1);

    fs.rmSync(path.join(folderDir, 'sub'), { recursive: true });
    const rescanned = await admin.post<WatchedFolder>(`/api/folders/${added.body.id}/rescan`);
    expect(rescanned.status).toBe(200);
    expect(rescanned.body.documentCount).toBe(1);
    expect((await admin.post('/api/folders/9999/rescan')).status).toBe(404);

    expect((await admin.delete(`/api/folders/${added.body.id}`)).status).toBe(204);
    expect((await admin.delete(`/api/folders/${added.body.id}`)).status).toBe(404);
  });

  it('editor não gerencia pastas', async () => {
    const editor = new ApiClient(app.baseUrl);
    await editor.post('/api/auth/login', { email: 'editor@acme.dev', password: 'senha-editor' });
    expect((await editor.post('/api/folders', { path: folderDir })).status).toBe(403);
    expect((await editor.get('/api/folders')).status).toBe(200);
  });
});

describe('configurações de LLM', () => {
  it('mostra a configuração vinda do ambiente', async () => {
    const res = await admin.get<LlmSettingsView>('/api/settings/llm');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'none', hasApiKey: false, source: 'env' });
  });

  it('valida e salva sem devolver a chave', async () => {
    const invalid = await admin.put<ErrorBody>('/api/settings/llm', { provider: 'openai-compatible', mentionsAuto: false });
    expect(invalid.status).toBe(400);
    expect(invalid.body.issues?.map((i) => i.path).sort()).toEqual(['baseUrl', 'model']);

    const saved = await admin.put<LlmSettingsView>('/api/settings/llm', {
      provider: 'openai-compatible',
      model: 'modelo-x',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-teste-123456',
      mentionsAuto: false,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ provider: 'openai-compatible', hasApiKey: true, apiKeyHint: '…3456', source: 'database' });
    expect(JSON.stringify(saved.body)).not.toContain('sk-teste-123456');
  });

  it('teste de conexão reporta falha sem derrubar a API', async () => {
    const res = await admin.post<LlmTestResult>('/api/settings/llm/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  it('volta para nenhum provedor', async () => {
    const res = await admin.put<LlmSettingsView>('/api/settings/llm', { provider: 'none', apiKey: null, mentionsAuto: false });
    expect(res.body).toMatchObject({ provider: 'none', hasApiKey: false });
  });
});

describe('GitHub, repositórios e métricas', () => {
  let repo: RepoIntrospectionSummary;

  it('sem configuração: lista vazia e sync é regra de negócio', async () => {
    const view = await admin.get<GithubSettingsView>('/api/settings/github');
    expect(view.body).toMatchObject({ owner: null, hasToken: false });
    expect((await admin.get<RepoIntrospectionSummary[]>('/api/repos')).body).toEqual([]);
    expect((await admin.post('/api/repos/sync')).status).toBe(422);
    expect((await admin.post('/api/repos/introspect', {})).status).toBe(422);
    const test = await admin.post<GithubTestResult>('/api/settings/github/test');
    expect(test.body).toMatchObject({ ok: false });
  });

  it('salva a configuração validando o owner e sem devolver o token', async () => {
    const bad = await admin.put('/api/settings/github', {
      owner: '-inválido',
      includeArchived: false,
      includeForks: false,
      pushedWithinMonths: 12,
    });
    expect(bad.status).toBe(400);
    const saved = await admin.put<GithubSettingsView>('/api/settings/github', {
      owner: 'acme',
      token: 'ghp_tokenzinho_1234',
      includeArchived: false,
      includeForks: false,
      pushedWithinMonths: 12,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ owner: 'acme', hasToken: true, tokenHint: '…1234' });
    expect(JSON.stringify(saved.body)).not.toContain('ghp_tokenzinho_1234');
  });

  it('testa a conexão com o cliente do GitHub', async () => {
    const ok = await admin.post<GithubTestResult>('/api/settings/github/test');
    expect(ok.body).toEqual({ ok: true, login: 'acme-bot', repoCount: 2, error: null });
    app.github.failViewer = true;
    const fail = await admin.post<GithubTestResult>('/api/settings/github/test');
    expect(fail.body).toMatchObject({ ok: false, error: 'Bad credentials' });
    app.github.failViewer = false;
  });

  it('sincroniza a lista (sem arquivados) e lista os repositórios', async () => {
    const synced = await admin.post<RepoIntrospectionSummary[]>('/api/repos/sync');
    expect(synced.status).toBe(200);
    expect(synced.body.map((r) => r.name)).toEqual(['api-pagamentos']);
    const list = await admin.get<RepoIntrospectionSummary[]>('/api/repos');
    repo = list.body[0]!;
    expect(repo.owner).toBe('acme');
  });

  it('aplicar antes de analisar é 404; detalhe de repositório inexistente é 404', async () => {
    expect((await admin.post(`/api/repos/${repo.id}/apply`, { graphId: 1 })).status).toBe(404);
    expect((await admin.post(`/api/repos/${repo.id}/apply`, {})).status).toBe(400);
    expect((await admin.get('/api/repos/9999')).status).toBe(404);
  });

  it('introspecção roda em segundo plano e gera proposta', async () => {
    expect((await admin.post('/api/repos/introspect', { depth: 'profunda' })).status).toBe(400);
    const started = await admin.post<IntrospectionRunState>('/api/repos/introspect', { repos: ['api-pagamentos'], depth: 'medium' });
    expect(started.status).toBe(200);
    expect(started.body.queued + (started.body.running ? 1 : 0)).toBeGreaterThanOrEqual(0);
    await until(async () => {
      const s = await admin.get<IntrospectionRunState>('/api/repos/state');
      return !s.body.running && s.body.queued === 0;
    });
    const detail = await admin.get<RepoIntrospectionDetail>(`/api/repos/${repo.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.error).toBeNull();
    expect(detail.body.status).toBe('done');
    expect(detail.body.proposal?.nodes.length).toBeGreaterThan(0);
    expect(detail.body.analysisDepth).toBe('medium');
  });

  it('aplica a proposta no grafo', async () => {
    const res = await admin.post<ImportResult>(`/api/repos/${repo.id}/apply`, { graphId: 1 });
    expect(res.status).toBe(200);
    expect(res.body.nodesCreated).toBeGreaterThan(0);
  });

  it('gera um grafo novo a partir dos repositórios', async () => {
    const deep = await admin.post<ErrorBody>('/api/graphs/from-repos', { name: 'Completo', repoIds: [repo.id], depth: 'full' });
    expect(deep.status).toBe(422);
    const res = await admin.post<GraphInfo>('/api/graphs/from-repos', { name: 'Pagamentos', repoIds: [repo.id], depth: 'medium' });
    expect(res.status).toBe(201);
    expect(res.body.nodeCount).toBeGreaterThan(0);
  });

  it('métricas: ingestão por token com metrics:write e histórico', async () => {
    const editor = new ApiClient(app.baseUrl);
    await editor.post('/api/auth/login', { email: 'editor@acme.dev', password: 'senha-editor' });
    const token = (await editor.post<CreatedApiToken>('/api/auth/tokens', { name: 'CI' })).body.token;
    const ci = new ApiClient(app.baseUrl);
    ci.bearer = token;

    const payload = {
      owner: 'acme',
      repo: 'api-pagamentos',
      sha: 'abc1234def',
      ref: 'refs/heads/main',
      reports: [{ type: 'istanbul-summary', tool: 'vitest', content: JSON.stringify({ total: { lines: { pct: 81 }, branches: { pct: 70 } } }) }],
      metrics: { lintErrors: 0 },
    };
    const res = await ci.post<RepoMetricsSnapshot>('/api/metrics', payload, { csrf: false });
    expect(res.status).toBe(201);
    expect(res.body.coverage).toEqual({ lines: 81, branches: 70 });
    expect(res.body.reportKeys).toHaveLength(1);
    expect((await ci.post('/api/metrics', { ...payload, sha: 'zzz' }, { csrf: false })).status).toBe(400);

    const viewer = new ApiClient(app.baseUrl);
    await viewer.post('/api/auth/login', { email: 'leitor@acme.dev', password: 'outra-senha-1' });
    expect((await viewer.post('/api/metrics', payload)).status).toBe(403);

    const history = await viewer.get<RepoMetricsSnapshot[]>('/api/metrics/acme/api-pagamentos');
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect((await viewer.get<RepoMetricsSnapshot[]>('/api/metrics/acme/outro')).body).toEqual([]);
  });

  it('relatório de segurança: postura (leitura) e geração heurística sem LLM (editor)', async () => {
    const viewer = new ApiClient(app.baseUrl);
    await viewer.post('/api/auth/login', { email: 'leitor@acme.dev', password: 'outra-senha-1' });
    const portfolio = await viewer.get<SecurityPortfolioView>('/api/reports/security');
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.posture).toMatchObject({ repos: 1, analyzed: 1 });
    const one = await viewer.get<SecurityRepoView>('/api/reports/security/repos/acme/api-pagamentos');
    expect(one.body.posture).toMatchObject({ owner: 'acme', name: 'api-pagamentos' });
    expect(one.body.posture?.axes).toHaveLength(4);
    expect((await viewer.get('/api/reports/security/repos/acme/nada')).status).toBe(404);
    expect((await viewer.post('/api/reports/security', { kind: 'report' })).status).toBe(403);

    expect((await admin.post('/api/reports/security', { owner: 'acme' })).status).toBe(400);
    const created = await admin.post<SecurityReportRecord>('/api/reports/security', { owner: 'acme', repo: 'api-pagamentos', kind: 'tips', focus: 'pipeline' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ scope: 'acme/api-pagamentos', kind: 'tips', method: 'heuristic', createdBy: 'Admin' });
    const report = await admin.post<SecurityReportRecord>('/api/reports/security', {});
    expect(report.body).toMatchObject({ scope: '*', kind: 'report' });
    expect((await viewer.get<SecurityRepoView>('/api/reports/security/repos/acme/api-pagamentos')).body.reports).toHaveLength(1);
  });

  it('remove o token da configuração do GitHub', async () => {
    const res = await admin.put<GithubSettingsView>('/api/settings/github', {
      owner: 'acme',
      token: null,
      includeArchived: true,
      includeForks: true,
      pushedWithinMonths: null,
    });
    expect(res.body).toMatchObject({ hasToken: false, includeArchived: true, pushedWithinMonths: null });
  });
});
