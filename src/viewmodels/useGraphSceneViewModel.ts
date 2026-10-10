import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '../domain/orthogonalRouting.ts';
import type { NodeKind } from '../../shared/constants.ts';
import { downloadBlob, snapshotSvg, svgToPng } from '../core/exportSvg.ts';
import { ForceLayout } from '../domain/ForceLayout.ts';
import { GroupLayout } from '../domain/GroupLayout.ts';
import { LayeredLayout } from '../domain/LayeredLayout.ts';
import type { VisibleEdge } from '../domain/GraphIndex.ts';
import { resolveIcon } from '../domain/iconCatalog.ts';
import { KIND_COLOR, KIND_LABEL, nodeRadius } from '../domain/visual.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export interface SceneNode {
  id: number;
  parentId: number | null;
  name: string;
  /** Caminho completo (útil para nós de contexto, que aparecem fora da hierarquia). */
  path: string;
  kind: NodeKind;
  kindLabel: string;
  tech: string | null;
  icon: string;
  r: number;
  color: string;
  /** Quantidade de descendentes escondidos (nó recolhido). */
  hiddenCount: number;
  /** Fora do foco; aparece só porque se comunica com ele. */
  isContext: boolean;
}

export interface SceneHighlight {
  nodes: Set<number>;
  connections: Set<number>;
}

/** ViewModel compartilhado pelas cenas 3D e 2D. */
export function useGraphSceneViewModel(dimensions: 2 | 3) {
  const index = useGraphStore((s) => s.index);
  const expanded = useUiStore((s) => s.expanded);
  const selection = useUiStore((s) => s.selection);
  const searchHighlight = useUiStore((s) => s.searchHighlight);
  const focusId = useUiStore((s) => s.focusId);
  const select = useUiStore((s) => s.select);
  const focus = useUiStore((s) => s.focus);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const fitRequest = useUiStore((s) => s.fitRequest);
  const magnet = useUiStore((s) => s.magnet);
  const reorganizeRequest = useUiStore((s) => s.reorganizeRequest);
  const exportRequest = useUiStore((s) => s.exportRequest);
  const pushToast = useUiStore((s) => s.pushToast);
  const layoutMode = useUiStore((s) => s.layoutMode);
  const [layout] = useState(() => new ForceLayout(dimensions));
  /** Posições ajustadas à mão no modo camadas (arrastar). */
  const manual = useRef(new Map<number, Point>());
  /** Incrementa quando o layout é recalculado (a cena 2D precisa re-renderizar). */
  const [layoutVersion, setLayoutVersion] = useState(0);

  const scene = useMemo(() => index.scene(expanded, focusId), [index, expanded, focusId]);

  const nodes = useMemo<SceneNode[]>(() => {
    // Profundidade relativa ao foco: o nó focado fica do tamanho de um projeto.
    const base = focusId != null && index.node(focusId) ? index.depth(focusId) : 0;
    return scene.entries.map(({ node: n, parentId, isContext }) => ({
      id: n.id,
      parentId,
      name: n.name,
      path: index.path(n.id),
      kind: n.kind,
      kindLabel: KIND_LABEL[n.kind],
      tech: n.tech,
      icon: resolveIcon(n),
      r: nodeRadius(isContext ? 1 : Math.max(0, index.depth(n.id) - base)),
      color: KIND_COLOR[n.kind],
      hiddenCount: expanded.has(n.id) ? 0 : index.subtree(n.id).size - 1,
      isContext,
    }));
  }, [scene, index, expanded, focusId]);

  const edges = scene.edges;

  // Só a estrutura importa para o layout: renomear, trocar ícone etc. não pode mexer nas posições.
  const structureKey = useMemo(
    () => `${nodes.map((n) => `${n.id}:${n.parentId ?? ''}:${n.r.toFixed(2)}`).join('|')}#${edges.map((e) => e.key).join('|')}`,
    [nodes, edges],
  );
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };

  // Forças só no 3D e no modo livre: Infra/Camadas têm layout próprio e a simulação (cara em grafos grandes) seria desperdício.
  const usesForces = dimensions === 3 || layoutMode === 'free';

  // Mantém o layout em dia com a estrutura visível (antes do próximo frame).
  useLayoutEffect(() => {
    if (!usesForces) return;
    const { nodes: ns, edges: es } = latest.current;
    layout.update(
      ns.map((n) => ({ id: n.id, parentId: n.parentId, r: n.r })),
      es.map((e) => ({ source: e.source, target: e.target })),
    );
    setLayoutVersion((x) => x + 1);
  }, [layout, structureKey, usesForces]);

  // "Reorganizar" (barra da cena): solta nós arrastados.
  useEffect(() => {
    if (!reorganizeRequest) return;
    layout.unpinAll();
    manual.current.clear();
    setLayoutVersion((x) => x + 1);
  }, [layout, reorganizeRequest]);

  /** Diagrama em colunas (só 2D): posições fixas recalculadas quando a estrutura muda. */
  const layered = useMemo(
    () => (dimensions === 2 && layoutMode === 'layers' ? new LayeredLayout().compute(latest.current.nodes, latest.current.edges) : null),
    [dimensions, layoutMode, structureKey],
  );

  /** Caixas aninhadas pela hierarquia (só 2D): contas → VPCs → subnets → serviços. */
  const grouped = useMemo(
    () => (dimensions === 2 && layoutMode === 'groups' ? new GroupLayout().compute(latest.current.nodes) : null),
    [dimensions, layoutMode, structureKey],
  );

  const highlight = useMemo<SceneHighlight | null>(() => {
    const visible = new Set(nodes.map((n) => n.id));
    const repOf = (id: number) => [id, ...index.ancestors(id).map((a) => a.id)].find((x) => visible.has(x));
    if (!selection && searchHighlight?.size) {
      // Busca em documentos: destaca os nós mencionados e as conexões entre eles.
      const nodesSet = new Set<number>();
      for (const id of searchHighlight) {
        const rep = repOf(id);
        if (rep != null) nodesSet.add(rep);
      }
      const connections = new Set(index.connections.filter((c) => searchHighlight.has(c.source_id) && searchHighlight.has(c.target_id)).map((c) => c.id));
      return { nodes: nodesSet, connections };
    }
    if (!selection) return null;
    const connections = new Set<number>();
    const nodesSet = new Set<number>();
    const addEndpoints = (connectionId: number) => {
      const e = edges.find((x) => x.connectionIds.includes(connectionId));
      if (!e) return;
      nodesSet.add(e.source);
      nodesSet.add(e.target);
    };
    if (selection.type === 'node') {
      const tree = index.subtree(selection.id);
      for (const c of index.connections) {
        if (tree.has(c.source_id) || tree.has(c.target_id)) {
          connections.add(c.id);
          addEndpoints(c.id);
        }
      }
      // O nó selecionado (ou o ancestral visível que o representa).
      const rep = repOf(selection.id);
      if (rep != null) nodesSet.add(rep);
    } else {
      const conn = index.connection(selection.id);
      if (!conn) return null;
      const related = [conn, ...index.implementations(conn.id)];
      let parent = conn.parent_connection_id != null ? index.connection(conn.parent_connection_id) : undefined;
      while (parent) {
        related.push(parent);
        parent = parent.parent_connection_id != null ? index.connection(parent.parent_connection_id) : undefined;
      }
      for (const c of related) {
        connections.add(c.id);
        addEndpoints(c.id);
      }
    }
    return { nodes: nodesSet, connections };
  }, [selection, searchHighlight, index, nodes, edges]);

  return {
    layout,
    layoutVersion,
    nodes,
    edges,
    highlight,
    fitRequest,
    magnet,
    exportRequest,
    /** Gera o arquivo a partir do SVG da cena e baixa. */
    exportDiagram: async (svg: SVGSVGElement, format: 'png' | 'svg') => {
      try {
        const snap = snapshotSvg(svg);
        const name = `comm-graph-${new Date().toISOString().slice(0, 10)}`;
        if (format === 'svg') downloadBlob(new Blob([snap.markup], { type: 'image/svg+xml' }), `${name}.svg`);
        else downloadBlob(await svgToPng(snap), `${name}.png`);
      } catch (err) {
        pushToast('error', `Não foi possível exportar: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    layered,
    grouped,
    manualPositions: manual.current,
    selectedNodeId: selection?.type === 'node' ? selection.id : null,
    isEdgeHighlighted: (e: VisibleEdge) => !highlight || e.connectionIds.some((id) => highlight.connections.has(id)),
    isNodeHighlighted: (id: number) => !highlight || highlight.nodes.has(id),
    edgeLabel: (e: VisibleEdge) => {
      const protocols = new Set(e.connectionIds.map((id) => index.connection(id)?.protocol).filter(Boolean));
      return `${[...protocols].join(', ')}${e.connectionIds.length > 1 ? ` ×${e.connectionIds.length}` : ''}`;
    },
    /** Clique num nó: seleciona e foca nele. */
    activateNode: (id: number) => {
      select({ type: 'node', id });
      if (id !== focusId) focus(id);
    },
    selectEdge: (e: VisibleEdge) => select({ type: 'connection', id: e.connectionIds[0]! }),
    toggleExpanded,
    clearSelection: () => select(null),
  };
}

export type GraphSceneViewModel = ReturnType<typeof useGraphSceneViewModel>;
