import type { Point } from './orthogonalRouting.ts';

export interface SnapInput {
  id: number;
  x: number;
  y: number;
  /**
   * Ordem de escolha de célula: maior primeiro. Use valor baixo para o nó sendo arrastado,
   * assim ele procura uma célula livre sem desalojar os outros.
   */
  priority: number;
}

export interface GridSpec {
  cellX: number;
  cellY: number;
}

/**
 * "Ímã": encaixa cada nó na célula livre mais próxima de uma grade, sem dois nós na mesma célula.
 * Determinístico (prioridade, depois id) para não "piscar" entre frames.
 */
export function snapToGrid(nodes: readonly SnapInput[], grid: GridSpec): Map<number, Point> {
  const taken = new Set<string>();
  const out = new Map<number, Point>();
  const ordered = [...nodes].sort((a, b) => b.priority - a.priority || a.id - b.id);

  for (const n of ordered) {
    const cx = Math.round(n.x / grid.cellX);
    const cy = Math.round(n.y / grid.cellY);
    let best: { gx: number; gy: number; d: number } | null = null;
    // Procura em anéis crescentes; para no primeiro anel que tiver célula livre.
    for (let ring = 0; ring <= 12 && !best; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring || taken.has(`${gx},${gy}`)) continue;
          const d = Math.hypot(gx * grid.cellX - n.x, gy * grid.cellY - n.y);
          if (!best || d < best.d) best = { gx, gy, d };
        }
      }
    }
    const cell = best ?? { gx: cx, gy: cy };
    taken.add(`${cell.gx},${cell.gy}`);
    out.set(n.id, { x: cell.gx * grid.cellX, y: cell.gy * grid.cellY });
  }
  return out;
}
