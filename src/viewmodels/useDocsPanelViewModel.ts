import { useEffect, useState } from 'react';
import { askSchema, searchQuerySchema } from '../../shared/schemas.ts';
import type { AskResult, SearchHit, SearchResult } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { resolveIcon } from '../domain/iconCatalog.ts';
import { KIND_COLOR } from '../domain/visual.ts';
import { useDocsStore } from '../stores/docsStore.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { GraphSync } from '../data/GraphSync.ts';

export type SearchMode = 'hybrid' | 'text' | 'semantic';

/** Busca nos documentos, pergunta ao LLM e destaque dos módulos afetados no grafo. */
export function useDocsPanelViewModel() {
  const index = useGraphStore((s) => s.index);
  const llm = useDocsStore((s) => s.llm);
  const status = useDocsStore((s) => s.status);
  const setSearchHighlight = useUiStore((s) => s.setSearchHighlight);
  const openDocument = useUiStore((s) => s.openDocument);
  const focus = useUiStore((s) => s.focus);
  const select = useUiStore((s) => s.select);
  const pushToast = useUiStore((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void DocsSync.getInstance()
      .reload()
      .catch((err) => pushToast('error', errorMessage(err)));
  }, [pushToast]);

  // Ao sair do painel, tira o destaque do grafo.
  useEffect(() => () => setSearchHighlight(null), [setSearchHighlight]);

  const highlight = (ids: number[]) => setSearchHighlight(ids.length ? ids : null);

  const search = async () => {
    const parsed = searchQuerySchema.safeParse({ q: query, mode });
    if (!parsed.success) return setError(errorMessage(parsed.error));
    setError(null);
    setSearching(true);
    setAnswer(null);
    try {
      const r = await DocumentApi.getInstance().search(parsed.data);
      setResult(r);
      highlight(r.affectedNodes.map((a) => a.nodeId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const ask = async () => {
    const parsed = askSchema.safeParse({ question: query });
    if (!parsed.success) return setError(errorMessage(parsed.error));
    setError(null);
    setAsking(true);
    try {
      const a = await DocumentApi.getInstance().ask(parsed.data);
      setAnswer(a);
      setResult({ query, mode: 'hybrid', hits: a.sources, affectedNodes: a.affectedNodes, semanticUnavailable: false });
      highlight(a.affectedNodes.map((x) => x.nodeId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAsking(false);
    }
  };

  /** Foca um nó; se ele for de outro grafo, abre esse grafo antes. */
  const focusAnywhere = async (nodeId: number) => {
    if (!index.node(nodeId)) {
      const node = await NodeApi.getInstance().get(nodeId);
      await GraphSync.getInstance().open(node.graph_id);
    }
    select({ type: 'node', id: nodeId });
    focus(nodeId);
  };

  const openSource = (hit: SearchHit) => {
    if (hit.nodeId != null) void focusAnywhere(hit.nodeId).catch((err) => setError(errorMessage(err)));
    else openDocument({ documentId: hit.documentId, startLine: hit.startLine, endLine: hit.endLine });
  };

  const describeNode = (id: number) => {
    const n = index.node(id);
    return n ? { id, name: n.name, path: index.path(id), icon: resolveIcon(n), color: KIND_COLOR[n.kind] } : null;
  };

  return {
    query,
    setQuery,
    mode,
    setMode,
    result,
    answer,
    searching,
    asking,
    error,
    llmConfigured: llm?.configured ?? false,
    llmLabel: llm?.configured ? `${llm.provider} · ${llm.model}` : null,
    noDocuments: status != null && status.documents === 0,
    search,
    ask,
    clear: () => {
      setResult(null);
      setAnswer(null);
      setQuery('');
      highlight([]);
    },
    affected: (result?.affectedNodes ?? []).flatMap((a) => {
      const n = describeNode(a.nodeId);
      return n ? [{ ...n, hits: a.hits }] : [];
    }),
    nodesOf: (hit: SearchHit) => hit.mentionedNodeIds.filter((id) => id !== hit.nodeId).flatMap((id) => describeNode(id) ?? []),
    /** Divide o snippet em partes marcadas ([[termo]]) e normais, para a View renderizar sem HTML cru. */
    snippetParts: (snippet: string) =>
      snippet
        .split(/(\[\[.*?\]\])/g)
        .filter(Boolean)
        .map((p) => (p.startsWith('[[') ? { mark: true, text: p.slice(2, -2) } : { mark: false, text: p })),
    /** Divide a resposta em texto e citações [n]. */
    answerParts: (text: string) =>
      text
        .split(/(\[\d+\])/g)
        .filter(Boolean)
        .map((p) => {
          const m = /^\[(\d+)\]$/.exec(p);
          return m ? { cite: Number(m[1]), text: p } : { cite: null, text: p };
        }),
    /** Trecho do modelo do grafo foca o nó; trecho de documento abre o visualizador. */
    openHit: (hit: SearchHit) => openSource(hit),
    openCitation: (n: number) => {
      const hit = answer?.sources[n - 1];
      if (hit) openSource(hit);
    },
    isModelHit: (hit: SearchHit) => hit.nodeId != null,
    focusNode: (id: number) => {
      select({ type: 'node', id });
      focus(id);
    },
  };
}
