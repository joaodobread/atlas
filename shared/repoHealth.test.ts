import { describe, expect, it } from 'vitest';
import { attentionOf, daysSince, monthsSince, type HealthInput } from './repoHealth.ts';
import type { RepoActivity } from './types.ts';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const ago = (days: number) => new Date(NOW - days * 24 * 3600 * 1000).toISOString();
const activity = (o: Partial<RepoActivity> = {}): RepoActivity => ({ collectedAt: ago(0), openPrs: 0, draftPrs: 0, oldPrs: 0, pulls: [], error: null, ...o });
const base = (o: Partial<HealthInput> = {}): HealthInput => ({
  archived: false,
  pushedAt: ago(1),
  activity: null,
  vulnerabilities: null,
  runtimeEol: null,
  score: null,
  ...o,
});
const pr = (n: number, days: number) => ({ number: n, title: 't', author: 'a', createdAt: ago(days), updatedAt: ago(days), url: null });

describe('repoHealth', () => {
  it('datas relativas', () => {
    expect(monthsSince(null, NOW)).toBeNull();
    expect(monthsSince(ago(400), NOW)).toBe(13);
    expect(daysSince(ago(3), NOW)).toBe(3);
  });

  it('ativo e sem problemas: ok', () => {
    expect(attentionOf(base(), NOW)).toEqual({ level: 'ok', reasons: [] });
  });

  it('arquivado nunca pede atenção', () => {
    expect(attentionOf(base({ archived: true, pushedAt: ago(2000), runtimeEol: true }), NOW)).toEqual({ level: 'ok', reasons: [] });
  });

  it('parado: observar a partir de 6 meses, atenção a partir de 12', () => {
    expect(attentionOf(base({ pushedAt: ago(200) }), NOW)).toEqual({ level: 'watch', reasons: ['Sem commits há 6 meses'] });
    expect(attentionOf(base({ pushedAt: ago(400) }), NOW)).toEqual({ level: 'attention', reasons: ['Sem commits há 13 meses'] });
  });

  it('PRs: antigos pedem observar; mais velho que 90 dias pede atenção', () => {
    expect(attentionOf(base({ activity: activity({ oldPrs: 2, pulls: [pr(1, 40), pr(2, 35)] }) }), NOW)).toEqual({
      level: 'watch',
      reasons: ['2 PR(s) aberto(s) há mais de 30 dias'],
    });
    expect(attentionOf(base({ activity: activity({ oldPrs: 1, pulls: [pr(9, 100)] }) }), NOW)).toEqual({
      level: 'attention',
      reasons: ['PR #9 aberto há 100 dias'],
    });
  });

  it('vulnerabilidades, runtime EOL e nota baixa; motivos mais graves primeiro', () => {
    expect(attentionOf(base({ vulnerabilities: 2, score: 3 }), NOW)).toEqual({
      level: 'watch',
      reasons: ['2 dependência(s) com vulnerabilidade conhecida', 'Nota baixa (3)'],
    });
    expect(attentionOf(base({ vulnerabilities: 7, runtimeEol: true, score: 3 }), NOW)).toEqual({
      level: 'attention',
      reasons: ['7 dependência(s) com vulnerabilidade conhecida', 'Runtime fora de suporte (EOL)', 'Nota baixa (3)'],
    });
  });
});
