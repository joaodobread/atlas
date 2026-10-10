import { describe, expect, it } from 'vitest';
import { ForceLayout, settleTicks } from './ForceLayout.ts';

const nodes = [
  { id: 1, parentId: null, r: 1.5 },
  { id: 2, parentId: 1, r: 1 },
  { id: 3, parentId: null, r: 1.5 },
];

describe('ForceLayout', () => {
  it('3D: posiciona todos os nós já assentados', () => {
    const l = new ForceLayout();
    l.update(nodes, [{ source: 2, target: 3 }]);
    expect(l.all()).toHaveLength(3);
    for (const n of l.all()) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.z)).toBe(true);
    }
    expect(l.isSettling()).toBe(false);
    expect(l.tick()).toBe(false);
    expect(l.position(99)).toBeUndefined();
  });

  it('2D: z fica em 0', () => {
    const l = new ForceLayout(2);
    l.update(nodes, []);
    for (const n of l.all()) expect(n.z ?? 0).toBe(0);
  });

  it('mantém as posições existentes e só acomoda nós novos', () => {
    for (const dim of [2, 3] as const) {
      const l = new ForceLayout(dim);
      l.update(nodes, []);
      const before = { ...l.position(1)! };
      l.update([...nodes, { id: 4, parentId: 2, r: 0.5 }], [{ source: 4, target: 3 }]);
      expect(l.position(1)!.x).toBeCloseTo(before.x!);
      expect(l.position(1)!.y).toBeCloseTo(before.y!);
      expect(l.position(4)).toBeDefined();
      expect(l.isPinned(1)).toBe(false);
    }
  });

  it('atualizar sem nós novos não move nada e atualiza raio/pai', () => {
    const l = new ForceLayout();
    l.update(nodes, []);
    const before = { ...l.position(2)! };
    l.update([nodes[0], { id: 2, parentId: null, r: 2 }], []);
    expect(l.position(2)).toMatchObject({ x: before.x, y: before.y, r: 2, parentId: null });
    expect(l.position(3)).toBeUndefined();
    expect(l.isSettling()).toBe(false);
  });

  it('pin/unpin em 3D', () => {
    const l = new ForceLayout(3);
    l.update(nodes, []);
    l.pin(1, { x: 10, y: 20, z: 30 });
    expect(l.isPinned(1)).toBe(true);
    expect(l.position(1)).toMatchObject({ x: 10, y: 20, vx: 0, vy: 0 });
    l.pin(2, { x: 1, y: 2 });
    expect(l.isPinned(2)).toBe(true);
    l.pin(99, { x: 0, y: 0 });
    expect(l.isPinned(99)).toBe(false);
    l.unpinAll();
    expect(l.isPinned(1)).toBe(false);
    expect(l.isPinned(2)).toBe(false);
    expect(l.isSettling()).toBe(true);
    expect(l.tick()).toBe(true);
  });

  it('pin em 2D e reheat', () => {
    const l = new ForceLayout(2);
    l.update(nodes, []);
    l.pin(3, { x: 5, y: 5 });
    expect(l.position(3)).toMatchObject({ x: 5, y: 5 });
    l.pin(3, null);
    expect(l.isPinned(3)).toBe(false);
    l.reheat();
    expect(l.isSettling()).toBe(true);
    expect(l.tick()).toBe(true);
  });

  it('nós fixados continuam parados quando chegam nós novos', () => {
    const l = new ForceLayout(3);
    l.update(nodes, []);
    l.pin(1, { x: 7, y: 8, z: 9 });
    l.update([...nodes, { id: 5, parentId: 1, r: 1 }], []);
    expect(l.position(1)).toMatchObject({ x: 7, y: 8 });
    expect(l.isPinned(1)).toBe(true);
  });

  it('sem simulação: tick/isSettling/reheat/unpinAll são seguros', () => {
    const l = new ForceLayout();
    expect(l.tick()).toBe(false);
    expect(l.isSettling()).toBe(false);
    l.reheat();
    l.unpinAll();
    expect(l.all()).toEqual([]);
  });

  it('filho novo listado antes do pai existente nasce perto do pai', () => {
    const l = new ForceLayout(3);
    l.update([{ id: 1, parentId: null, r: 1 }], []);
    l.pin(1, { x: 500, y: 500, z: 500 });
    l.update(
      [
        { id: 2, parentId: 1, r: 0.5 },
        { id: 1, parentId: null, r: 1 },
      ],
      [],
    );
    const child = l.position(2)!;
    expect(Math.hypot(child.x! - 500, child.y! - 500, child.z! - 500)).toBeLessThan(100);
  });
});

describe('settleTicks', () => {
  it('mantém o pedido em grafos pequenos e reduz nos grandes (mínimo 40)', () => {
    expect(settleTicks(300, 100)).toBe(300);
    expect(settleTicks(300, 1000)).toBe(60);
    expect(settleTicks(300, 10_000)).toBe(40);
    expect(settleTicks(200, 0)).toBe(200);
  });
});
