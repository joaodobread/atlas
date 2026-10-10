import { useEffect, useMemo, useState } from 'react';
import type { DocumentDetail } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export function useDocumentViewerViewModel() {
  const target = useUiStore((s) => s.docViewer);
  const openDocument = useUiStore((s) => s.openDocument);
  const focus = useUiStore((s) => s.focus);
  const select = useUiStore((s) => s.select);
  const index = useGraphStore((s) => s.index);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDoc(null);
    setError(null);
    DocumentApi.getInstance()
      .get(target.documentId)
      .then(setDoc)
      .catch((err) => setError(errorMessage(err)));
  }, [target?.documentId]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        openDocument(null);
      }
    };
    // Captura: fecha o visualizador antes do Esc global (que sairia do foco).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, openDocument]);

  const lines = useMemo(() => (doc ? doc.content.replace(/\r\n?/g, '\n').split('\n') : []), [doc]);

  const mentionedNodes = useMemo(() => {
    if (!doc) return [];
    const ids = [...new Set(doc.mentions.map((m) => m.node_id))];
    return ids.flatMap((id) => {
      const n = index.node(id);
      return n ? [{ id, name: n.name, path: index.path(id) }] : [];
    });
  }, [doc, index]);

  return {
    open: target != null,
    doc,
    error,
    lines,
    isHighlighted: (line: number) => target?.startLine != null && line >= target.startLine && line <= (target.endLine ?? target.startLine),
    firstHighlightedLine: target?.startLine ?? null,
    mentionedNodes,
    close: () => openDocument(null),
    focusNode: (id: number) => {
      select({ type: 'node', id });
      focus(id);
      openDocument(null);
    },
  };
}
