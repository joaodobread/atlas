import type { RepoActivity } from '../../../shared/types.ts';
import type { IGithubClient } from '../../infra/github/IGithubClient.ts';

const DAY = 24 * 3600 * 1000;
const MAX_PULLS = 100;
const KEEP = 10;
const OLD_DAYS = 30;

/** Atividade leve (1 chamada por repositório): PRs abertos, rascunhos e os mais antigos. */
export class ActivityCollector {
  constructor(private readonly github: IGithubClient) {}

  async collect(owner: string, repo: string, token: string, now = Date.now()): Promise<RepoActivity> {
    const collectedAt = new Date(now).toISOString();
    try {
      const open = await this.github.pulls(owner, repo, 'open', MAX_PULLS, token);
      const real = open.filter((p) => !p.draft && !p.authorIsBot).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      return {
        collectedAt,
        openPrs: open.length,
        draftPrs: open.filter((p) => p.draft).length,
        oldPrs: real.filter((p) => now - Date.parse(p.createdAt) > OLD_DAYS * DAY).length,
        pulls: real
          .slice(0, KEEP)
          .map((p) => ({ number: p.number, title: p.title, author: p.author, createdAt: p.createdAt, updatedAt: p.updatedAt, url: p.url })),
        error: null,
      };
    } catch (err) {
      return { collectedAt, openPrs: null, draftPrs: 0, oldPrs: 0, pulls: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
