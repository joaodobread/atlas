import type { AttentionLevel, RepoActivity, RepoAttention } from './types.ts';

const DAY = 24 * 3600 * 1000;
const MONTH = 30.44 * DAY;

/** Limites da avaliação de saúde (meses sem commit, idade de PR, vulnerabilidades, nota). */
export const HEALTH_LIMITS = {
  idleWatchMonths: 6,
  idleAttentionMonths: 12,
  oldPrDays: 30,
  stalePrDays: 90,
  vulnAttention: 5,
  lowScore: 4,
};

export interface HealthInput {
  archived: boolean;
  pushedAt: string | null;
  activity: RepoActivity | null;
  vulnerabilities: number | null;
  runtimeEol: boolean | null;
  score: number | null;
}

/** Meses inteiros desde a data (null sem data). */
export const monthsSince = (iso: string | null, now = Date.now()): number | null => (iso ? Math.floor((now - Date.parse(iso)) / MONTH) : null);
export const daysSince = (iso: string, now = Date.now()): number => Math.floor((now - Date.parse(iso)) / DAY);

const RANK: Record<AttentionLevel, number> = { ok: 0, watch: 1, attention: 2 };

/** Repositório parado, PR esquecido, dependência vulnerável, runtime sem suporte ou nota baixa. Arquivado não pede atenção. */
export function attentionOf(r: HealthInput, now = Date.now()): RepoAttention {
  if (r.archived) return { level: 'ok', reasons: [] };
  const found: Array<[AttentionLevel, string]> = [];
  const idle = monthsSince(r.pushedAt, now);
  if (idle != null && idle >= HEALTH_LIMITS.idleWatchMonths)
    found.push([idle >= HEALTH_LIMITS.idleAttentionMonths ? 'attention' : 'watch', `Sem commits há ${idle} meses`]);

  const oldest = r.activity?.pulls[0];
  if (oldest && daysSince(oldest.createdAt, now) >= HEALTH_LIMITS.stalePrDays)
    found.push(['attention', `PR #${oldest.number} aberto há ${daysSince(oldest.createdAt, now)} dias`]);
  else if (r.activity && r.activity.oldPrs > 0) found.push(['watch', `${r.activity.oldPrs} PR(s) aberto(s) há mais de ${HEALTH_LIMITS.oldPrDays} dias`]);

  if (r.vulnerabilities)
    found.push([r.vulnerabilities >= HEALTH_LIMITS.vulnAttention ? 'attention' : 'watch', `${r.vulnerabilities} dependência(s) com vulnerabilidade conhecida`]);
  if (r.runtimeEol) found.push(['attention', 'Runtime fora de suporte (EOL)']);
  if (r.score != null && r.score < HEALTH_LIMITS.lowScore) found.push(['watch', `Nota baixa (${r.score})`]);

  const level = found.reduce<AttentionLevel>((acc, [l]) => (RANK[l] > RANK[acc] ? l : acc), 'ok');
  // Mais graves primeiro.
  return { level, reasons: found.sort((a, b) => RANK[b[0]] - RANK[a[0]]).map(([, why]) => why) };
}
