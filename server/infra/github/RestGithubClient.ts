import { BusinessRuleError } from '../../core/errors/AppError.ts';
import type { GithubCommit, GithubPull, GithubRepoDetails, GithubRepoInfo, GithubTreeEntry, IGithubClient } from './IGithubClient.ts';

interface ApiRepo {
  name: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  archived: boolean;
  fork: boolean;
  pushed_at: string | null;
  html_url: string;
}

interface ApiTree {
  truncated?: boolean;
  tree: Array<{ path: string; type: string; size?: number; sha?: string }>;
}

/** Cliente da API REST do GitHub via fetch (sem clonar). */
export class RestGithubClient implements IGithubClient {
  constructor(private readonly baseUrl = 'https://api.github.com') {}

  async viewer(token: string): Promise<string> {
    const me = await this.json<{ login: string }>('/user', token);
    return me.login;
  }

  async listRepos(owner: string, token: string): Promise<GithubRepoInfo[]> {
    const login = await this.viewer(token).catch(() => null);
    // Organização; se não for, usuário (o próprio dono do token também vê os privados).
    let path = `/orgs/${encodeURIComponent(owner)}/repos?type=all&per_page=100`;
    const isOrg = await this.request(`/orgs/${encodeURIComponent(owner)}`, token).then((r) => r.ok);
    if (!isOrg)
      path =
        login?.toLowerCase() === owner.toLowerCase() ? '/user/repos?affiliation=owner&per_page=100' : `/users/${encodeURIComponent(owner)}/repos?per_page=100`;
    const out: GithubRepoInfo[] = [];
    for (let page = 1; page <= 50; page++) {
      const list = await this.json<ApiRepo[]>(`${path}&page=${page}`, token);
      out.push(
        ...list.map((r) => ({
          name: r.name,
          description: r.description,
          defaultBranch: r.default_branch,
          language: r.language,
          archived: r.archived,
          fork: r.fork,
          pushedAt: r.pushed_at,
          htmlUrl: r.html_url,
        })),
      );
      if (list.length < 100) break;
    }
    return out;
  }

  async headSha(owner: string, repo: string, branch: string, token: string): Promise<string> {
    const commit = await this.json<{ sha: string }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, token);
    return commit.sha;
  }

  async tree(owner: string, repo: string, sha: string, token: string): Promise<GithubTreeEntry[]> {
    const res = await this.json<ApiTree>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, token);
    // Repositório muito grande: a API corta a árvore recursiva; aí percorre pasta por pasta para não perder arquivos.
    const entries = res.truncated ? await this.walk(owner, repo, sha, '', token) : res.tree;
    return entries.filter((e) => e.type === 'blob' || e.type === 'tree').map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.size ?? 0 }));
  }

  /** Árvore completa sem `recursive` (que tem teto): lista cada pasta e desce nas subpastas. */
  private async walk(owner: string, repo: string, sha: string, prefix: string, token: string): Promise<ApiTree['tree']> {
    const level = await this.json<ApiTree>(`/repos/${owner}/${repo}/git/trees/${sha}`, token);
    const out: ApiTree['tree'] = [];
    for (const e of level.tree) {
      const path = prefix ? `${prefix}/${e.path}` : e.path;
      out.push({ ...e, path });
      if (e.type === 'tree' && e.sha) out.push(...(await this.walk(owner, repo, e.sha, path, token)));
    }
    return out;
  }

  async file(owner: string, repo: string, sha: string, path: string, token: string): Promise<string | null> {
    const res = await this.request(
      `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`,
      token,
      'application/vnd.github.raw+json',
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await this.error(res);
    return res.text();
  }

  async repoDetails(owner: string, repo: string, token: string): Promise<GithubRepoDetails> {
    const r = await this.json<{
      topics?: string[];
      security_and_analysis?: { secret_scanning?: { status?: string }; secret_scanning_push_protection?: { status?: string } } | null;
    }>(`/repos/${owner}/${repo}`, token);
    const sa = r.security_and_analysis;
    return {
      topics: r.topics ?? [],
      secretScanning: sa ? sa.secret_scanning?.status === 'enabled' || sa.secret_scanning_push_protection?.status === 'enabled' : null,
    };
  }

  async branchRules(owner: string, repo: string, branch: string, token: string): Promise<string[]> {
    const rules = await this.json<Array<{ type: string }>>(`/repos/${owner}/${repo}/rules/branches/${encodeURIComponent(branch)}`, token);
    return [...new Set(rules.map((r) => r.type))];
  }

  async pulls(owner: string, repo: string, state: 'open' | 'closed', max: number, token: string): Promise<GithubPull[]> {
    const out: GithubPull[] = [];
    for (let page = 1; out.length < max && page <= 10; page++) {
      const list = await this.json<
        Array<{
          number: number;
          title: string;
          body: string | null;
          created_at: string;
          updated_at?: string;
          merged_at: string | null;
          html_url?: string;
          draft?: boolean;
          user: { login: string; type: string } | null;
        }>
      >(`/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`, token);
      out.push(
        ...list.map((p) => ({
          number: p.number,
          author: p.user?.login ?? null,
          authorIsBot: p.user?.type === 'Bot' || /\[bot\]$|dependabot|renovate/i.test(p.user?.login ?? ''),
          title: p.title,
          body: p.body ?? '',
          createdAt: p.created_at,
          updatedAt: p.updated_at ?? p.created_at,
          mergedAt: p.merged_at,
          draft: !!p.draft,
          url: p.html_url ?? null,
        })),
      );
      if (list.length < 100) break;
    }
    return out.slice(0, max);
  }

  async approvers(owner: string, repo: string, pull: number, token: string): Promise<string[]> {
    const reviews = await this.json<Array<{ state: string; user: { login: string } | null }>>(
      `/repos/${owner}/${repo}/pulls/${pull}/reviews?per_page=100`,
      token,
    );
    return [...new Set(reviews.filter((r) => r.state === 'APPROVED' && r.user).map((r) => r.user!.login))];
  }

  async reviewCount(owner: string, repo: string, pull: number, token: string): Promise<number> {
    return (await this.json<unknown[]>(`/repos/${owner}/${repo}/pulls/${pull}/reviews?per_page=100`, token)).length;
  }

  async commits(owner: string, repo: string, branch: string, since: string, max: number, token: string): Promise<GithubCommit[]> {
    const out: GithubCommit[] = [];
    for (let page = 1; out.length < max && page <= 10; page++) {
      const list = await this.json<
        Array<{ sha: string; author: { login: string; type: string } | null; commit: { author: { name: string; email: string; date: string } | null } }>
      >(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`, token);
      out.push(
        ...list.map((c) => {
          const login = c.author?.login ?? c.commit.author?.email ?? c.commit.author?.name ?? null;
          return {
            sha: c.sha,
            author: login?.toLowerCase() ?? null,
            authorIsBot: c.author?.type === 'Bot' || /\[bot\]|noreply@github\.com|dependabot|renovate|actions@github/i.test(login ?? ''),
            date: c.commit.author?.date ?? '',
          };
        }),
      );
      if (list.length < 100) break;
    }
    return out.slice(0, max);
  }

  async commitPullCount(owner: string, repo: string, sha: string, token: string): Promise<number> {
    return (await this.json<unknown[]>(`/repos/${owner}/${repo}/commits/${sha}/pulls`, token)).length;
  }

  private async json<T>(path: string, token: string): Promise<T> {
    const res = await this.request(path, token);
    if (!res.ok) throw await this.error(res);
    return (await res.json()) as T;
  }

  /** Com limite de taxa (403/429 + Retry-After ou sem cota), espera e tenta mais uma vez. */
  private async request(path: string, token: string, accept = 'application/vnd.github+json', retried = false): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'comm-graph' },
      signal: AbortSignal.timeout(30_000),
    });
    const limited = (res.status === 403 || res.status === 429) && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0');
    if (!limited || retried) return res;
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    const waitMs = Math.min(90_000, Number(res.headers.get('retry-after')) * 1000 || (reset > 0 ? reset : 30_000));
    await new Promise((r) => setTimeout(r, waitMs));
    return this.request(path, token, accept, true);
  }

  private async error(res: Response): Promise<Error> {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    if (res.status === 401) return new BusinessRuleError('Token do GitHub inválido ou expirado');
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'))
      return new BusinessRuleError('Limite de requisições do GitHub atingido; tente mais tarde');
    return new BusinessRuleError(`GitHub respondeu ${res.status}: ${body?.message ?? res.statusText}`);
  }
}
