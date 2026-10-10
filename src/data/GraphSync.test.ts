import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../core/http/HttpError.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { graphData, makeGraphInfo, makeNode, resetSingleton, resetStores } from '../testing/vmFixtures.ts';
import type { GraphApi } from './api/GraphApi.ts';
import { GraphSync } from './GraphSync.ts';

const api = { list: vi.fn<(...args: unknown[]) => Promise<unknown>>(), load: vi.fn<(...args: unknown[]) => Promise<unknown>>() };
let sync: GraphSync;

beforeEach(() => {
  resetStores();
  resetSingleton(GraphSync);
  api.list.mockReset();
  api.load.mockReset();
  sync = GraphSync.getInstance(api as unknown as GraphApi);
});

describe('GraphSync', () => {
  it('é singleton', () => {
    expect(GraphSync.getInstance()).toBe(sync);
  });

  it('carrega a lista e o grafo salvo', async () => {
    useUiStore.setState({ graphId: 2 });
    api.list.mockResolvedValue([makeGraphInfo(1), makeGraphInfo(2)]);
    api.load.mockResolvedValue(graphData({ nodes: [makeNode(5)] }));
    await sync.reload();
    expect(api.load).toHaveBeenCalledWith(2);
    const s = useGraphStore.getState();
    expect(s.status).toBe('ready');
    expect(s.graphs).toHaveLength(2);
    expect(s.index.node(5)).toBeDefined();
    expect(useUiStore.getState().graphId).toBe(2);
  });

  it('cai no primeiro grafo quando o salvo não existe mais', async () => {
    useUiStore.setState({ graphId: 99, selection: { type: 'node', id: 1 } });
    api.list.mockResolvedValue([makeGraphInfo(3)]);
    api.load.mockResolvedValue(graphData());
    await sync.reload();
    expect(useUiStore.getState().graphId).toBe(3);
    expect(useUiStore.getState().selection).toBeNull();
    expect(api.load).toHaveBeenCalledWith(3);
  });

  it('marca erro quando não há grafos', async () => {
    api.list.mockResolvedValue([]);
    await sync.reload();
    expect(useGraphStore.getState()).toMatchObject({ status: 'error', error: 'Nenhum grafo disponível' });
  });

  it('marca erro da API', async () => {
    api.list.mockRejectedValue(new HttpError(500, 'falhou'));
    await sync.reload();
    expect(useGraphStore.getState()).toMatchObject({ status: 'error', error: 'falhou' });
  });

  it('open troca o grafo e recarrega', async () => {
    api.list.mockResolvedValue([makeGraphInfo(1), makeGraphInfo(4)]);
    api.load.mockResolvedValue(graphData());
    await sync.open(4);
    expect(useUiStore.getState().graphId).toBe(4);
    expect(api.load).toHaveBeenCalledWith(4);
  });
});
