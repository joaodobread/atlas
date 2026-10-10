import { describe, expect, it } from 'vitest';
import { GROUP_SPACING as S, GroupLayout, type GroupedNode } from './GroupLayout.ts';

const n = (id: number, parentId: number | null = null): GroupedNode => ({ id, parentId, kind: 'infra' });

describe('GroupLayout', () => {
  it('vazio', () => {
    expect(new GroupLayout().compute([])).toEqual({ positions: new Map(), boxes: [] });
  });

  it('folhas soltas na raiz ficam numa grade só', () => {
    const { positions, boxes } = new GroupLayout().compute([n(1), n(2), n(3)]);
    expect(boxes).toEqual([]);
    // 3 folhas -> ceil(sqrt(4.8)) = 3 colunas.
    expect(positions.get(1)).toEqual({ x: S.leafW / 2, y: S.leafH * 0.3 });
    expect(positions.get(3)).toEqual({ x: 2 * S.leafW + S.leafW / 2, y: S.leafH * 0.3 });
  });

  it('caixas aninhadas: pais antes dos filhos, filhos dentro do pai', () => {
    // 1 conta -> 2 VPC -> folhas 4,5 ; 1 -> folha 3 ; raiz 6 com folha 7; folha 8 com pai inexistente.
    const nodes = [n(1), n(2, 1), n(3, 1), n(4, 2), n(5, 2), n(6), n(7, 6), n(8, 77)];
    const { positions, boxes } = new GroupLayout().compute(nodes);
    expect(boxes.map((b) => [b.id, b.depth])).toEqual([
      [1, 0],
      [2, 1],
      [6, 0],
    ]);
    const [b1, b2, b6] = boxes;
    // Folha solta (8) vem primeiro, na grade da raiz.
    expect(positions.get(8)).toEqual({ x: S.leafW / 2, y: S.leafH * 0.3 });
    expect(b1!.x).toBe(S.leafW + S.rootGap);
    expect(b1!.y).toBe(0);
    expect(positions.get(1)).toEqual({ x: b1!.x + 2.3, y: b1!.y + 2.2 });
    // Filho dentro do pai.
    expect(b2!.x).toBeGreaterThanOrEqual(b1!.x + S.pad);
    expect(b2!.y).toBeGreaterThanOrEqual(b1!.y + S.title + S.pad);
    expect(b2!.x + b2!.w).toBeLessThanOrEqual(b1!.x + b1!.w + 1e-9);
    expect(b2!.y + b2!.h).toBeLessThanOrEqual(b1!.y + b1!.h + 1e-9);
    for (const id of [4, 5]) {
      const p = positions.get(id)!;
      expect(p.x).toBeGreaterThan(b2!.x);
      expect(p.x).toBeLessThan(b2!.x + b2!.w);
      expect(p.y).toBeGreaterThan(b2!.y);
    }
    // A conta 1 é larga: a raiz 6 quebra para a linha de baixo.
    expect(b6!.x).toBe(0);
    expect(b6!.y).toBe(b1!.h + S.rootGap);
    // Caixa com uma folha tem largura mínima.
    expect(b6!.w).toBe(S.leafW * 1.5 + S.pad * 2);
    expect(b6!.h).toBe(S.leafH + S.title + S.pad * 2);
  });

  it('muitas subcaixas quebram em linhas', () => {
    const nodes: GroupedNode[] = [n(1)];
    for (let i = 0; i < 6; i++) {
      nodes.push(n(10 + i, 1), n(100 + i, 10 + i));
    }
    const { boxes } = new GroupLayout().compute(nodes);
    const inner = boxes.filter((b) => b.depth === 1);
    expect(inner).toHaveLength(6);
    expect(new Set(inner.map((b) => b.y)).size).toBeGreaterThan(1);
    const root = boxes[0];
    for (const b of inner) expect(b.x + b.w).toBeLessThanOrEqual(root.x + root.w + 1e-9);
  });

  it('muitas raízes formam linhas com proporção de tela, não uma faixa', () => {
    const nodes: GroupedNode[] = [];
    for (let i = 0; i < 20; i++) nodes.push(n(i + 1), n(100 + i, i + 1));
    const { boxes } = new GroupLayout().compute(nodes);
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    expect(new Set(boxes.map((b) => b.y)).size).toBeGreaterThan(1);
    expect(right / bottom).toBeGreaterThan(1);
    expect(right / bottom).toBeLessThan(S.rootAspect * 1.5);
  });
});
