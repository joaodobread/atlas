import type { RepoProcess } from '../../../shared/types.ts';
import type { IGithubClient } from '../../infra/github/IGithubClient.ts';

const WINDOW_DAYS = 90;
const DAY = 24 * 3600 * 1000;
const MAX_PULLS = 200;
const MAX_REVIEW_LOOKUPS = 40;
const MAX_COMMITS = 300;
const DIRECT_PUSH_SAMPLE = 20;
const CONCURRENCY = 4;
const ISSUE_LINK = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+|(^|\s)#\d+\b|AB#\d+|\/issues\/\d+|\b[A-Z][A-Z0-9]+-\d+\b/i;

/**
 * Saúde do processo nos últimos 90 dias, só com a API REST: revisão dos PRs, pushes diretos,
 * rastreabilidade para issues, concentração de autoria e PRs parados. Cada parte falha sozinha.
 */
export class ProcessCollector {
  constructor(private readonly github: IGithubClient) {}

  /** `onProgress(feitas, total)` a cada requisição (PRs, revisões, commits); o total cresce conforme as amostras aparecem. */
  async collect(owner: string, repo: string, branch: string, token: string, onProgress?: (done: number, total: number) => void): Promise<RepoProcess> {
    const since = new Date(Date.now() - WINDOW_DAYS * DAY);
    // 3 listas (PRs fechados, abertos, commits) + uma consulta por item das amostras.
    let done = 0;
    let total = 3;
    const report = () => onProgress?.(done, total);
    const counted = async <T>(p: Promise<T>): Promise<T> => {
      try {
        return await p;
      } finally {
        done++;
        report();
      }
    };
    const expect = (n: number) => {
      total += n;
      report();
    };
    report();
    const errors: string[] = [];
    const out: RepoProcess = {
      windowDays: WINDOW_DAYS,
      collectedAt: new Date().toISOString(),
      mergedPrs: 0,
      reviewedPrs: 0,
      linkedPrs: 0,
      directPushes: null,
      commits: 0,
      topAuthorShare: null,
      openPrs: 0,
      staleOpenPrs: 0,
      unreviewedOldPrs: 0,
      errors,
    };
    const step = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    await Promise.all([
      step('PRs mesclados', async () => {
        const merged = (await counted(this.github.pulls(owner, repo, 'closed', MAX_PULLS, token))).filter(
          (p) => p.mergedAt && Date.parse(p.mergedAt) >= since.getTime() && !p.authorIsBot,
        );
        out.mergedPrs = merged.length;
        out.linkedPrs = merged.filter((p) => ISSUE_LINK.test(`${p.title}\n${p.body}`)).length;
        const sample = merged.slice(0, MAX_REVIEW_LOOKUPS);
        expect(sample.length);
        let reviewed = 0;
        await pool(sample, CONCURRENCY, async (p) => {
          const approvers = await counted(this.github.approvers(owner, repo, p.number, token));
          if (approvers.some((a) => a.toLowerCase() !== p.author?.toLowerCase())) reviewed++;
        });
        // Amostra: extrapola a proporção para o total.
        out.reviewedPrs = sample.length ? Math.round((reviewed / sample.length) * merged.length) : 0;
      }),
      step('PRs abertos', async () => {
        const open = (await counted(this.github.pulls(owner, repo, 'open', MAX_PULLS, token))).filter((p) => !p.draft && !p.authorIsBot);
        out.openPrs = open.length;
        out.staleOpenPrs = open.filter((p) => Date.now() - Date.parse(p.createdAt) > 90 * DAY).length;
        const old = open.filter((p) => Date.now() - Date.parse(p.createdAt) > 14 * DAY).slice(0, MAX_REVIEW_LOOKUPS);
        expect(old.length);
        let unreviewed = 0;
        await pool(old, CONCURRENCY, async (p) => {
          if ((await counted(this.github.reviewCount(owner, repo, p.number, token))) === 0) unreviewed++;
        });
        out.unreviewedOldPrs = unreviewed;
      }),
      step('commits', async () => {
        const commits = (await counted(this.github.commits(owner, repo, branch, since.toISOString(), MAX_COMMITS, token))).filter((c) => !c.authorIsBot);
        out.commits = commits.length;
        if (commits.length >= 10) {
          const byAuthor = new Map<string, number>();
          for (const c of commits) byAuthor.set(c.author ?? '?', (byAuthor.get(c.author ?? '?') ?? 0) + 1);
          out.topAuthorShare = Math.max(...byAuthor.values()) / commits.length;
        }
        const sample = commits.slice(0, DIRECT_PUSH_SAMPLE);
        expect(sample.length);
        if (sample.length) {
          let direct = 0;
          await pool(sample, CONCURRENCY, async (c) => {
            if ((await counted(this.github.commitPullCount(owner, repo, c.sha, token))) === 0) direct++;
          });
          out.directPushes = { sampled: sample.length, direct };
        }
      }),
    ]);
    return out;
  }
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}
