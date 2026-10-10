import { useEffect, useState } from 'react';
import type { NodeMention } from '../../shared/types.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

/** Documentos que mencionam o nó (para o painel de detalhes). */
export function useNodeMentionsViewModel(nodeId: number) {
  const openDocument = useUiStore((s) => s.openDocument);
  const graphVersion = useGraphStore((s) => s.index);
  const [mentions, setMentions] = useState<NodeMention[] | null>(null);

  useEffect(() => {
    let alive = true;
    DocumentApi.getInstance()
      .mentionsOfNode(nodeId)
      .then((m) => alive && setMentions(m))
      .catch(() => alive && setMentions([]));
    return () => {
      alive = false;
    };
  }, [nodeId, graphVersion]);

  return {
    mentions,
    fileName: (p: string) => p.split(/[\\/]/).pop() ?? p,
    open: (m: NodeMention) => openDocument({ documentId: m.documentId, startLine: m.startLine, endLine: m.endLine }),
  };
}
