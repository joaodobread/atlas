import { describe, expect, it } from 'vitest';
import { ANALYSIS_DEPTHS, KIND_LABEL, NODE_KINDS, PERMISSIONS, PROTOCOLS, ROLE_LABEL, ROLE_PERMISSIONS, ROLES } from './constants.ts';

describe('constants', () => {
  it('tem rótulo para todo tipo de nó e papel', () => {
    for (const k of NODE_KINDS) expect(KIND_LABEL[k]).toBeTruthy();
    for (const r of ROLES) expect(ROLE_LABEL[r]).toBeTruthy();
  });

  it('papéis são cumulativos: viewer ⊂ editor ⊂ admin', () => {
    const viewer = new Set(ROLE_PERMISSIONS.viewer);
    const editor = new Set(ROLE_PERMISSIONS.editor);
    for (const p of viewer) expect(editor.has(p)).toBe(true);
    for (const p of editor) expect(ROLE_PERMISSIONS.admin).toContain(p);
    expect(ROLE_PERMISSIONS.admin).toEqual(PERMISSIONS);
    expect(ROLE_PERMISSIONS.viewer).not.toContain('graph:write');
    expect(ROLE_PERMISSIONS.editor).not.toContain('users:manage');
    expect(ROLE_PERMISSIONS.editor).not.toContain('settings:manage');
  });

  it('expõe listas de protocolos e profundidades', () => {
    expect(PROTOCOLS).toContain('http');
    expect(ANALYSIS_DEPTHS).toEqual(['fast', 'medium', 'full', 'max']);
  });
});
