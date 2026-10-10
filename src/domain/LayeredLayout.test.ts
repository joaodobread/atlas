import { describe, expect, it } from 'vitest';
import { LAYER_SPACING, LAYERS, LayeredLayout, type LayeredNode } from './LayeredLayout.ts';

const n = (id: number, kind: LayeredNode['kind'], parentId: number | null = null): LayeredNode => ({ id, kind, parentId });

describe('LayeredLayout', () => {
  it('vazio', () => {
    expect(new LayeredLayout().compute([], [])).toEqual({ positions: new Map(), columns: [] });
  });

  it('distribui raízes nas colunas por papel', () => {
    const nodes = [
      n(1, 'service'),
      n(11, 'module', 1),
      n(12, 'module', 11),
      n(2, 'project'),
      n(3, 'service'),
      n(4, 'database'),
      n(5, 'external'),
      n(6, 'external'),
      n(7, 'project'),
      n(8, 'queue', 99), // pai inexistente: vira raiz
    ];
    const edges = [
      { source: 2, target: 1 },
      { source: 12, target: 3 },
      { source: 1, target: 4 },
      { source: 1, target: 5 },
      { source: 6, target: 1 },
      { source: 3, target: 4 },
      { source: 11, target: 12 }, // interna: ignorada
      { source: 1, target: 999 }, // destino desconhecido: ignorada
      { source: 1, target: 8 },
    ];
    const { positions, columns } = new LayeredLayout().compute(nodes, edges);
    expect(columns.map((c) => c.title)).toEqual([LAYERS[0], LAYERS[1], LAYERS[2], LAYERS[3], LAYERS[4]]);
    const colX = Object.fromEntries(columns.map((c) => [c.title, c.x]));
    expect(positions.get(2)!.x).toBe(colX[LAYERS[0]]);
    expect(positions.get(6)!.x).toBe(colX[LAYERS[0]]);
    expect(positions.get(1)!.x).toBe(colX[LAYERS[1]]);
    // Módulos do principal ficam indentados embaixo dele.
    expect(positions.get(11)).toEqual({ x: colX[LAYERS[1]] + LAYER_SPACING.indent, y: positions.get(1)!.y + LAYER_SPACING.row });
    expect(positions.get(12)!.x).toBe(colX[LAYERS[1]] + 2 * LAYER_SPACING.indent);
    expect(positions.get(3)!.x).toBe(colX[LAYERS[2]]);
    expect(positions.get(7)!.x).toBe(colX[LAYERS[2]]);
    expect(positions.get(4)!.x).toBe(colX[LAYERS[3]]);
    expect(positions.get(8)!.x).toBe(colX[LAYERS[3]]);
    expect(positions.get(5)!.x).toBe(colX[LAYERS[4]]);
    // Barycenter: nó com vizinhos antes do isolado.
    expect(positions.get(3)!.y).toBeLessThan(positions.get(7)!.y);
    expect(columns[0].top).toBe(-LAYER_SPACING.row / 2 - LAYER_SPACING.row);
  });

  it('sem conexões não há principal: tudo cai em internos/dados', () => {
    const { columns, positions } = new LayeredLayout().compute([n(1, 'service'), n(2, 'infra')], []);
    expect(columns.map((c) => c.title)).toEqual([LAYERS[2], LAYERS[3]]);
    expect(positions.get(1)).toEqual({ x: 0, y: 0 });
  });

  it('coluna com muitos itens quebra em subcolunas', () => {
    const many = Array.from({ length: 30 }, (_, i) => n(i + 1, 'database'));
    const { positions, columns } = new LayeredLayout().compute(many, []);
    expect(columns).toHaveLength(1);
    const xs = new Set([...positions.values()].map((p) => p.x));
    expect([...xs]).toEqual([0, LAYER_SPACING.subColumn, 2 * LAYER_SPACING.subColumn]);
    const ys = [...positions.values()].filter((p) => p.x === 0).map((p) => p.y);
    expect(ys).toHaveLength(10);
  });

  it('próxima coluna começa depois das subcolunas', () => {
    const nodes = [...Array.from({ length: 13 }, (_, i) => n(i + 1, 'service')), n(100, 'database')];
    const { columns } = new LayeredLayout().compute(nodes, []);
    expect(columns[1].x).toBe(LAYER_SPACING.subColumn + LAYER_SPACING.column);
  });
});
