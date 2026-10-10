import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeRadius } from '../domain/visual.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeConn, makeNode, resetStores, seedGraph, toasts } from '../testing/vmFixtures.ts';
import { useGraphSceneViewModel } from './useGraphSceneViewModel.ts';

const exportMocks = vi.hoisted(() => ({
  snapshotSvg: vi.fn<(svg: SVGSVGElement) => { markup: string }>(),
  downloadBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  svgToPng: vi.fn<(snapshot: unknown) => Promise<Blob>>(),
}));
vi.mock('../core/exportSvg.ts', () => exportMocks);

const ui = () => useUiStore.getState();

/** 1 ⊃ 2; 3 raiz. 20 = 2→3 http; 21 = 1→3 grpc; 22 = 2→3 implementa 21; 23 = 1→2 (interna). */
function seed() {
  seedGraph({
    nodes: [makeNode(1, null, { name: 'A', kind: 'project' }), makeNode(2, 1, { name: 'B' }), makeNode(3, null, { name: 'C', kind: 'database' })],
    connections: [
      makeConn(20, 2, 3),
      makeConn(21, 1, 3, { protocol: 'grpc' }),
      makeConn(22, 2, 3, { parent_connection_id: 21, protocol: null }),
      makeConn(23, 1, 2),
    ],
  });
}

beforeEach(() => {
  resetStores();
  seed();
  for (const m of Object.values(exportMocks)) m.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('useGraphSceneViewModel', () => {
  it('monta nós e arestas da cena respeitando os expandidos', () => {
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect(result.current.nodes.map((n) => [n.id, n.hiddenCount])).toEqual([
      [1, 1],
      [3, 0],
    ]);
    expect(result.current.nodes[0]).toMatchObject({ path: 'A', kindLabel: 'Projeto', icon: 'lu:folder', r: nodeRadius(0), isContext: false, parentId: null });
    expect(result.current.edges).toEqual([expect.objectContaining({ source: 1, target: 3, connectionIds: [20, 21, 22] })]);
    expect(result.current.edgeLabel(result.current.edges[0]!)).toBe('http, grpc ×3');
    // Infra (padrão) não roda a simulação de forças; o modo livre roda.
    expect(result.current.layoutVersion).toBe(0);
    act(() => ui().setLayoutMode('free'));
    expect(result.current.layoutVersion).toBeGreaterThan(0);
    act(() => ui().toggleExpanded(1));
    expect(result.current.nodes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(result.current.nodes[0]!.hiddenCount).toBe(0);
    expect(result.current.edgeLabel(result.current.edges.find((e) => e.source === 1 && e.target === 2)!)).toBe('http');
  });

  it('com foco, o raio é relativo ao nó focado e vizinhos são contexto', () => {
    useUiStore.setState({ focusId: 2 });
    const { result } = renderHook(() => useGraphSceneViewModel(3));
    const byId = new Map(result.current.nodes.map((n) => [n.id, n]));
    expect(byId.get(2)!.r).toBe(nodeRadius(0));
    expect(byId.get(3)).toMatchObject({ isContext: true, r: nodeRadius(1) });
  });

  it('layouts 2D: grupos, camadas e livre; 3D não calcula', () => {
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect(result.current.grouped).not.toBeNull();
    expect(result.current.layered).toBeNull();
    act(() => ui().setLayoutMode('layers'));
    expect(result.current.layered).not.toBeNull();
    expect(result.current.grouped).toBeNull();
    act(() => ui().setLayoutMode('free'));
    expect(result.current.layered).toBeNull();
    expect(result.current.grouped).toBeNull();
    const three = renderHook(() => useGraphSceneViewModel(3));
    act(() => ui().setLayoutMode('groups'));
    expect(three.result.current.grouped).toBeNull();
  });

  it('reorganizar solta os nós e limpa posições manuais', () => {
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    const unpin = vi.spyOn(result.current.layout, 'unpinAll');
    result.current.manualPositions.set(1, { x: 1, y: 1 });
    const version = result.current.layoutVersion;
    act(() => ui().requestReorganize());
    expect(unpin).toHaveBeenCalled();
    expect(result.current.manualPositions.size).toBe(0);
    expect(result.current.layoutVersion).toBeGreaterThan(version);
  });

  it('sem seleção nada é destacado', () => {
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect(result.current.highlight).toBeNull();
    expect(result.current.isNodeHighlighted(1)).toBe(true);
    expect(result.current.isEdgeHighlighted(result.current.edges[0]!)).toBe(true);
    expect(result.current.selectedNodeId).toBeNull();
  });

  it('seleção de nó destaca subárvore, conexões e o representante visível', () => {
    useUiStore.setState({ selection: { type: 'node', id: 2 } });
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect([...result.current.highlight!.connections].sort((a, b) => a - b)).toEqual([20, 22, 23]);
    expect([...result.current.highlight!.nodes].sort((a, b) => a - b)).toEqual([1, 3]);
    expect(result.current.selectedNodeId).toBe(2);
    expect(result.current.isNodeHighlighted(3)).toBe(true);
    expect(result.current.isEdgeHighlighted(result.current.edges[0]!)).toBe(true);
  });

  it('seleção de conexão destaca implementações e a cadeia de pais', () => {
    useUiStore.setState({ selection: { type: 'connection', id: 22 }, expanded: new Set([1]) });
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect([...result.current.highlight!.connections].sort((a, b) => a - b)).toEqual([21, 22]);
    expect([...result.current.highlight!.nodes].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.current.isNodeHighlighted(2)).toBe(true);
    act(() => ui().select({ type: 'connection', id: 21 }));
    expect([...result.current.highlight!.connections].sort((a, b) => a - b)).toEqual([21, 22]);
    act(() => ui().select({ type: 'connection', id: 99 }));
    expect(result.current.highlight).toBeNull();
  });

  it('destaque da busca: representantes visíveis e conexões entre os mencionados', () => {
    useUiStore.setState({ searchHighlight: new Set([2, 3, 99]) });
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    expect([...result.current.highlight!.nodes].sort((a, b) => a - b)).toEqual([1, 3]);
    expect([...result.current.highlight!.connections].sort((a, b) => a - b)).toEqual([20, 22]);
    act(() => ui().setSearchHighlight([]));
    expect(result.current.highlight).toBeNull();
  });

  it('ações de clique', () => {
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    act(() => result.current.activateNode(3));
    expect(ui()).toMatchObject({ selection: { type: 'node', id: 3 }, focusId: 3 });
    const fit = ui().fitRequest;
    act(() => result.current.activateNode(3));
    expect(ui().fitRequest).toBe(fit);
    act(() => result.current.selectEdge(result.current.edges[0]!));
    expect(ui().selection).toEqual({ type: 'connection', id: 20 });
    // O foco já expandiu o nó 3: alternar recolhe.
    act(() => result.current.toggleExpanded(3));
    expect(ui().expanded.has(3)).toBe(false);
    act(() => result.current.clearSelection());
    expect(ui().selection).toBeNull();
  });

  it('exporta SVG, PNG e avisa falhas', async () => {
    exportMocks.snapshotSvg.mockReturnValue({ markup: '<svg/>' });
    exportMocks.svgToPng.mockResolvedValue(new Blob(['png']));
    const { result } = renderHook(() => useGraphSceneViewModel(2));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    await result.current.exportDiagram(svg, 'svg');
    expect(exportMocks.downloadBlob).toHaveBeenLastCalledWith(expect.any(Blob), expect.stringMatching(/^comm-graph-\d{4}-\d{2}-\d{2}\.svg$/));
    await result.current.exportDiagram(svg, 'png');
    expect(exportMocks.downloadBlob).toHaveBeenLastCalledWith(expect.any(Blob), expect.stringMatching(/\.png$/));
    exportMocks.snapshotSvg.mockImplementationOnce(() => {
      throw new Error('Nada para exportar');
    });
    await act(() => result.current.exportDiagram(svg, 'svg'));
    exportMocks.svgToPng.mockRejectedValueOnce('canvas');
    await act(() => result.current.exportDiagram(svg, 'png'));
    expect(toasts()).toEqual([
      ['error', 'Não foi possível exportar: Nada para exportar'],
      ['error', 'Não foi possível exportar: canvas'],
    ]);
  });
});
