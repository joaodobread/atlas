import { describe, expect, it } from 'vitest';
import { NODE_KINDS } from '../../shared/constants.ts';
import { KIND_COLOR, KIND_LABEL, nodeRadius } from './visual.ts';

describe('visual', () => {
  it('tem cor e rótulo para cada tipo', () => {
    for (const k of NODE_KINDS) {
      expect(KIND_COLOR[k]).toMatch(/^#[0-9a-f]{6}$/);
      expect(KIND_LABEL[k]).toBeTruthy();
    }
  });

  it('raio diminui com a profundidade até o mínimo', () => {
    expect(nodeRadius(0)).toBe(1.5);
    expect(nodeRadius(1)).toBeCloseTo(1.08);
    expect(nodeRadius(10)).toBe(0.45);
  });
});
