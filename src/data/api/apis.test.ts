import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import { HttpService } from '../../core/http/HttpService.ts';
import { resetSingleton } from '../../testing/vmFixtures.ts';
import { AuthApi } from './AuthApi.ts';
import { CallSiteApi } from './CallSiteApi.ts';
import { ConnectionApi } from './ConnectionApi.ts';
import { DocumentApi } from './DocumentApi.ts';
import { GithubApi } from './GithubApi.ts';
import { GraphApi } from './GraphApi.ts';
import { InterfaceApi } from './InterfaceApi.ts';
import { NodeApi } from './NodeApi.ts';
import { SettingsApi } from './SettingsApi.ts';
import { UserApi } from './UserApi.ts';

const http = {
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  post: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  patch: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  put: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  delete: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
};
const fake = http as unknown as IHttpService;

const ALL = [AuthApi, CallSiteApi, ConnectionApi, DocumentApi, GithubApi, GraphApi, InterfaceApi, NodeApi, SettingsApi, UserApi];

beforeEach(() => {
  for (const fn of Object.values(http)) fn.mockReset().mockResolvedValue('ok');
  for (const cls of ALL) resetSingleton(cls);
});

describe('singletons das APIs', () => {
  it('reaproveitam a primeira instância e usam o HttpService por padrão', () => {
    for (const cls of ALL) {
      const a = (cls as unknown as { getInstance(h?: IHttpService): object }).getInstance();
      expect((cls as unknown as { getInstance(h?: IHttpService): object }).getInstance(fake)).toBe(a);
      expect((a as { http: unknown }).http).toBe(HttpService.getInstance());
    }
  });
});

describe('CrudApi (nós, conexões, interfaces, locais)', () => {
  it.each([
    [NodeApi, '/nodes'],
    [ConnectionApi, '/connections'],
    [InterfaceApi, '/interfaces'],
    [CallSiteApi, '/call-sites'],
  ] as const)('%o usa o recurso %s', async (cls, base) => {
    const api = cls.getInstance(fake);
    await api.list();
    await api.get(3);
    await api.create({} as never);
    await api.update(3, {} as never);
    await api.remove(3);
    expect(http.get.mock.calls).toEqual([[base], [`${base}/3`]]);
    expect(http.post).toHaveBeenCalledWith(base, {});
    expect(http.patch).toHaveBeenCalledWith(`${base}/3`, {});
    expect(http.delete).toHaveBeenCalledWith(`${base}/3`);
  });
});

describe('AuthApi', () => {
  it('mapeia rotas de autenticação e tokens', async () => {
    const api = AuthApi.getInstance(fake);
    await api.status();
    await api.setup({ name: 'a', email: 'e', password: 'p' });
    await api.login({ email: 'e', password: 'p' });
    await api.logout();
    await api.setOnboarded(true);
    await api.changePassword({ currentPassword: 'a', newPassword: 'b' });
    await api.tokens();
    await api.createToken({ name: 't' });
    await api.revokeToken(9);
    expect(http.get.mock.calls).toEqual([['/auth/status'], ['/auth/tokens']]);
    expect(http.post.mock.calls).toEqual([
      ['/auth/setup', { name: 'a', email: 'e', password: 'p' }],
      ['/auth/login', { email: 'e', password: 'p' }],
      ['/auth/logout'],
      ['/auth/onboarding', { done: true }],
      ['/auth/password', { currentPassword: 'a', newPassword: 'b' }],
      ['/auth/tokens', { name: 't' }],
    ]);
    expect(http.delete).toHaveBeenCalledWith('/auth/tokens/9');
  });
});

describe('DocumentApi', () => {
  it('mapeia documentos, pastas, busca e status', async () => {
    const api = DocumentApi.getInstance(fake);
    await api.list();
    await api.get(1);
    await api.upsert({ path: 'p', content: 'c', source: 'api' });
    await api.importMany({ documents: [] });
    await api.remove(2);
    await api.mentionsOfNode(5);
    await api.folders();
    await api.addFolder('/x');
    await api.removeFolder(3);
    await api.rescanFolder(4);
    await api.search({ q: 'a b', mode: 'text', limit: 5 });
    await api.ask({ question: 'por quê?', limit: 8 });
    await api.status();
    await api.llm();
    expect(http.get.mock.calls).toEqual([
      ['/documents'],
      ['/documents/1'],
      ['/nodes/5/mentions'],
      ['/folders'],
      ['/search?q=a+b&mode=text&limit=5'],
      ['/index-status'],
      ['/llm'],
    ]);
    expect(http.post.mock.calls).toEqual([
      ['/documents', { path: 'p', content: 'c', source: 'api' }],
      ['/documents/import', { documents: [] }],
      ['/folders', { path: '/x' }],
      ['/folders/4/rescan'],
      ['/ask', { question: 'por quê?', limit: 8 }],
    ]);
    expect(http.delete.mock.calls).toEqual([['/documents/2'], ['/folders/3']]);
  });
});

describe('GithubApi', () => {
  it('mapeia configurações, repositórios e métricas', async () => {
    const api = GithubApi.getInstance(fake);
    await api.settings();
    await api.updateSettings({ owner: 'o', includeArchived: false, includeForks: false, pushedWithinMonths: null });
    await api.testSettings();
    await api.repos();
    await api.sync();
    await api.introspect({ force: false, depth: 'fast' });
    await api.state();
    await api.repo(4);
    await api.apply(4, 2);
    await api.metricsHistory('my org', 'a/b');
    expect(http.get.mock.calls).toEqual([['/settings/github'], ['/repos'], ['/repos/state'], ['/repos/4'], ['/metrics/my%20org/a%2Fb']]);
    expect(http.put).toHaveBeenCalledWith('/settings/github', expect.objectContaining({ owner: 'o' }));
    expect(http.post.mock.calls).toEqual([
      ['/settings/github/test'],
      ['/repos/sync'],
      ['/repos/introspect', { force: false, depth: 'fast' }],
      ['/repos/4/apply', { graphId: 2 }],
    ]);
  });
});

describe('GraphApi', () => {
  it('mapeia grafos, import e export', async () => {
    const api = GraphApi.getInstance(fake);
    await api.list();
    await api.load(1);
    await api.create({ name: 'n' });
    await api.update(1, { name: 'm' });
    await api.delete(1);
    await api.fromRepos({ name: 'n', repoIds: [1], depth: 'fast' });
    await api.exportDocument(1);
    await api.importDocument(1, { nodes: [] });
    expect(http.get.mock.calls).toEqual([['/graphs'], ['/graphs/1'], ['/graphs/1/export']]);
    expect(http.post.mock.calls).toEqual([
      ['/graphs', { name: 'n' }],
      ['/graphs/from-repos', { name: 'n', repoIds: [1], depth: 'fast' }],
      ['/graphs/1/import', { nodes: [] }],
    ]);
    expect(http.patch).toHaveBeenCalledWith('/graphs/1', { name: 'm' });
    expect(http.delete).toHaveBeenCalledWith('/graphs/1');
  });
});

describe('SettingsApi', () => {
  it('mapeia LLM e reprocessamento', async () => {
    const api = SettingsApi.getInstance(fake);
    await api.llm();
    await api.updateLlm({ provider: 'none', mentionsAuto: true });
    await api.testLlm();
    await api.reprocessMentions();
    expect(http.get).toHaveBeenCalledWith('/settings/llm');
    expect(http.put).toHaveBeenCalledWith('/settings/llm', { provider: 'none', mentionsAuto: true });
    expect(http.post.mock.calls).toEqual([['/settings/llm/test'], ['/mentions/reprocess']]);
  });
});

describe('UserApi', () => {
  it('mapeia usuários', async () => {
    const api = UserApi.getInstance(fake);
    await api.list();
    await api.create({ name: 'a', email: 'e', role: 'viewer', password: 'p' });
    await api.update(2, { active: false });
    await api.remove(2);
    expect(http.get).toHaveBeenCalledWith('/users');
    expect(http.post).toHaveBeenCalledWith('/users', { name: 'a', email: 'e', role: 'viewer', password: 'p' });
    expect(http.patch).toHaveBeenCalledWith('/users/2', { active: false });
    expect(http.delete).toHaveBeenCalledWith('/users/2');
  });
});
