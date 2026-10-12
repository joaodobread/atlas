import { describe, expect, it } from 'vitest';
import type { GithubCommit, GithubPull } from '../../infra/github/IGithubClient.ts';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { ProcessCollector } from './ProcessCollector.ts';

const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const pull = (over: Partial<GithubPull>): GithubPull => ({
  number: 1,
  author: 'alice',
  authorIsBot: false,
  title: 'Mudança',
  body: '',
  createdAt: ago(1),
  updatedAt: ago(1),
  mergedAt: ago(1),
  draft: false,
  url: null,
  ...over,
});
const commit = (sha: string, author: string | null, bot = false): GithubCommit => ({ sha, author, authorIsBot: bot, date: ago(1) });

describe('ProcessCollector', () => {
  it('mede revisão, rastreabilidade, push direto, bus factor e PRs parados', async () => {
    const g = new FakeGithubClient();
    g.closedPulls = [
      pull({ number: 1, title: 'fix: closes #12' }),
      pull({ number: 2, body: 'Ref PROJ-42' }),
      pull({ number: 3, author: 'bob', title: 'Sem link' }),
      pull({ number: 4, title: 'auto-aprovado' }),
      pull({ number: 5, mergedAt: null }),
      pull({ number: 6, mergedAt: ago(200) }),
      pull({ number: 7, authorIsBot: true }),
      pull({ number: 8, author: null }),
    ];
    g.approverMap.set(1, ['bob']);
    g.approverMap.set(2, ['ALICE', 'carol']);
    g.approverMap.set(4, ['Alice']);
    g.approverMap.set(8, ['dave']);
    g.openPulls = [
      pull({ number: 20, createdAt: ago(100), mergedAt: null }),
      pull({ number: 21, createdAt: ago(20), mergedAt: null }),
      pull({ number: 22, createdAt: ago(20), mergedAt: null }),
      pull({ number: 23, createdAt: ago(2), mergedAt: null }),
      pull({ number: 24, draft: true, createdAt: ago(200), mergedAt: null }),
      pull({ number: 25, authorIsBot: true, createdAt: ago(200), mergedAt: null }),
    ];
    g.reviewCounts.set(21, 2);
    const commits: GithubCommit[] = [];
    for (let i = 0; i < 8; i++) commits.push(commit(`a${i}`, 'alice'));
    commits.push(commit('b0', 'bob'), commit('c0', null), commit('bot', 'dependabot', true));
    g.commitList = commits;
    for (const c of commits.slice(0, 7)) g.commitPulls.set(c.sha, 1);

    const out = await new ProcessCollector(g).collect('acme', 'api', 'main', 'tok');
    expect(out.windowDays).toBe(90);
    expect(out.mergedPrs).toBe(5);
    expect(out.linkedPrs).toBe(2);
    expect(out.reviewedPrs).toBe(3);
    expect(out.openPrs).toBe(4);
    expect(out.staleOpenPrs).toBe(1);
    expect(out.unreviewedOldPrs).toBe(2);
    expect(out.commits).toBe(10);
    expect(out.topAuthorShare).toBe(0.8);
    expect(out.directPushes).toEqual({ sampled: 10, direct: 3 });
    expect(out.errors).toEqual([]);
  });

  it('progresso: conta cada requisição; o total cresce com as amostras', async () => {
    const g = new FakeGithubClient();
    g.closedPulls = [pull({ number: 1 }), pull({ number: 2 })];
    g.openPulls = [pull({ number: 3, createdAt: ago(30), mergedAt: null })];
    g.commitList = [commit('a', 'alice'), commit('b', 'bob')];
    const seen: Array<[number, number]> = [];
    await new ProcessCollector(g).collect('acme', 'api', 'main', 'tok', (d, t) => seen.push([d, t]));
    // 3 listas + 2 aprovações + 1 revisão + 2 PRs por commit = 8.
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.at(-1)).toEqual([8, 8]);
    expect(seen.every(([d, t]) => d <= t)).toBe(true);
  });

  it('poucos commits: sem bus factor; sem commits: sem amostra de push direto; sem PRs: zero', async () => {
    const g = new FakeGithubClient();
    g.commitList = [commit('x', 'alice')];
    const out = await new ProcessCollector(g).collect('acme', 'api', 'main', 'tok');
    expect(out.topAuthorShare).toBeNull();
    expect(out.directPushes).toEqual({ sampled: 1, direct: 1 });
    expect(out.mergedPrs).toBe(0);
    expect(out.reviewedPrs).toBe(0);

    g.commitList = [];
    expect((await new ProcessCollector(g).collect('acme', 'api', 'main', 'tok')).directPushes).toBeNull();
  });

  it('cada etapa falha sozinha e registra o erro', async () => {
    const g = new FakeGithubClient();
    g.closedPulls = new Error('boom closed');
    g.openPulls = new Error('boom open');
    g.commits = async () => {
      throw 'falha em texto';
    };
    const out = await new ProcessCollector(g).collect('acme', 'api', 'main', 'tok');
    expect(out.errors.sort()).toEqual(['PRs abertos: boom open', 'PRs mesclados: boom closed', 'commits: falha em texto']);
  });
});
