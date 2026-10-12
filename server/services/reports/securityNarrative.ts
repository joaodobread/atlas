import { MATURITY_LABELS, RISK_LABEL, RISK_LEVELS, SECURITY_AXES, SECURITY_AXIS_LABEL } from '../../../shared/constants.ts';
import type {
  PortfolioPosture,
  PostureItem,
  RepoAnalysis,
  RepoFacts,
  RiskLevel,
  SecurityAxis,
  SecurityNarrative,
  SecurityPosture,
  SecurityRisk,
  SecurityRoadmapItem,
  SecurityTip,
} from '../../../shared/types.ts';
import { describeSonar } from './SecurityPosture.ts';

type Effort = SecurityTip['effort'];

export const SECURITY_SYSTEM = `Você é especialista em segurança de aplicações e DevSecOps e escreve para quem gerencia times de engenharia.
Responda em português do Brasil, com linguagem clara e direta. Use somente as evidências recebidas: não invente CVEs, ferramentas,
números nem arquivos. "não verificado" significa falta de evidência, não falha; trate como lacuna de visibilidade.
Priorize pelo impacto real (exposição, explorabilidade) e dê recomendações acionáveis, específicas para a stack informada.`;

export const TIPS_SYSTEM = `${SECURITY_SYSTEM}
Agora escreva dicas práticas para o time aplicar: cada uma com o porquê (ligado à evidência) e o como (passos concretos,
nomes de ferramentas adequadas à stack e, quando ajudar, um trecho curto de configuração ou workflow). Se houver um foco pedido, siga-o.`;

const AXIS_ENUM = [...SECURITY_AXES];
const EFFORT_ENUM = ['low', 'medium', 'high'];

export const NARRATIVE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Resumo executivo em 3 a 6 frases: situação, principais riscos e o que fazer primeiro' },
    highlights: { type: 'array', items: { type: 'string' }, description: 'Pontos fortes comprovados' },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: [...RISK_LEVELS] },
          axis: { type: 'string', enum: AXIS_ENUM },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
          repos: { type: 'array', items: { type: 'string' }, description: 'Repositórios afetados (owner/nome); vazio no relatório de um repositório' },
        },
        required: ['title', 'severity', 'axis', 'evidence', 'recommendation', 'repos'],
        additionalProperties: false,
      },
    },
    roadmap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          horizon: { type: 'string', enum: ['now', 'next', 'later'], description: 'now = próximas 2 semanas, next = trimestre, later = depois' },
          action: { type: 'string' },
          impact: { type: 'string' },
          effort: { type: 'string', enum: EFFORT_ENUM },
          axis: { type: 'string', enum: AXIS_ENUM },
        },
        required: ['horizon', 'action', 'impact', 'effort', 'axis'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'highlights', 'risks', 'roadmap'],
  additionalProperties: false,
} as const;

export const TIPS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          axis: { type: 'string', enum: AXIS_ENUM },
          why: { type: 'string' },
          how: { type: 'string' },
          effort: { type: 'string', enum: EFFORT_ENUM },
        },
        required: ['title', 'axis', 'why', 'how', 'effort'],
        additionalProperties: false,
      },
    },
  },
  required: ['tips'],
  additionalProperties: false,
} as const;

/** Esforço típico para corrigir cada item. */
const EFFORT_OF: Record<string, Effort> = {
  codeowners: 'low',
  'security-policy': 'low',
  'update-automation': 'low',
  'lockfile-present': 'low',
  'token-permissions': 'low',
  'secret-scanning': 'low',
  'branch-protection': 'low',
  'pinned-actions': 'low',
  'dangerous-workflow': 'low',
  'env-committed': 'medium',
  'sast-in-pipeline': 'medium',
  'sca-in-pipeline': 'medium',
  'metrics-reported': 'medium',
  'lint-clean': 'medium',
  'binary-artifacts': 'medium',
  'review-coverage': 'medium',
  'direct-push-share': 'medium',
};
const effortOf = (id: string): Effort => EFFORT_OF[id] ?? 'high';

/** Prática → eixo (relatório do portfólio). */
const PRACTICE_AXIS: Record<string, SecurityAxis> = {
  ci: 'pipeline',
  sast: 'pipeline',
  secrets: 'pipeline',
  'deps-update': 'supplyChain',
  sca: 'pipeline',
  coverage: 'pipeline',
  review: 'governance',
  dast: 'pipeline',
  'quality-gate': 'pipeline',
  hardening: 'supplyChain',
  policy: 'governance',
};
const PRACTICE_LEVEL: Record<string, number> = { ci: 1, sast: 2, secrets: 2, 'deps-update': 2, sca: 3, coverage: 3, review: 3 };

interface Gap extends PostureItem {
  axis: SecurityAxis;
  severity: RiskLevel;
}

/** Itens que falharam ou estão em alerta, com severidade estimada. */
export function gapsOf(p: SecurityPosture): Gap[] {
  const out: Gap[] = [];
  for (const a of p.axes)
    for (const i of a.items) {
      if (i.status !== 'fail' && i.status !== 'warn') continue;
      let severity: RiskLevel;
      if (i.id === 'env-committed' || i.id === 'dangerous-workflow') severity = 'critical';
      else if (i.id === 'secrets-findings' || (i.id === 'sast-findings' && p.findings.total.critical)) severity = i.status === 'fail' ? 'critical' : 'high';
      else if (a.axis === 'vulnerabilities') severity = i.status === 'fail' ? 'high' : 'medium';
      else severity = i.status === 'fail' ? 'medium' : 'low';
      out.push({ ...i, axis: a.axis, severity });
    }
  const rank = (g: Gap) => RISK_LEVELS.indexOf(g.severity) * 3 + ['low', 'medium', 'high'].indexOf(effortOf(g.id));
  return out.toSorted((a, b) => rank(a) - rank(b));
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const scoreText = (s: number | null) => (s == null ? 'sem nota' : `${s}/100`);

/** Relatório sem LLM: os mesmos dados, em texto. */
export function heuristicNarrative(p: SecurityPosture): SecurityNarrative {
  const gaps = gapsOf(p);
  const graded = p.axes.filter((a) => a.score != null).toSorted((a, b) => a.score! - b.score!);
  const weakest = graded[0];
  const strongest = graded.at(-1);
  const summary = [
    `${p.owner}/${p.name} tem nota de segurança ${scoreText(p.score)}, risco ${RISK_LABEL[p.risk].toLowerCase()} e maturidade DevSecOps nível ${p.maturity.level} (${p.maturity.label}).`,
    p.riskReasons.length ? `Principais motivos: ${p.riskReasons.slice(0, 3).join('; ')}.` : 'Nenhum risco relevante encontrado nas evidências.',
    weakest && weakest.score! < strongest!.score! ? `O eixo mais fraco é ${weakest.label} (${weakest.score}/100).` : null,
    p.maturity.next?.missing.length ? `Para chegar ao nível ${p.maturity.next.level}: ${p.maturity.next.missing.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const highlights = p.axes
    .flatMap((a) => a.items.filter((i) => i.status === 'pass'))
    .slice(0, 6)
    .map((i) => `${i.label}: ${i.detail}`);
  const risks: SecurityRisk[] = gaps.slice(0, 10).map((g) => ({
    title: g.label,
    severity: g.severity,
    axis: g.axis,
    evidence: g.detail,
    recommendation: g.fix ?? 'Revise este item.',
    repos: [],
  }));
  const missing = new Set(p.maturity.next?.missing ?? []);
  const roadmap: SecurityRoadmapItem[] = gaps
    .filter((g) => g.fix)
    .slice(0, 10)
    .map((g) => ({
      horizon: g.severity === 'critical' || g.severity === 'high' || missing.has(g.label) ? 'now' : g.status === 'fail' ? 'next' : 'later',
      action: g.fix!,
      impact: `${g.label} (${SECURITY_AXIS_LABEL[g.axis]})`,
      effort: effortOf(g.id),
      axis: g.axis,
    }));
  return { summary, highlights, risks, roadmap };
}

/** Relatório consolidado sem LLM. */
export function heuristicPortfolioNarrative(pp: PortfolioPosture, postures: SecurityPosture[]): SecurityNarrative {
  const axes = SECURITY_AXES.filter((a) => pp.axes[a] != null).toSorted((a, b) => pp.axes[a]! - pp.axes[b]!);
  const common = MATURITY_LABELS.map((label, level) => ({ label, level, n: pp.byLevel[level] ?? 0 })).toSorted((a, b) => b.n - a.n)[0]!;
  const summary = [
    `${pp.analyzed} de ${pp.repos} repositório(s) analisado(s), nota média ${scoreText(pp.score)}.`,
    `Risco: ${RISK_LEVELS.map((r) => `${pp.byRisk[r]} ${RISK_LABEL[r].toLowerCase()}`).join(', ')}.`,
    `Achados abertos no CI: ${pp.findings.critical} crítico(s), ${pp.findings.high} alto(s); ${pp.vulnerableDependencies} dependência(s) vulnerável(is).`,
    pp.analyzed ? `A maioria está no nível ${common.level} de maturidade (${common.label}).` : null,
    axes.length ? `Eixo mais fraco: ${SECURITY_AXIS_LABEL[axes[0]!]} (${pp.axes[axes[0]!]}/100).` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const adoption = pp.adoption.filter((a) => a.measured);
  const highlights = adoption
    .filter((a) => pct(a.adopted, a.measured) >= 80)
    .map((a) => `${a.label}: ${a.adopted}/${a.measured} repositórios (${pct(a.adopted, a.measured)}%)`);
  const notAdopting = (id: string) =>
    postures.filter((p) => p.practices.some((x) => x.id === id && x.applicable && x.adopted === false)).map((p) => `${p.owner}/${p.name}`);
  const repoRisks: SecurityRisk[] = pp.rows
    .filter((r) => r.risk === 'critical' || r.risk === 'high')
    .slice(0, 10)
    .map((r) => ({
      title: `${r.owner}/${r.name}: risco ${RISK_LABEL[r.risk].toLowerCase()}`,
      severity: r.risk,
      axis: 'vulnerabilities',
      evidence: r.reasons.join('; '),
      recommendation: 'Trate os achados críticos e altos deste repositório primeiro.',
      repos: [`${r.owner}/${r.name}`],
    }));
  const lowAdoption = adoption.filter((a) => pct(a.adopted, a.measured) < 50).toSorted((a, b) => a.adopted / a.measured - b.adopted / b.measured);
  const practiceRisks: SecurityRisk[] = lowAdoption.slice(0, 6).map((a) => ({
    title: `Baixa adoção: ${a.label}`,
    severity: (PRACTICE_LEVEL[a.id] ?? 4) <= 2 ? 'high' : 'medium',
    axis: PRACTICE_AXIS[a.id]!,
    evidence: `Adotado em ${a.adopted} de ${a.measured} repositórios (${pct(a.adopted, a.measured)}%).`,
    recommendation: `Padronize ${a.label.toLowerCase()} num workflow reutilizável e aplique aos repositórios que faltam.`,
    repos: notAdopting(a.id).slice(0, 30),
  }));
  const roadmap: SecurityRoadmapItem[] = lowAdoption.slice(0, 8).map((a) => {
    const level = PRACTICE_LEVEL[a.id] ?? 4;
    return {
      horizon: level <= 2 ? 'now' : level === 3 ? 'next' : 'later',
      action: `Adotar ${a.label.toLowerCase()} nos ${a.measured - a.adopted} repositório(s) que faltam`,
      impact: `Leva a adoção de ${pct(a.adopted, a.measured)}% para 100%`,
      effort: a.measured - a.adopted > 10 ? 'high' : 'medium',
      axis: PRACTICE_AXIS[a.id]!,
    };
  });
  return { summary, highlights, risks: [...repoRisks, ...practiceRisks], roadmap };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Dicas sem LLM: as correções sugeridas dos itens com problema, filtradas pelo foco quando ele casa com algo. */
export function heuristicTips(postures: SecurityPosture[], focus: string | null): SecurityTip[] {
  const seen = new Set<string>();
  const gaps = postures
    .flatMap(gapsOf)
    .filter((g) => g.fix && !seen.has(g.id) && seen.add(g.id))
    .map((g) => ({ g, text: fold(`${g.label} ${g.detail} ${g.fix} ${SECURITY_AXIS_LABEL[g.axis]}`) }));
  const words = focus
    ? fold(focus)
        .split(/\W+/)
        .filter((w) => w.length >= 4)
    : [];
  const matched = words.length ? gaps.filter(({ text }) => words.some((w) => text.includes(w))) : [];
  return (matched.length ? matched : gaps).slice(0, 8).map(({ g }) => ({
    title: g.label,
    axis: g.axis,
    why: postures.length > 1 ? `${g.detail} (e possivelmente em outros repositórios)` : g.detail,
    how: g.fix!,
    effort: effortOf(g.id),
  }));
}

const STATUS_TEXT: Record<PostureItem['status'], string> = { pass: 'ok', fail: 'falha', warn: 'alerta', unknown: 'não verificado', na: 'não se aplica' };
const adoptedText = (a: boolean | null, applicable: boolean) => (!applicable ? 'não se aplica' : a == null ? 'não verificado' : a ? 'sim' : 'não');

/** Contexto de um repositório para o LLM. */
export function posturePrompt(p: SecurityPosture, facts: RepoFacts, analysis: RepoAnalysis | null, focus: string | null): string {
  const lines = [
    `Repositório: ${p.owner}/${p.name}`,
    `Tipo: ${facts.appType}; linguagens: ${facts.languages.join(', ') || '?'}; frameworks: ${facts.frameworks.join(', ') || '?'}`,
    facts.runtime ? `Runtime: ${facts.runtime.name} ${facts.runtime.version}` : null,
    facts.deploy.length ? `Deploy: ${facts.deploy.join(', ')}` : null,
    facts.workflows.length ? `Workflows: ${facts.workflows.join(', ')}` : null,
    analysis?.purpose ? `Propósito: ${analysis.purpose}` : null,
    '',
    `Nota de segurança: ${scoreText(p.score)}; risco ${RISK_LABEL[p.risk]}${p.riskReasons.length ? ` (${p.riskReasons.join('; ')})` : ''}`,
    `Maturidade DevSecOps: nível ${p.maturity.level} (${p.maturity.label})${p.maturity.next ? `; para o nível ${p.maturity.next.level} falta: ${p.maturity.next.missing.join(', ') || 'nada'}` : ''}`,
    '',
    ...p.axes.flatMap((a) => [
      `## ${a.label}: ${scoreText(a.score)}`,
      ...a.items.map((i) => `- [${STATUS_TEXT[i.status]}] ${i.label}: ${i.detail}${i.fix ? ` (sugestão: ${i.fix})` : ''}`),
    ]),
    '',
    `Achados do CI por origem: ${
      Object.entries(p.findings.bySource)
        .map(([k, c]) => `${k} ${c.critical}C/${c.high}A/${c.medium}M/${c.low}B`)
        .join(', ') || 'nenhum relatório'
    }`,
    p.findings.vulnerableDependencies != null ? `Dependências com vulnerabilidade conhecida (OSV): ${p.findings.vulnerableDependencies}` : null,
    facts.intel.vulnerabilities?.length
      ? `Exemplos: ${facts.intel.vulnerabilities
          .slice(0, 10)
          .map((v) => `${v.dependency} (${v.ids.slice(0, 3).join(', ')})`)
          .join('; ')}`
      : null,
    p.findings.sonar ? `SonarQube: ${describeSonar(p.findings.sonar)}` : null,
    p.findings.tools.length ? `Ferramentas que enviaram relatórios: ${p.findings.tools.join(', ')}` : null,
    `Práticas: ${p.practices.map((x) => `${x.label}: ${adoptedText(x.adopted, x.applicable)}`).join('; ')}`,
    focus ? `\nFoco pedido pelo usuário: ${focus}` : null,
  ];
  return lines.filter((l) => l != null).join('\n');
}

/** Contexto consolidado para o LLM: totais, adoção, falhas mais comuns e os repositórios mais arriscados. */
export function portfolioPrompt(pp: PortfolioPosture, postures: SecurityPosture[], focus: string | null): string {
  const common = new Map<string, { label: string; axis: SecurityAxis; repos: string[] }>();
  for (const p of postures)
    for (const g of gapsOf(p).filter((x) => x.status === 'fail')) {
      const e = common.get(g.id) ?? { label: g.label, axis: g.axis, repos: [] };
      e.repos.push(`${p.owner}/${p.name}`);
      common.set(g.id, e);
    }
  const lines = [
    `Repositórios: ${pp.repos} na lista, ${pp.analyzed} analisados. Nota média ${scoreText(pp.score)}.`,
    `Eixos (média): ${SECURITY_AXES.map((a) => `${SECURITY_AXIS_LABEL[a]} ${scoreText(pp.axes[a])}`).join('; ')}`,
    `Risco: ${RISK_LEVELS.map((r) => `${RISK_LABEL[r]} ${pp.byRisk[r]}`).join(', ')}`,
    `Maturidade: ${MATURITY_LABELS.map((l, i) => `nível ${i} (${l}) ${pp.byLevel[i] ?? 0}`).join(', ')}`,
    `Achados do CI: ${pp.findings.critical} críticos, ${pp.findings.high} altos, ${pp.findings.medium} médios, ${pp.findings.low} baixos; dependências vulneráveis: ${pp.vulnerableDependencies}`,
    '',
    '## Adoção das práticas',
    ...pp.adoption.map((a) => `- ${a.label}: ${a.measured ? `${a.adopted}/${a.measured} (${pct(a.adopted, a.measured)}%)` : 'não verificado'}`),
    '',
    '## Falhas mais comuns',
    ...[...common.values()]
      .toSorted((a, b) => b.repos.length - a.repos.length)
      .slice(0, 15)
      .map((c) => `- ${c.label} (${SECURITY_AXIS_LABEL[c.axis]}): ${c.repos.length} repositório(s), ex.: ${c.repos.slice(0, 5).join(', ')}`),
    '',
    '## Repositórios mais arriscados',
    ...pp.rows
      .slice(0, 30)
      .map(
        (r) =>
          `- ${r.owner}/${r.name}: risco ${RISK_LABEL[r.risk]}, nota ${scoreText(r.score)}, nível ${r.level}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}`,
      ),
    focus ? `\nFoco pedido pelo usuário: ${focus}` : null,
  ];
  return lines.filter((l) => l != null).join('\n');
}
