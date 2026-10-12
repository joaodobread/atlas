import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeApi } from '../data/api/NodeApi.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeNode, resetStores, seedGraph, setPermissions, toasts } from '../testing/vmFixtures.ts';
import { useCanvasMenuViewModel } from './useCanvasMenuViewModel.ts';

beforeEach(() => {
  resetStores();
  seedGraph({ nodes: [makeNode(1, null, { name: 'Conta' }), makeNode(2, 1, { name: 'VPC' })] });
  vi.spyOn(GraphSync.getInstance(), 'reload').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('useCanvasMenuViewModel', () => {
  it('sem permissão de edição não abre', () => {
    const { result } = renderHook(() => useCanvasMenuViewModel());
    expect(result.current.canCreate).toBe(false);
    act(() => result.current.open({ x: 1, y: 2 }, null));
    expect(result.current.menu).toBeNull();
  });

  it('abre na raiz (projeto) ou dentro de um nó (módulo); nó inexistente vira raiz; fecha', () => {
    setPermissions('graph:write');
    const { result } = renderHook(() => useCanvasMenuViewModel());
    act(() => result.current.open({ x: 10, y: 20 }, null));
    expect(result.current).toMatchObject({ menu: { x: 10, y: 20, parentId: null }, placeLabel: 'na raiz' });
    expect(result.current.form.values.kind).toBe('project');
    act(() => result.current.open({ x: 1, y: 1 }, 2));
    expect(result.current.menu?.parentId).toBe(2);
    expect(result.current.placeLabel).toBe('em Conta / VPC');
    expect(result.current.form.values.kind).toBe('module');
    act(() => result.current.open({ x: 1, y: 1 }, 99));
    expect(result.current.menu?.parentId).toBeNull();
    expect(result.current.kindLabel('database')).toBe('Banco de dados');
    act(() => result.current.close());
    expect(result.current.menu).toBeNull();
  });

  it('cria no lugar certo, abre o pai e seleciona o novo; nome obrigatório', async () => {
    setPermissions('graph:write');
    const create = vi.spyOn(NodeApi.getInstance(), 'create').mockResolvedValue(makeNode(7, 2, { name: 'API' }));
    const { result } = renderHook(() => useCanvasMenuViewModel());
    await act(() => result.current.submit());
    expect(create).not.toHaveBeenCalled();
    act(() => result.current.open({ x: 1, y: 1 }, 2));
    await act(() => result.current.submit());
    expect(result.current.form.errors).toHaveProperty('name');
    act(() => result.current.form.set('name', 'API'));
    await act(() => result.current.submit());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'API', kind: 'module', parent_id: 2, graph_id: useUiStore.getState().graphId }));
    expect(useUiStore.getState().expanded.has(2)).toBe(true);
    expect(useUiStore.getState().selection).toEqual({ type: 'node', id: 7 });
    expect(result.current.menu).toBeNull();
    expect(toasts()).toContainEqual(['success', 'Nó criado']);
  });

  it('na raiz não expande nada; falha na API mantém o menu aberto', async () => {
    setPermissions('graph:write');
    vi.spyOn(NodeApi.getInstance(), 'create').mockResolvedValueOnce(makeNode(8)).mockRejectedValueOnce(new Error('nome repetido'));
    const { result } = renderHook(() => useCanvasMenuViewModel());
    act(() => result.current.open({ x: 1, y: 1 }, null));
    act(() => result.current.form.set('name', 'Novo'));
    await act(() => result.current.submit());
    expect(useUiStore.getState().expanded.size).toBe(0);
    act(() => result.current.open({ x: 1, y: 1 }, null));
    act(() => result.current.form.set('name', 'Outro'));
    await act(() => result.current.submit());
    expect(result.current.menu).not.toBeNull();
    expect(toasts()).toContainEqual(['error', 'nome repetido']);
  });
});
