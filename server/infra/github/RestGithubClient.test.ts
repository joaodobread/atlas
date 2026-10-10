import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { RestGithubClient } from './RestGithubClient.ts';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let routes: Array<[RegExp, Handler]> = [];
let calls: Array<{ url: string; headers: Record<string, string> }> = [];

const toUrl = (i: string | URL | Request) => (typeof i === 'string' ? i : i instanceof URL ? i.href : i.url);
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(toUrl(input));
  calls.push({ url: url.pathname + url.search, headers: (init?.headers ?? {}) as Record<string, string> });
  const hit = routes.find(([re]) => re.test(url.pathname + url.search));
  if (!hit) return json({ message: 'Not Found' }, 404);
  return hit[1](url, init ?? {});
});

const on = (re: RegExp, h: Handler) => routes.push([re, h]);
const client = new RestGithubClient('https://gh.test');

const repo = (name: string) => ({
  name,
  description: null,
  default_branch: 'main',
  language: 'Go',
  archived: false,
  fork: false,
  pushed_at: '2026-01-01T00:00:00Z',
  html_url: `https://github.com/x/${name}`,
});

beforeEach(() => {
  routes = [];
  calls = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RestGithubClient', () => {
  it('viewer devolve o login e envia os cabeçalhos', async () => {
    on(/^\/user$/, () => json({ login: 'octocat' }));
    expect(await client.viewer('tok')).toBe('octocat');
    expect(calls[0]!.headers).toMatchObject({ Authorization: 'Bearer tok', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  });

  it('listRepos de organização com paginação', async () => {
    on(/^\/user$/, () => json({ login: 'me' }));
    on(/^\/orgs\/acme$/, () => json({}));
    on(/^\/orgs\/acme\/repos/, (u) => json(u.searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => repo(`r${i}`)) : [repo('last')]));
    const list = await client.listRepos('acme', 'tok');
    expect(list).toHaveLength(101);
    expect(list[100]).toEqual({
      name: 'last',
      description: null,
      defaultBranch: 'main',
      language: 'Go',
      archived: false,
      fork: false,
      pushedAt: '2026-01-01T00:00:00Z',
      htmlUrl: 'https://github.com/x/last',
    });
    expect(calls.some((c) => c.url === '/orgs/acme/repos?type=all&per_page=100&page=2')).toBe(true);
  });

  it('listRepos do próprio usuário (inclui privados) e de outro usuário', async () => {
    on(/^\/user$/, () => json({ login: 'Me' }));
    on(/^\/user\/repos/, () => json([repo('mine')]));
    on(/^\/users\/other\/repos/, () => json([repo('theirs')]));
    expect((await client.listRepos('me', 'tok')).map((r) => r.name)).toEqual(['mine']);
    expect(calls.some((c) => c.url.startsWith('/user/repos?affiliation=owner'))).toBe(true);
    expect((await client.listRepos('other', 'tok')).map((r) => r.name)).toEqual(['theirs']);
  });

  it('listRepos de usuário quando o token não deixa ler o login', async () => {
    on(/^\/user$/, () => json({ message: 'Bad credentials' }, 401));
    on(/^\/users\/me\/repos/, () => json([repo('pub')]));
    expect((await client.listRepos('me', 'tok')).map((r) => r.name)).toEqual(['pub']);
  });

  it('headSha e tree (filtra commits/submódulos e tamanho padrão)', async () => {
    on(/\/repos\/acme\/api\/commits\/feat%2Fx$/, () => json({ sha: 'abc' }));
    on(/\/git\/trees\/abc\?recursive=1$/, () =>
      json({
        tree: [
          { path: 'a.ts', type: 'blob', size: 10 },
          { path: 'src', type: 'tree' },
          { path: 'sub', type: 'commit' },
        ],
      }),
    );
    expect(await client.headSha('acme', 'api', 'feat/x', 'tok')).toBe('abc');
    expect(await client.tree('acme', 'api', 'abc', 'tok')).toEqual([
      { path: 'a.ts', type: 'blob', size: 10 },
      { path: 'src', type: 'tree', size: 0 },
    ]);
  });

  it('file: texto cru, 404 = null, outros erros lançam', async () => {
    on(/\/contents\/dir\/my%20file\.ts\?ref=abc$/, () => new Response('conteúdo', { status: 200 }));
    on(/\/contents\/boom\.ts/, () => json({ message: 'Server Error' }, 500));
    expect(await client.file('acme', 'api', 'abc', 'dir/my file.ts', 'tok')).toBe('conteúdo');
    expect(calls[0]!.headers.Accept).toBe('application/vnd.github.raw+json');
    expect(await client.file('acme', 'api', 'abc', 'missing.ts', 'tok')).toBeNull();
    await expect(client.file('acme', 'api', 'abc', 'boom.ts', 'tok')).rejects.toThrow('GitHub respondeu 500: Server Error');
  });

  it('repoDetails: topics e secret scanning (null sem acesso, ativo, push protection, inativo)', async () => {
    let body: unknown = { topics: ['api'], security_and_analysis: null };
    on(/^\/repos\/acme\/api$/, () => json(body));
    expect(await client.repoDetails('acme', 'api', 'tok')).toEqual({ topics: ['api'], secretScanning: null });
    body = { security_and_analysis: { secret_scanning: { status: 'enabled' } } };
    expect(await client.repoDetails('acme', 'api', 'tok')).toEqual({ topics: [], secretScanning: true });
    body = { security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'enabled' } } };
    expect((await client.repoDetails('acme', 'api', 'tok')).secretScanning).toBe(true);
    body = { security_and_analysis: {} };
    expect((await client.repoDetails('acme', 'api', 'tok')).secretScanning).toBe(false);
  });

  it('branchRules sem repetição', async () => {
    on(/\/rules\/branches\/main$/, () => json([{ type: 'pull_request' }, { type: 'pull_request' }, { type: 'deletion' }]));
    expect(await client.branchRules('acme', 'api', 'main', 'tok')).toEqual(['pull_request', 'deletion']);
  });

  it('pulls: mapeia, detecta bots, pagina e corta no máximo', async () => {
    const pr = (n: number, user: { login: string; type: string } | null, extra: Record<string, unknown> = {}) => ({
      number: n,
      title: `PR ${n}`,
      body: null,
      created_at: '2026-01-01',
      merged_at: null,
      user,
      ...extra,
    });
    on(/\/pulls\?state=closed.*page=1$/, () =>
      json([
        pr(1, { login: 'alice', type: 'User' }, { draft: true, body: 'corpo', merged_at: '2026-01-02', updated_at: '2026-01-03', html_url: 'https://gh/pr/1' }),
        pr(2, { login: 'app', type: 'Bot' }),
        pr(3, { login: 'renovate-x', type: 'User' }),
        pr(4, null),
        ...Array.from({ length: 96 }, (_, i) => pr(10 + i, { login: 'bob', type: 'User' })),
      ]),
    );
    on(/\/pulls\?state=closed.*page=2$/, () => json([pr(200, { login: 'z', type: 'User' })]));
    const all = await client.pulls('acme', 'api', 'closed', 500, 'tok');
    expect(all).toHaveLength(101);
    expect(all[0]).toEqual({
      number: 1,
      author: 'alice',
      authorIsBot: false,
      title: 'PR 1',
      body: 'corpo',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-03',
      mergedAt: '2026-01-02',
      draft: true,
      url: 'https://gh/pr/1',
    });
    expect(all[1]!.authorIsBot).toBe(true);
    expect(all[2]!.authorIsBot).toBe(true);
    // Sem updated_at/html_url: cai na criação e em null.
    expect(all[3]).toMatchObject({ author: null, authorIsBot: false, body: '', draft: false, updatedAt: '2026-01-01', url: null });
    expect(await client.pulls('acme', 'api', 'closed', 2, 'tok')).toHaveLength(2);
  });

  it('approvers, reviewCount e commitPullCount', async () => {
    on(/\/pulls\/7\/reviews/, () =>
      json([
        { state: 'APPROVED', user: { login: 'bob' } },
        { state: 'APPROVED', user: { login: 'bob' } },
        { state: 'COMMENTED', user: { login: 'carol' } },
        { state: 'APPROVED', user: null },
      ]),
    );
    on(/\/commits\/abc\/pulls$/, () => json([{}, {}]));
    expect(await client.approvers('acme', 'api', 7, 'tok')).toEqual(['bob']);
    expect(await client.reviewCount('acme', 'api', 7, 'tok')).toBe(4);
    expect(await client.commitPullCount('acme', 'api', 'abc', 'tok')).toBe(2);
  });

  it('commits: autor pelo login/email/nome, bots e paginação', async () => {
    const c = (sha: string, author: { login: string; type: string } | null, commitAuthor: { name: string; email: string; date: string } | null) => ({
      sha,
      author,
      commit: { author: commitAuthor },
    });
    on(/\/commits\?sha=main.*page=1$/, () =>
      json([
        c('1', { login: 'Alice', type: 'User' }, { name: 'A', email: 'a@x', date: '2026-01-01' }),
        c('2', null, { name: 'Bob', email: 'Bob@X.com', date: '2026-01-02' }),
        c('3', { login: 'github-actions[bot]', type: 'Bot' }, null),
        c('4', null, null),
        c('5', null, { name: 'x', email: 'noreply@github.com', date: '' }),
        ...Array.from({ length: 95 }, (_, i) => c(`p${i}`, { login: 'dev', type: 'User' }, { name: 'd', email: 'd', date: 'd' })),
      ]),
    );
    on(/\/commits\?sha=main.*page=2$/, () => json([c('last', { login: 'dev', type: 'User' }, null)]));
    const list = await client.commits('acme', 'api', 'main', '2026-01-01T00:00:00Z', 1000, 'tok');
    expect(list).toHaveLength(101);
    expect(list[0]).toEqual({ sha: '1', author: 'alice', authorIsBot: false, date: '2026-01-01' });
    expect(list[1]).toMatchObject({ author: 'bob@x.com', authorIsBot: false });
    expect(list[2]).toMatchObject({ authorIsBot: true, date: '' });
    expect(list[3]).toMatchObject({ author: null, authorIsBot: false });
    expect(list[4]!.authorIsBot).toBe(true);
    expect(calls[0]!.url).toContain('since=2026-01-01T00%3A00%3A00Z');
  });

  it('mapeia erros: 401, 403 de cota, 403 comum e resposta sem JSON', async () => {
    on(/^\/user$/, () => json({ message: 'Bad credentials' }, 401));
    await expect(client.viewer('tok')).rejects.toThrow(new BusinessRuleError('Token do GitHub inválido ou expirado'));
    routes = [];
    on(/^\/user$/, () => json({ message: 'Forbidden' }, 403));
    await expect(client.viewer('tok')).rejects.toThrow('GitHub respondeu 403: Forbidden');
    routes = [];
    on(/^\/user$/, () => new Response('oops', { status: 502, statusText: 'Bad Gateway' }));
    await expect(client.viewer('tok')).rejects.toThrow('GitHub respondeu 502: Bad Gateway');
  });

  it('limite de taxa: espera e tenta mais uma vez (Retry-After)', async () => {
    vi.useFakeTimers();
    let n = 0;
    on(/^\/user$/, () => (n++ === 0 ? json({ message: 'slow down' }, 429, { 'retry-after': '2' }) : json({ login: 'ok' })));
    const p = client.viewer('tok');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('limite de taxa: espera até o reset (máx. 90 s) e falha se continuar limitado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const reset = String(Date.now() / 1000 + 600);
    on(/^\/user$/, () => json({ message: 'rate' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }));
    const p = client.viewer('tok');
    const caught = p.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await caught).toEqual(new BusinessRuleError('Limite de requisições do GitHub atingido; tente mais tarde'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('limite de taxa sem reset futuro espera 30 s', async () => {
    vi.useFakeTimers();
    let n = 0;
    on(/^\/user$/, () => (n++ === 0 ? json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }) : json({ login: 'ok' })));
    const p = client.viewer('tok');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('ok');
  });

  it('usa a API pública por padrão', async () => {
    on(/^\/user$/, () => json({ login: 'x' }));
    await new RestGithubClient().viewer('tok');
    expect(toUrl(fetchMock.mock.calls[0]![0])).toBe('https://api.github.com/user');
  });
});
