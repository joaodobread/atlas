import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ, type Simulation } from 'd3-force-3d';

export interface LayoutNode {
  id: number;
  parentId: number | null;
  r: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface LayoutLink {
  source: number | LayoutNode;
  target: number | LayoutNode;
  kind: 'tree' | 'comm';
}

/**
 * Layout 3D por forças. Mantém posições entre atualizações para a cena não "pular".
 * Filhos ficam presos aos pais por molas curtas; comunicações aproximam nós de leve.
 */
export class ForceLayout {
  constructor(private readonly dimensions: 2 | 3 = 3) {}

  /** No 2D os nós têm tamanho fixo na tela e rótulos embaixo: precisa de mais folga. */
  private get spacing(): number {
    return this.dimensions === 2 ? 1.6 : 1;
  }

  private positions = new Map<number, LayoutNode>();
  private sim: Simulation<LayoutNode> | null = null;

  update(nodes: Array<{ id: number; parentId: number | null; r: number }>, comm: Array<{ source: number; target: number }>): void {
    const prev = this.positions;
    const next = new Map<number, LayoutNode>();
    let added = false;

    for (const n of nodes) {
      const old = prev.get(n.id);
      if (old) {
        old.r = n.r;
        old.parentId = n.parentId;
        next.set(n.id, old);
        continue;
      }
      added = true;
      const anchor = n.parentId != null ? (next.get(n.parentId) ?? prev.get(n.parentId)) : undefined;
      const spread = anchor ? 3 : 25;
      next.set(n.id, {
        ...n,
        x: (anchor?.x ?? 0) + (Math.random() - 0.5) * spread,
        y: (anchor?.y ?? 0) + (Math.random() - 0.5) * spread,
        z: this.dimensions === 3 ? (anchor?.z ?? 0) + (Math.random() - 0.5) * spread : 0,
      });
    }
    this.positions = next;

    const list = [...next.values()];
    const links: LayoutLink[] = [
      ...list.filter((n) => n.parentId != null && next.has(n.parentId)).map((n) => ({ source: n.id, target: n.parentId!, kind: 'tree' as const })),
      ...comm.map((c) => ({ ...c, kind: 'comm' as const })),
    ];

    this.sim?.stop();
    this.sim = forceSimulation(list, this.dimensions)
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links)
          .id((n) => n.id)
          .distance((l) => (l.kind === 'tree' ? (2.2 + (l.target as LayoutNode).r * 2) * this.spacing : 11 * Math.sqrt(this.spacing)))
          .strength((l) => (l.kind === 'tree' ? 0.9 : 0.08)),
      )
      .force(
        'charge',
        forceManyBody<LayoutNode>()
          .strength((n) => -25 * n.r * n.r - 8)
          .distanceMax(60),
      )
      .force(
        'collide',
        forceCollide<LayoutNode>((n) => (n.r * 1.5 + 0.4) * this.spacing),
      )
      // Gravidade leve para a origem: mantém nós sem conexões perto do resto.
      .force('x', forceX<LayoutNode>(0).strength(0.04))
      .force('y', forceY<LayoutNode>(0).strength(0.04))
      .force('z', forceZ<LayoutNode>(0).strength(0.04))
      .stop();

    // Nada de animação de "arrumação": o layout já aparece assentado.
    if (prev.size === 0) {
      this.settle(list, new Set(list.map((n) => n.id)), 300);
    } else if (added) {
      // Só os nós novos se acomodam; os existentes ficam onde estão.
      this.settle(list, new Set(list.filter((n) => !prev.has(n.id)).map((n) => n.id)), 200);
    } else {
      this.sim.alpha(0);
    }
  }

  /** Roda a simulação de forma síncrona movendo apenas `movable` (os demais ficam congelados). */
  private settle(list: LayoutNode[], movable: Set<number>, ticks: number): void {
    type Fixable = LayoutNode & { fx?: number | null; fy?: number | null; fz?: number | null };
    const frozen = (list as Fixable[]).filter((n) => !movable.has(n.id) && n.fx == null);
    for (const n of frozen) {
      n.fx = n.x;
      n.fy = n.y;
      if (this.dimensions === 3) n.fz = n.z;
    }
    // Grafos grandes: menos passos (cada passo é O(n log n)); o layout segue se acomodando no loop da cena.
    this.sim!.alpha(1).tick(settleTicks(ticks, list.length));
    for (const n of frozen) {
      n.fx = null;
      n.fy = null;
      if (this.dimensions === 3) n.fz = null;
      n.vx = 0;
      n.vy = 0;
      n.vz = 0;
    }
    this.sim!.alpha(0);
  }

  /** Avança a simulação um passo. @returns true enquanto ainda está se movendo. */
  tick(): boolean {
    if (!this.sim || this.sim.alpha() < this.sim.alphaMin()) return false;
    this.sim.tick();
    return true;
  }

  /** A simulação ainda está se movendo. */
  isSettling(): boolean {
    return !!this.sim && this.sim.alpha() >= this.sim.alphaMin();
  }

  position(id: number): LayoutNode | undefined {
    return this.positions.get(id);
  }

  /** Nós com posição atual (somente leitura). */
  all(): readonly LayoutNode[] {
    return [...this.positions.values()];
  }

  /**
   * Fixa (ou solta, com null) a posição de um nó — usado ao arrastar.
   * Não reaquece a simulação: só o nó arrastado se move.
   */
  pin(id: number, pos: { x: number; y: number; z?: number } | null): void {
    const n = this.positions.get(id) as (LayoutNode & { fx?: number | null; fy?: number | null; fz?: number | null }) | undefined;
    if (!n) return;
    n.fx = pos ? pos.x : null;
    n.fy = pos ? pos.y : null;
    if (this.dimensions === 3) n.fz = pos ? (pos.z ?? n.z ?? 0) : null;
    if (pos) {
      // Com a simulação parada, fx/fy só seriam aplicados no próximo tick: aplica já.
      n.x = pos.x;
      n.y = pos.y;
      n.vx = 0;
      n.vy = 0;
    }
  }

  isPinned(id: number): boolean {
    return (this.positions.get(id) as { fx?: number | null } | undefined)?.fx != null;
  }

  /** Solta todos os nós fixados e deixa o layout se reorganizar. */
  unpinAll(): void {
    for (const id of this.positions.keys()) this.pin(id, null);
    this.sim?.alpha(0.8);
  }

  reheat(): void {
    this.sim?.alpha(0.6);
  }
}

/** Passos síncronos para assentar: o pedido até ~200 nós, caindo com o tamanho (mínimo 40). */
export const settleTicks = (wanted: number, nodes: number): number => Math.max(40, Math.min(wanted, Math.round(60_000 / Math.max(1, nodes))));
