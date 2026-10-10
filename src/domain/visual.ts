import type { NodeKind } from '../../shared/constants.ts';

export { KIND_LABEL } from '../../shared/constants.ts';

export const KIND_COLOR: Record<NodeKind, string> = {
  project: '#7c8cff',
  service: '#4fc3f7',
  database: '#ffb74d',
  infra: '#bcaaa4',
  queue: '#ce93d8',
  external: '#90a4ae',
  module: '#81c784',
};

/** Raio do nó na cena em função da profundidade. */
export const nodeRadius = (depth: number): number => Math.max(0.45, 1.5 * Math.pow(0.72, depth));
