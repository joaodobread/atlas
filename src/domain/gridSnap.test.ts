import { describe, expect, it } from 'vitest';
import { snapToGrid } from './gridSnap.ts';

const grid = { cellX: 10, cellY: 5 };

describe('snapToGrid', () => {
  it('encaixa na célula mais próxima', () => {
    const out = snapToGrid([{ id: 1, x: 14, y: 6, priority: 0 }], grid);
    expect(out.get(1)).toEqual({ x: 10, y: 5 });
  });

  it('não coloca dois nós na mesma célula; prioridade maior escolhe primeiro', () => {
    const out = snapToGrid(
      [
        { id: 1, x: 0, y: 0, priority: 0 },
        { id: 2, x: 1, y: 0, priority: 5 },
      ],
      grid,
    );
    expect(out.get(2)).toEqual({ x: 0, y: 0 });
    expect(out.get(1)).not.toEqual({ x: 0, y: 0 });
    // Vizinha mais próxima do ponto: em y (5) e não em x (10).
    expect(Math.abs(out.get(1)!.y) + Math.abs(out.get(1)!.x)).toBe(5);
  });

  it('empate de prioridade: menor id primeiro (determinístico)', () => {
    const input = [
      { id: 2, x: 0, y: 0, priority: 1 },
      { id: 1, x: 0, y: 0, priority: 1 },
    ];
    const a = snapToGrid(input, grid);
    const b = snapToGrid([input[1]!, input[0]!], grid);
    expect(a.get(1)).toEqual({ x: 0, y: 0 });
    expect([...a]).toEqual([...b]);
  });

  it('se não houver célula livre no raio de busca, usa a própria célula', () => {
    // 25x25 = 625 células ocupam todos os anéis até 12 em volta da origem.
    const nodes = Array.from({ length: 626 }, (_, i) => ({ id: i, x: 0, y: 0, priority: 0 }));
    const out = snapToGrid(nodes, grid);
    expect(out.size).toBe(626);
    expect(out.get(625)).toEqual({ x: 0, y: 0 });
  });
});
