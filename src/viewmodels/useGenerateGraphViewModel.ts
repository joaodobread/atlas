import { useEffect, useRef, useState } from 'react';
import type { AnalysisDepth } from '../../shared/constants.ts';
import { graphFromReposSchema } from '../../shared/schemas.ts';
import type { RepoIntrospectionSummary } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { GithubApi } from '../data/api/GithubApi.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

const RANK: Record<AnalysisDepth, number> = { fast: 0, medium: 1, full: 2 };
const POLL_MS = 2500;

export const DEPTH_OPTIONS: Array<{ depth: AnalysisDepth; label: string; description: string }> = [
  {
    depth: 'fast',
    label: 'Rápida',
    description: 'Só o essencial: o nó de cada repositório e os bancos, filas, infra e externos ligados a ele. Sem LLM, na hora.',
  },
  {
    depth: 'medium',
    label: 'Média',
    description: 'O LLM lê README e configurações de cada repositório: módulos, tudo com que ele se comunica e recursos descobertos.',
  },
  {
    depth: 'full',
    label: 'Completa',
    description: 'A média + varredura do código: módulos e cada chamada externa (HTTP, banco, fila, cache, SDKs) com o trecho de código que a faz.',
  },
];

type Phase = { type: 'form' } | { type: 'analyzing'; done: number; total: number } | { type: 'generating' };

/** Janela "Gerar grafo": escolhe nome e profundidade, analisa o que faltar e cria o grafo. */
export function useGenerateGraphViewModel(selected: RepoIntrospectionSummary[], onClose: () => void) {
  const pushToast = useUiStore((s) => s.pushToast);
  const showGraph = useUiStore((s) => s.showGraph);
  const expand = useUiStore((s) => s.expand);
  const [name, setName] = useState(selected.length === 1 ? selected[0]!.name : `${selected.length} repositórios`);
  const [depth, setDepth] = useState<AnalysisDepth>('medium');
  const [acknowledged, setAcknowledged] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>({ type: 'form' });
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    // StrictMode desmonta/remonta: o cleanup anterior marcou cancelado.
    cancelled.current = false;
    DocumentApi.getInstance()
      .llm()
      .then((l) => setLlmConfigured(l.configured))
      .catch(() => setLlmConfigured(false));
    return () => {
      cancelled.current = true;
    };
  }, []);

  const needsAnalysis = (d: AnalysisDepth) => (d === 'fast' ? [] : selected.filter((r) => !r.analysisDepth || RANK[r.analysisDepth] < RANK[d] || r.stale));

  /** Espera a fila terminar os repositórios pedidos. */
  const waitFor = async (names: string[]) => {
    for (;;) {
      if (cancelled.current) throw new Error('Cancelado');
      await new Promise((r) => setTimeout(r, POLL_MS));
      const list = (await GithubApi.getInstance().repos()).filter((r) => names.includes(r.name));
      const finished = list.filter((r) => r.status === 'done' || r.status === 'error');
      setPhase({ type: 'analyzing', done: finished.length, total: names.length });
      if (finished.length === names.length) {
        const failed = list.filter((r) => r.status === 'error');
        if (failed.length) throw new Error(`Falha ao analisar: ${failed.map((r) => `${r.name} (${r.error ?? 'erro'})`).join('; ')}`);
        // Concluídos com ressalva (ex.: LLM sem crédito → só heurística).
        for (const r of list.filter((x) => x.status === 'done' && x.error)) pushToast('info', `${r.name}: ${r.error}`);
        return;
      }
    }
  };

  const submit = async () => {
    setError(null);
    const parsed = graphFromReposSchema.safeParse({ name, depth, repoIds: selected.map((r) => r.id) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    try {
      const pending = needsAnalysis(depth);
      if (pending.length) {
        setPhase({ type: 'analyzing', done: 0, total: pending.length });
        await GithubApi.getInstance().introspect({ repos: pending.map((r) => r.name), depth, force: false });
        await waitFor(pending.map((r) => r.name));
      }
      setPhase({ type: 'generating' });
      const g = await GraphApi.getInstance().fromRepos(parsed.data);
      await GraphSync.getInstance().open(g.id);
      // Grafo recém-gerado abre todo expandido: o que interessa são os módulos e as conexões entre eles.
      const index = useGraphStore.getState().index;
      expand(index.nodes.filter((n) => index.hasChildren(n.id)).map((n) => n.id));
      pushToast('success', `Grafo “${g.name}” criado com ${g.nodeCount} nós`);
      onClose();
      showGraph();
    } catch (err) {
      setError(errorMessage(err));
      setPhase({ type: 'form' });
    }
  };

  const pending = needsAnalysis(depth);
  return {
    name,
    setName,
    depth,
    setDepth,
    options: DEPTH_OPTIONS,
    selectedNames: selected.map((r) => r.name),
    pendingCount: pending.length,
    llmConfigured,
    showLlmWarning: depth !== 'fast' && llmConfigured === false,
    showCostWarning: depth === 'full',
    acknowledged,
    setAcknowledged,
    phase,
    error,
    busy: phase.type !== 'form',
    canSubmit: phase.type === 'form' && name.trim().length > 0 && (depth !== 'full' || acknowledged),
    submit: () => void submit(),
    close: () => {
      cancelled.current = true;
      onClose();
    },
  };
}
