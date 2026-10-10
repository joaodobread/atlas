import type { AnalysisDepth, IntrospectionStage } from '../../shared/constants.ts';
import type { IntrospectionProgress, ResumableAnalysis } from '../../shared/types.ts';

/** Etapas por profundidade: rápida e média não leem o código. */
const STAGES: Record<AnalysisDepth, IntrospectionStage[]> = {
  fast: ['collecting', 'analyzing', 'scoring'],
  medium: ['collecting', 'analyzing', 'scoring'],
  full: ['collecting', 'analyzing', 'scanning', 'mapping', 'scoring'],
  max: ['collecting', 'analyzing', 'scanning', 'mapping', 'scoring'],
};

const LABEL: Record<IntrospectionStage, string> = {
  collecting: 'Coletando arquivos, dependências e PRs',
  analyzing: 'Analisando com o LLM',
  scanning: 'Lendo o código',
  mapping: 'Mapeando as chamadas com o LLM',
  scoring: 'Calculando a nota e o documento',
};

/** Unidade do contador de cada etapa contável. */
const UNIT: Partial<Record<IntrospectionStage, string>> = { scanning: 'arquivos', mapping: 'lotes' };

export interface ProgressRow {
  repo: string;
  /** "Etapa 3 de 5 · Lendo o código". */
  label: string;
  /** "120/300 arquivos" ou null. */
  counter: string | null;
  /** 0..100 dentro da etapa; null quando a etapa não é contável (barra indeterminada). */
  percent: number | null;
  /** Tempo total da análise deste repositório ("1:05"). */
  elapsed: string;
}

/** "m:ss" (ou "h:mm:ss"). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function describeProgress(p: IntrospectionProgress, now = Date.now()): ProgressRow {
  const stages = STAGES[p.depth];
  const index = Math.max(0, stages.indexOf(p.stage));
  const counted = p.total != null && p.done != null && p.total > 0;
  // Rápida não chama o LLM: a etapa de análise é só a heurística.
  const name = p.stage === 'analyzing' && p.depth === 'fast' ? 'Montando a proposta (heurística)' : LABEL[p.stage];
  return {
    repo: p.repo,
    label: `Etapa ${index + 1} de ${stages.length} · ${name}`,
    counter: counted ? `${p.done}/${p.total} ${UNIT[p.stage] ?? ''}`.trim() : null,
    percent: counted ? Math.min(100, Math.round((p.done! / p.total!) * 100)) : null,
    elapsed: formatElapsed(now - Date.parse(p.startedAt)),
  };
}

/** "Parou em: Lendo o código · 1200/5000 arquivos" (para o botão Retomar). */
export function describeResumable(r: ResumableAnalysis): string {
  const counter = r.done != null ? ` · ${r.done}${r.total != null ? `/${r.total}` : ''} ${UNIT[r.stage] ?? ''}`.trimEnd() : '';
  return `Parou em: ${LABEL[r.stage]}${counter}`;
}
