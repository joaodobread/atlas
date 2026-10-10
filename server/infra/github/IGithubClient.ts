export interface GithubRepoInfo {
  name: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  archived: boolean;
  fork: boolean;
  pushedAt: string | null;
  htmlUrl: string;
}

export interface GithubRepoDetails {
  topics: string[];
  /** null = o token não tem acesso a security_and_analysis. */
  secretScanning: boolean | null;
}

export interface GithubPull {
  number: number;
  author: string | null;
  authorIsBot: boolean;
  title: string;
  body: string;
  createdAt: string;
  /** Última atividade no PR. */
  updatedAt: string;
  mergedAt: string | null;
  draft: boolean;
  url: string | null;
}

export interface GithubCommit {
  sha: string;
  author: string | null;
  authorIsBot: boolean;
  date: string;
}

export interface GithubTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

/** Acesso somente leitura à API REST do GitHub. */
export interface IGithubClient {
  /** Login do dono do token. */
  viewer(token: string): Promise<string>;
  /** Repositórios de uma organização ou usuário. */
  listRepos(owner: string, token: string): Promise<GithubRepoInfo[]>;
  headSha(owner: string, repo: string, branch: string, token: string): Promise<string>;
  /** Árvore completa (recursiva) de um commit. */
  tree(owner: string, repo: string, sha: string, token: string): Promise<GithubTreeEntry[]>;
  /** Conteúdo de texto de um arquivo; null se não existir. */
  file(owner: string, repo: string, sha: string, path: string, token: string): Promise<string | null>;
  repoDetails(owner: string, repo: string, token: string): Promise<GithubRepoDetails>;
  /** Tipos de regra ativos no branch (rulesets). */
  branchRules(owner: string, repo: string, branch: string, token: string): Promise<string[]>;
  /** PRs ordenados por atualização (mais recentes primeiro), até `max`. */
  pulls(owner: string, repo: string, state: 'open' | 'closed', max: number, token: string): Promise<GithubPull[]>;
  /** Logins que aprovaram o PR. */
  approvers(owner: string, repo: string, pull: number, token: string): Promise<string[]>;
  /** Quantidade de revisões do PR (qualquer estado). */
  reviewCount(owner: string, repo: string, pull: number, token: string): Promise<number>;
  commits(owner: string, repo: string, branch: string, since: string, max: number, token: string): Promise<GithubCommit[]>;
  /** PRs associados a um commit (vazio = push direto). */
  commitPullCount(owner: string, repo: string, sha: string, token: string): Promise<number>;
}
