import { describe, expect, it } from 'vitest';
import type { GithubPull } from '../../infra/github/IGithubClient.ts';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { ActivityCollector } from './ActivityCollector.ts';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const ago = (days: number) => new Date(NOW - days * 24 * 3600 * 1000).toISOString();
const pr = (number: number, days: number, o: Partial<GithubPull> = {}): GithubPull => ({
  number,
  author: 'ana',
  authorIsBot: false,
  title: `PR ${number}`,
  body: '',
  createdAt: ago(days),
  updatedAt: ago(days),
  mergedAt: null,
  draft: false,
  url: `https://gh/${number}`,
  ...o,
});

describe('ActivityCollector', () => {
  it('conta abertos, rascunhos e antigos; lista os mais antigos sem rascunhos e bots', async () => {
    const github = new FakeGithubClient({});
    github.openPulls = [
      pr(1, 5),
      pr(2, 45),
      pr(3, 100, { draft: true }),
      pr(4, 200, { authorIsBot: true }),
      ...Array.from({ length: 12 }, (_, i) => pr(10 + i, 60 + i)),
    ];
    const a = await new ActivityCollector(github).collect('acme', 'api', 'tok', NOW);
    expect(a).toMatchObject({ collectedAt: new Date(NOW).toISOString(), openPrs: 16, draftPrs: 1, oldPrs: 13, error: null });
    expect(a.pulls).toHaveLength(10);
    expect(a.pulls[0]).toEqual({ number: 21, title: 'PR 21', author: 'ana', createdAt: ago(71), updatedAt: ago(71), url: 'https://gh/21' });
  });

  it('erro (ex.: token sem permissão) vira openPrs null com a mensagem', async () => {
    const github = new FakeGithubClient({});
    github.openPulls = new Error('403');
    expect(await new ActivityCollector(github).collect('acme', 'api', 'tok', NOW)).toEqual({
      collectedAt: new Date(NOW).toISOString(),
      openPrs: null,
      draftPrs: 0,
      oldPrs: 0,
      pulls: [],
      error: '403',
    });
    const raw = { pulls: () => Promise.reject(new Error('x')) } as unknown as FakeGithubClient;
    raw.pulls = () => Promise.reject('texto') as never;
    expect((await new ActivityCollector(raw).collect('acme', 'api', 'tok', NOW)).error).toBe('texto');
  });
});
