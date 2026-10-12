import { MATURITY_LABELS, RISK_LABEL, RISK_LEVELS, SECURITY_AXES, SECURITY_AXIS_LABEL } from '../../shared/constants.ts';
import type {
  PortfolioPosture,
  PostureItem,
  RiskLevel,
  SecurityAxis,
  SecurityNarrative,
  SecurityPosture,
  SecurityReportRecord,
  SecurityRoadmapItem,
  SecurityTip,
} from '../../shared/types.ts';

export type ScoreBand = 'good' | 'mid' | 'bad' | 'none';

export const AXIS_LABEL = SECURITY_AXIS_LABEL;
export { MATURITY_LABELS, RISK_LABEL, RISK_LEVELS, SECURITY_AXES };

export const AXIS_HINT: Record<SecurityAxis, string> = {
  vulnerabilities: 'O que está exposto hoje: achados de SAST/DAST/SCA/segredos, dependências vulneráveis, runtime e SonarQube',
  pipeline: 'O que o CI previne: SAST, SCA, varredura de segredos, testes, cobertura e quality gate',
  supplyChain: 'Dependências e o próprio pipeline: lockfile, atualização automática, actions fixadas e permissões',
  governance: 'Como o código chega ao branch padrão: revisão, proteção do branch, donos e política de segurança',
};

export const STATUS_LABEL: Record<PostureItem['status'], string> = { pass: 'OK', fail: 'FALHA', warn: 'ALERTA', unknown: '?', na: 'N/A' };
export const HORIZON_LABEL: Record<SecurityRoadmapItem['horizon'], string> = { now: 'Agora', next: 'Próximo trimestre', later: 'Depois' };
export const EFFORT_LABEL: Record<SecurityTip['effort'], string> = { low: 'esforço baixo', medium: 'esforço médio', high: 'esforço alto' };

/** Faixa de cor de uma nota 0–100. */
export function scoreBand(score: number | null): ScoreBand {
  if (score == null) return 'none';
  return score >= 75 ? 'good' : score >= 50 ? 'mid' : 'bad';
}

/** Data e hora curtas (pt-BR); devolve o texto original se não for uma data. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export const riskRank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);

/** Vértices do radar (eixos em sentido horário a partir do topo), valores 0–100; null conta como 0. */
export function radarPoints(values: Array<number | null>, radius: number, cx: number, cy: number): Array<[number, number]> {
  return values.map((v, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / values.length;
    const r = (Math.max(0, Math.min(100, v ?? 0)) / 100) * radius;
    return [round(cx + r * Math.cos(angle)), round(cy + r * Math.sin(angle))];
  });
}

const round = (n: number) => Math.round(n * 10) / 10;
const score = (s: number | null) => (s == null ? '—' : `${s}/100`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function narrativeMd(n: SecurityNarrative): string[] {
  const out = ['## Resumo executivo', '', n.summary, ''];
  if (n.highlights.length) out.push('## Pontos fortes', '', ...n.highlights.map((h) => `- ${h}`), '');
  if (n.risks.length)
    out.push(
      '## Riscos',
      '',
      '| Severidade | Risco | Eixo | Evidência | Recomendação |',
      '| --- | --- | --- | --- | --- |',
      ...n.risks.map(
        (r) =>
          `| ${RISK_LABEL[r.severity]} | ${cell(r.title)}${r.repos.length ? ` (${cell(r.repos.join(', '))})` : ''} | ${AXIS_LABEL[r.axis]} | ${cell(r.evidence)} | ${cell(r.recommendation)} |`,
      ),
      '',
    );
  if (n.roadmap.length) {
    out.push('## Plano de ação', '');
    for (const h of ['now', 'next', 'later'] as const) {
      const items = n.roadmap.filter((r) => r.horizon === h);
      if (!items.length) continue;
      out.push(`### ${HORIZON_LABEL[h]}`, '', ...items.map((r) => `- **${r.action}** — ${r.impact} (${EFFORT_LABEL[r.effort]}, ${AXIS_LABEL[r.axis]})`), '');
    }
  }
  return out;
}

function tipsMd(tips: SecurityTip[], focus: string | null): string[] {
  return [
    `## Dicas${focus ? ` (foco: ${focus})` : ''}`,
    '',
    ...tips.flatMap((t, i) => [
      `### ${i + 1}. ${t.title}`,
      '',
      `*${AXIS_LABEL[t.axis]} · ${EFFORT_LABEL[t.effort]}*`,
      '',
      `**Por quê:** ${t.why}`,
      '',
      t.how,
      '',
    ]),
  ];
}

function generatedBy(r: SecurityReportRecord): string {
  const how = r.method === 'llm' ? `LLM${r.model ? ` (${r.model})` : ''}` : 'heurística (sem LLM)';
  return `_Gerado em ${formatWhen(r.createdAt)} por ${how}${r.createdBy ? `, a pedido de ${r.createdBy}` : ''}._`;
}

export interface MarkdownInput {
  posture: SecurityPosture | null;
  portfolio: PortfolioPosture | null;
  report: SecurityReportRecord | null;
  tips: SecurityReportRecord | null;
}

/** Relatório completo em Markdown (para compartilhar ou anexar). */
export function securityMarkdown({ posture: p, portfolio: pp, report, tips }: MarkdownInput): string {
  const out: string[] = [];
  if (p) {
    out.push(
      `# Relatório de segurança — ${p.owner}/${p.name}`,
      '',
      `- **Nota:** ${score(p.score)}`,
      `- **Risco:** ${RISK_LABEL[p.risk]}${p.riskReasons.length ? ` — ${p.riskReasons.join('; ')}` : ''}`,
      `- **Maturidade DevSecOps:** nível ${p.maturity.level} (${p.maturity.label})`,
      ...(p.maturity.next ? [`- **Para o nível ${p.maturity.next.level}:** ${p.maturity.next.missing.join(', ')}`] : []),
      '',
      '| Eixo | Nota |',
      '| --- | --- |',
      ...p.axes.map((a) => `| ${a.label} | ${score(a.score)} |`),
      '',
    );
    for (const a of p.axes) {
      if (!a.items.length) continue;
      out.push(`### ${a.label}`, '', ...a.items.map((i) => `- [${STATUS_LABEL[i.status]}] ${i.label}: ${i.detail}${i.fix ? ` → ${i.fix}` : ''}`), '');
    }
  } else if (pp) {
    out.push(
      '# Relatório de segurança — portfólio',
      '',
      `- **Repositórios analisados:** ${pp.analyzed} de ${pp.repos}`,
      `- **Nota média:** ${score(pp.score)}`,
      `- **Risco:** ${RISK_LEVELS.map((r) => `${pp.byRisk[r]} ${RISK_LABEL[r].toLowerCase()}`).join(', ')}`,
      `- **Achados do CI:** ${pp.findings.critical} críticos, ${pp.findings.high} altos, ${pp.findings.medium} médios; ${pp.vulnerableDependencies} dependência(s) vulnerável(is)`,
      '',
      '| Eixo | Média |',
      '| --- | --- |',
      ...SECURITY_AXES.map((a) => `| ${AXIS_LABEL[a]} | ${score(pp.axes[a])} |`),
      '',
      '## Adoção DevSecOps',
      '',
      '| Prática | Adoção |',
      '| --- | --- |',
      ...pp.adoption.map((a) => `| ${a.label} | ${a.measured ? `${a.adopted}/${a.measured} (${pctOf(a.adopted, a.measured)}%)` : '—'} |`),
      '',
      '## Repositórios',
      '',
      '| Repositório | Risco | Nota | Nível | Críticos | Altos |',
      '| --- | --- | --- | --- | --- | --- |',
      ...pp.rows.map((r) => `| ${r.owner}/${r.name} | ${RISK_LABEL[r.risk]} | ${score(r.score)} | ${r.level} | ${r.critical} | ${r.high} |`),
      '',
    );
  }
  if (report?.narrative) out.push(...narrativeMd(report.narrative), generatedBy(report), '');
  if (tips?.tips?.length) out.push(...tipsMd(tips.tips, tips.focus), generatedBy(tips), '');
  return out.join('\n').trimEnd() + '\n';
}
