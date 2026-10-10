import type { NodeKind } from '../../shared/constants.ts';
import type { Point } from './orthogonalRouting.ts';

export interface LayeredNode {
  id: number;
  parentId: number | null;
  kind: NodeKind;
}

export interface LayeredEdge {
  source: number;
  target: number;
}

/** Colunas do diagrama, da esquerda para a direita. */
export const LAYERS = ['Consumidores', 'Serviço principal', 'Serviços internos', 'Dados, filas e infra', 'Externos'] as const;
type Layer = 0 | 1 | 2 | 3 | 4;

export interface LayeredResult {
  positions: Map<number, Point>;
  /** Título e x de cada coluna usada (para desenhar o cabeçalho). */
  columns: Array<{ title: string; x: number; top: number }>;
}

/** Espaçamentos em unidades do mundo (a cena 2D escala tudo junto com o zoom). */
export const LAYER_SPACING = {
  column: 27,
  subColumn: 24,
  row: 6,
  indent: 3,
  maxRows: 12,
};

/**
 * Layout de arquitetura em colunas, determinístico (não se mexe sozinho):
 * consumidores → serviço(s) principal(is) com seus módulos em árvore → serviços internos → dados/infra → externos.
 * Dentro das colunas, a ordem segue a média da posição dos vizinhos (barycenter) para reduzir cruzamentos.
 */
export class LayeredLayout {
  compute(nodes: readonly LayeredNode[], edges: readonly LayeredEdge[]): LayeredResult {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<number, LayeredNode[]>();
    const roots: LayeredNode[] = [];
    for (const n of nodes) {
      if (n.parentId != null && byId.has(n.parentId)) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);
      else roots.push(n);
    }
    const rootOf = new Map<number, number>();
    const markRoot = (n: LayeredNode, root: number) => {
      rootOf.set(n.id, root);
      for (const c of childrenOf.get(n.id) ?? []) markRoot(c, root);
    };
    for (const r of roots) markRoot(r, r.id);

    // Arestas entre raízes (as de módulos contam para a raiz deles).
    const neighbors = new Map<number, Set<number>>();
    const indeg = new Map<number, number>();
    const outdeg = new Map<number, number>();
    for (const e of edges) {
      const s = rootOf.get(e.source);
      const t = rootOf.get(e.target);
      if (s == null || t == null || s === t) continue;
      neighbors.set(s, (neighbors.get(s) ?? new Set()).add(t));
      neighbors.set(t, (neighbors.get(t) ?? new Set()).add(s));
      outdeg.set(s, (outdeg.get(s) ?? 0) + 1);
      indeg.set(t, (indeg.get(t) ?? 0) + 1);
    }

    // Serviço(s) principal(is): raiz com mais conexões (e as que estiverem expandidas).
    const degree = (id: number) => neighbors.get(id)?.size ?? 0;
    const maxDegree = Math.max(0, ...roots.map((r) => degree(r.id)));
    const isHub = (r: LayeredNode) => degree(r.id) === maxDegree && maxDegree > 0;

    const layerOf = (r: LayeredNode): Layer => {
      if (isHub(r)) return 1;
      if (r.kind === 'database' || r.kind === 'queue' || r.kind === 'infra') return 3;
      const onlyOutgoing = (outdeg.get(r.id) ?? 0) > 0 && (indeg.get(r.id) ?? 0) === 0;
      if (onlyOutgoing && r.kind !== 'external') return 0;
      if (r.kind === 'external') return onlyOutgoing ? 0 : 4;
      return 2;
    };

    const layers: LayeredNode[][] = [[], [], [], [], []];
    for (const r of roots) layers[layerOf(r)]!.push(r);

    // Linhas: a coluna principal define a ordem; as outras seguem a média dos vizinhos.
    const rowOf = new Map<number, number>();
    const order = (list: LayeredNode[]) => {
      const scored = list.map((r, i) => {
        const rows = [...(neighbors.get(r.id) ?? [])].map((n) => rowOf.get(n)).filter((x): x is number => x != null);
        return { r, i, score: rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY };
      });
      scored.sort((a, b) => a.score - b.score || a.i - b.i);
      return scored.map((s) => s.r);
    };

    // A coluna principal vira uma lista em árvore (raiz seguida dos filhos, indentados).
    const flatten = (r: LayeredNode, depth: number, out: Array<{ n: LayeredNode; depth: number }>) => {
      out.push({ n: r, depth });
      for (const c of childrenOf.get(r.id) ?? []) flatten(c, depth + 1, out);
      return out;
    };

    const positions = new Map<number, Point>();
    const columns: LayeredResult['columns'] = [];
    let x = 0;
    const placeColumn = (layer: Layer, items: Array<{ n: LayeredNode; depth: number }>) => {
      if (!items.length) return;
      const { row, subColumn, indent, maxRows, column } = LAYER_SPACING;
      const perColumn = Math.min(maxRows, Math.max(1, Math.ceil(items.length / Math.ceil(items.length / maxRows))));
      const subColumns = Math.ceil(items.length / perColumn);
      const height = (Math.min(items.length, perColumn) - 1) * row;
      items.forEach((it, i) => {
        const col = Math.floor(i / perColumn);
        const r = i % perColumn;
        const p = { x: x + col * subColumn + it.depth * indent, y: r * row - height / 2 };
        positions.set(it.n.id, p);
        rowOf.set(it.n.id, i);
      });
      columns.push({ title: LAYERS[layer], x, top: -height / 2 - row });
      x += (subColumns - 1) * subColumn + column;
    };

    // Ordem de cálculo: principal primeiro (âncora), depois as demais pela média dos vizinhos.
    const hubItems = layers[1]!.flatMap((r) => flatten(r, 0, []));
    hubItems.forEach((it, i) => rowOf.set(it.n.id, i));
    const ordered: Record<Layer, LayeredNode[]> = { 0: [], 1: layers[1]!, 2: [], 3: [], 4: [] };
    for (const l of [2, 3, 4, 0] as const) ordered[l] = order(layers[l]!);

    placeColumn(
      0,
      ordered[0].flatMap((r) => flatten(r, 0, [])),
    );
    placeColumn(1, hubItems);
    placeColumn(
      2,
      ordered[2].flatMap((r) => flatten(r, 0, [])),
    );
    placeColumn(
      3,
      ordered[3].flatMap((r) => flatten(r, 0, [])),
    );
    placeColumn(
      4,
      ordered[4].flatMap((r) => flatten(r, 0, [])),
    );

    return { positions, columns };
  }
}
