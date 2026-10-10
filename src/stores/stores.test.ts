import { beforeEach, describe, expect, it } from 'vitest';
import { graphData, makeGraphInfo, makeNode, makeUser, resetStores } from '../testing/vmFixtures.ts';
import { useAuthStore } from './authStore.ts';
import { useDocsStore } from './docsStore.ts';
import { useGraphStore } from './graphStore.ts';

beforeEach(() => resetStores());

describe('graphStore', () => {
  it('loading só quando ainda não está pronto', () => {
    const s = useGraphStore.getState;
    s().setLoading();
    expect(s().status).toBe('loading');
    s().setData(graphData({ nodes: [makeNode(1)] }));
    expect(s()).toMatchObject({ status: 'ready', error: null });
    expect(s().index.node(1)).toBeDefined();
    s().setLoading();
    expect(s().status).toBe('ready');
    s().setGraphs([makeGraphInfo(1)]);
    expect(s().graphs).toHaveLength(1);
    s().setError('x');
    expect(s()).toMatchObject({ status: 'error', error: 'x' });
  });
});

describe('docsStore', () => {
  it('setData mescla parcialmente', () => {
    useDocsStore.getState().setData({ folders: [{ id: 1, path: '/a', created_at: '', last_scan_at: null, documentCount: 0 }] });
    expect(useDocsStore.getState().folders).toHaveLength(1);
    expect(useDocsStore.getState().documents).toEqual([]);
  });
});

describe('authStore', () => {
  it('fases conforme o status', () => {
    const s = useAuthStore.getState;
    expect(s().phase).toBe('loading');
    s().apply({ needsSetup: true, user: null, permissions: [] });
    expect(s().phase).toBe('needs-setup');
    s().apply({ needsSetup: false, user: null, permissions: [] });
    expect(s().phase).toBe('anonymous');
    s().apply({ needsSetup: false, user: makeUser(), permissions: ['graph:read'] });
    expect(s().phase).toBe('authenticated');
    expect(s().permissions.has('graph:read')).toBe(true);
    s().fail('offline');
    expect(s()).toMatchObject({ phase: 'offline', error: 'offline' });
    s().signOut();
    expect(s()).toMatchObject({ phase: 'anonymous', user: null });
    expect(s().permissions.size).toBe(0);
  });
});
