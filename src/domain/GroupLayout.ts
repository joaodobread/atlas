import type { NodeKind } from '../../shared/constants.ts';
import type { Point } from './orthogonalRouting.ts';

export interface GroupedNode {
  id: number;
  parentId: number | null;
  kind: NodeKind;
}

/** Caixa de um nó expandido (com filhos visíveis), em unidades do mundo. */
export interface GroupBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 = raiz. */
  depth: number;
}

export interface GroupResult {
  /** Folhas: centro do ícone. Caixas: ponto do ícone no título (onde chegam as conexões ligadas à caixa). */
  positions: Map<number, Point>;
  /** Caixas na ordem de desenho (pais antes dos filhos). */
  boxes: GroupBox[];
}

/** Dimensões em unidades do mundo (a cena 2D escala tudo com o zoom). */
export const GROUP_SPACING = {
  /** Célula de uma folha: ícone em cima, rótulos embaixo. */
  leafW: 17,
  leafH: 11,
  pad: 2,
  title: 4.5,
  gap: 3,
  /** Distância entre as raízes. */
  rootGap: 10,
  /** Proporção (largura/altura) alvo do conjunto de raízes: parecida com uma tela. */
  rootAspect: 1.6,
};

interface Block {
  w: number;
  h: number;
  place(x: number, y: number): void;
}

/**
 * Layout de "infra": cada nó expandido vira uma caixa que contém os filhos (como contas → VPCs → subnets → clusters).
 * Folhas ficam numa grade dentro da caixa; subcaixas são empacotadas em linhas. As raízes ficam lado a lado.
 * Determinístico: segue a ordem dos nós (a ordem de criação).
 */
export class GroupLayout {
  compute(nodes: readonly GroupedNode[]): GroupResult {
    const S = GROUP_SPACING;
    const ids = new Set(nodes.map((n) => n.id));
    const childrenOf = new Map<number | null, GroupedNode[]>();
    for (const n of nodes) {
      const parent = n.parentId != null && ids.has(n.parentId) ? n.parentId : null;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), n]);
    }
    const positions = new Map<number, Point>();
    const boxes: GroupBox[] = [];

    const leafGrid = (leaves: GroupedNode[]): Block => {
      // Grade mais larga que alta (as caixas ficam "deitadas", como num diagrama).
      const cols = Math.min(leaves.length, Math.max(1, Math.ceil(Math.sqrt(leaves.length * 1.6))));
      const rows = Math.ceil(leaves.length / cols);
      return {
        w: cols * S.leafW,
        h: rows * S.leafH,
        place: (x, y) =>
          leaves.forEach((n, i) => positions.set(n.id, { x: x + (i % cols) * S.leafW + S.leafW / 2, y: y + Math.floor(i / cols) * S.leafH + S.leafH * 0.3 })),
      };
    };

    /** Empacota blocos em linhas, quebrando numa largura que deixa o conjunto perto da proporção pedida. */
    const pack = (blocks: Block[], gap = S.gap, aspect = 1.5): Block => {
      if (!blocks.length) return { w: 0, h: 0, place: () => {} };
      const area = blocks.reduce((a, b) => a + (b.w + gap) * (b.h + gap), 0);
      const maxW = Math.max(...blocks.map((b) => b.w), Math.sqrt(area * aspect));
      const rows: Array<{ items: Block[]; w: number; h: number }> = [];
      for (const b of blocks) {
        const row = rows.at(-1);
        if (row && row.w + gap + b.w <= maxW + 1e-6) {
          row.items.push(b);
          row.w += gap + b.w;
          row.h = Math.max(row.h, b.h);
        } else rows.push({ items: [b], w: b.w, h: b.h });
      }
      return {
        w: Math.max(...rows.map((r) => r.w)),
        h: rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1),
        place: (x, y) => {
          let cy = y;
          for (const r of rows) {
            let cx = x;
            for (const b of r.items) {
              b.place(cx, cy);
              cx += b.w + gap;
            }
            cy += r.h + gap;
          }
        },
      };
    };

    /** Folhas agrupadas numa grade antes das subcaixas. */
    const content = (children: GroupedNode[], depth: number): Block[] => {
      const leaves = children.filter((c) => !childrenOf.has(c.id));
      const groups = children.filter((c) => childrenOf.has(c.id));
      return [...(leaves.length ? [leafGrid(leaves)] : []), ...groups.map((g) => box(g, depth))];
    };

    const box = (n: GroupedNode, depth: number): Block => {
      const inner = pack(content(childrenOf.get(n.id) ?? [], depth + 1));
      const w = Math.max(inner.w, S.leafW * 1.5) + S.pad * 2;
      const h = inner.h + S.title + S.pad * 2;
      return {
        w,
        h,
        place: (x, y) => {
          boxes.push({ id: n.id, x, y, w, h, depth });
          positions.set(n.id, { x: x + 2.3, y: y + 2.2 });
          inner.place(x + S.pad, y + S.title + S.pad);
        },
      };
    };

    // Raízes em linhas (folhas soltas numa grade só), quebrando para o conjunto ficar com cara de tela
    // em vez de uma faixa comprida.
    pack(content(childrenOf.get(null) ?? [], 0), S.rootGap, S.rootAspect).place(0, 0);
    return { positions, boxes };
  }
}
