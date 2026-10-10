import type { QualityReport, RepoAnalysis, RepoFacts, RepoMetricsSnapshot } from '../../../shared/types.ts';

const STATUS_LABEL = { pass: 'passou', fail: 'falhou', warn: 'atenção', na: 'n/a', unknown: 'desconhecido' } as const;

/** Markdown de um repositório para o RAG: o que é, como se comunica, dados e scorecard. */
export function repoMarkdown(p: {
  owner: string;
  name: string;
  htmlUrl: string | null;
  sha: string;
  facts: RepoFacts;
  analysis: RepoAnalysis;
  quality: QualityReport;
  metrics: RepoMetricsSnapshot | null;
}): string {
  const { facts: f, analysis: a, quality: q } = p;
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (nada identificado)');
  const lines = [
    `# ${p.name} (repositório ${p.owner}/${p.name})`,
    '',
    `**O que é:** ${a.purpose}`,
    '',
    `**Stack:** ${a.stack}`,
    '',
    `**Onde roda:** ${a.deploy}`,
    '',
    `Fonte: ${p.htmlUrl ?? `github.com/${p.owner}/${p.name}`} (commit ${p.sha.slice(0, 7)}). Análise ${a.method === 'llm' ? 'feita com LLM' : 'heurística (sem LLM)'}.`,
    '',
    '## Entradas (quem chama / o que consome)',
    '',
    list(a.inbound),
    '',
    '## Saídas (o que chama / publica)',
    '',
    list(a.outbound),
    '',
    '## Dados',
    '',
    list(a.data),
  ];
  if (a.notes.length) lines.push('', '## Observações', '', list(a.notes));
  lines.push(
    '',
    '## Fatos do repositório',
    '',
    `- Tipo: ${f.appType}`,
    `- Linguagens: ${f.languages.join(', ') || '?'}`,
    `- Frameworks: ${f.frameworks.join(', ') || '?'}`,
    `- Runtime: ${f.runtime ? `${f.runtime.name} ${f.runtime.version}` : '?'}`,
    `- Deploy: ${f.deploy.join('; ') || '?'}`,
    `- CI: ${f.workflows.join(', ') || 'nenhum workflow'}`,
  );
  if (f.resources.length) lines.push(`- Recursos AWS citados: ${f.resources.map((r) => `${r.type} ${r.name}`).join(', ')}`);
  if (f.hosts.length) lines.push(`- Hosts citados: ${f.hosts.join(', ')}`);
  if (f.envVars.length) lines.push(`- Variáveis de ambiente: ${f.envVars.join(', ')}`);
  lines.push('', `## Qualidade (${q.score ?? '—'}/10, confiança ${Math.round(q.confidence * 100)}%)`, '');
  for (const c of q.categories) {
    lines.push(`### ${c.label}: ${c.score ?? '—'}`, '');
    for (const ch of c.checks) lines.push(`- ${STATUS_LABEL[ch.status]} — ${ch.id}: ${ch.detail}${ch.fix ? ` Correção: ${ch.fix}` : ''}`);
    lines.push('');
  }
  if (p.metrics) lines.push(`Métricas do CI recebidas em ${p.metrics.receivedAt}${p.metrics.runUrl ? ` (${p.metrics.runUrl})` : ''}.`);
  return `${lines.join('\n').trim()}\n`;
}
