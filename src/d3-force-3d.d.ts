declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimLink<N extends SimNode> {
    source: N | number | string;
    target: N | number | string;
  }
  export interface Force<N extends SimNode> {
    (alpha: number): void;
    initialize?(nodes: N[], ...args: unknown[]): void;
  }
  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(d: number): this;
    velocityDecay(d: number): this;
    nodes(): N[];
    force(name: string, force: Force<N> | null): this;
  }
  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force<N> {
    id(fn: (n: N) => number | string): this;
    distance(d: number | ((l: L) => number)): this;
    strength(s: number | ((l: L) => number)): this;
  }
  export interface ManyBodyForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
    distanceMax(d: number): this;
  }
  export interface CollideForce<N extends SimNode> extends Force<N> {
    radius(r: number | ((n: N) => number)): this;
    strength(s: number): this;
  }
  export interface CenterForce<N extends SimNode> extends Force<N> {
    strength(s: number): this;
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;
  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;
  export function forceCollide<N extends SimNode>(radius?: number | ((n: N) => number)): CollideForce<N>;
  export interface PositionForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
  }
  export function forceX<N extends SimNode>(x?: number): PositionForce<N>;
  export function forceY<N extends SimNode>(y?: number): PositionForce<N>;
  export function forceZ<N extends SimNode>(z?: number): PositionForce<N>;
  export function forceCenter<N extends SimNode>(x?: number, y?: number, z?: number): CenterForce<N>;
}
