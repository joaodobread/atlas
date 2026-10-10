import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetail } from '../../shared/types.ts';
import { AuthSession } from '../data/AuthSession.ts';
import { CallSiteApi } from '../data/api/CallSiteApi.ts';
import { ConnectionApi } from '../data/api/ConnectionApi.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { InterfaceApi } from '../data/api/InterfaceApi.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import {
  makeCallSite,
  makeConn,
  makeDoc,
  makeGraphInfo,
  makeIface,
  makeNode,
  makeUser,
  resetStores,
  seedGraph,
  setPermissions,
  toasts,
} from '../testing/vmFixtures.ts';
import { useAppViewModel } from './useAppViewModel.ts';
import { useConnectionDetailViewModel } from './useConnectionDetailViewModel.ts';
import { useDocumentViewerViewModel } from './useDocumentViewerViewModel.ts';
import { useGraphSwitcherViewModel } from './useGraphSwitcherViewModel.ts';
import { useIconPickerViewModel } from './useIconPickerViewModel.ts';
import { useImportViewModel } from './useImportViewModel.ts';
import { useNavRailViewModel } from './useNavRailViewModel.ts';
import { useNodeDetailViewModel } from './useNodeDetailViewModel.ts';
import { usePanelResizeViewModel } from './usePanelResizeViewModel.ts';
import { useTreeViewModel } from './useTreeViewModel.ts';

const ui = () => useUiStore.getState();
let reload: ReturnType<typeof vi.spyOn>;
const confirmMock = vi.fn<(message?: string) => boolean>(() => true);

/** 1 (A) ⊃ 2 (B); 3 (C) com interface 10. Conexões: 20 = 1→3 [10] grpc; 21 = 2→3 implementa 20 (com local). */
function seedSample() {
  return seedGraph({
    nodes: [
      makeNode(1, null, { name: 'A', kind: 'project' }),
      makeNode(2, 1, { name: 'B', kind: 'module' }),
      makeNode(3, null, { name: 'C', kind: 'database' }),
    ],
    interfaces: [makeIface(10, 3, 'users')],
    connections: [makeConn(20, 1, 3, { target_interface_id: 10, protocol: 'grpc' }), makeConn(21, 2, 3, { parent_connection_id: 20, protocol: null })],
    callSites: [makeCallSite(30, 21)],
  });
}

beforeEach(() => {
  resetStores();
  reload = vi.spyOn(GraphSync.getInstance(), 'reload').mockResolvedValue();
  confirmMock.mockReset().mockReturnValue(true);
  vi.stubGlobal('confirm', confirmMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useAppViewModel', () => {
  it('carrega o grafo, limpa seleção/foco inválidos e expõe o layout', () => {
    seedSample();
    useUiStore.setState({ selection: { type: 'node', id: 99 }, focusId: 99 });
    const { result } = renderHook(() => useAppViewModel());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ui().selection).toBeNull();
    expect(ui().focusId).toBeNull();
    expect(result.current).toMatchObject({ status: 'ready', hasSelection: false, screen: 'graph', viewMode: '2d', leftTab: 'tree', leftOpen: true });
    act(() => ui().select({ type: 'connection', id: 20 }));
    expect(result.current.hasSelection).toBe(true);
    act(() => ui().select({ type: 'connection', id: 99 }));
    expect(result.current.selection).toBeNull();
    act(() => result.current.closeLeft());
    expect(result.current.leftOpen).toBe(false);
    result.current.retry();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('não mexe na seleção enquanto o grafo não está pronto', () => {
    useUiStore.setState({ selection: { type: 'node', id: 99 }, focusId: 99 });
    renderHook(() => useAppViewModel());
    expect(ui().selection).not.toBeNull();
    expect(ui().focusId).toBe(99);
  });

  it('Esc sai do foco, exceto digitando num campo', () => {
    seedSample();
    useUiStore.setState({ focusId: 1 });
    const { unmount } = renderHook(() => useAppViewModel());
    const input = document.body.appendChild(document.createElement('input'));
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(ui().focusId).toBe(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(ui().focusId).toBe(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(ui().focusId).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(ui().focusId).toBeNull();
    unmount();
    input.remove();
  });
});

describe('useTreeViewModel', () => {
  it('consultas da árvore e seleção/foco', () => {
    seedSample();
    useUiStore.setState({ expanded: new Set([1]), selection: { type: 'node', id: 2 }, focusId: 2 });
    const { result } = renderHook(() => useTreeViewModel());
    const vm = result.current;
    expect(vm.roots.map((n) => n.id)).toEqual([1, 3]);
    expect(vm.children(1).map((n) => n.id)).toEqual([2]);
    expect(vm.hasChildren(1)).toBe(true);
    expect(vm.isExpanded(1)).toBe(true);
    expect(vm.isSelected(2)).toBe(true);
    expect(vm.isSelected(1)).toBe(false);
    expect(vm.isFocused(2)).toBe(true);
    expect(vm.color('database')).toMatch(/^#/);
    expect(vm.icon(makeNode(9, null, { kind: 'database' }))).toBe('lu:database');
    expect(vm.kindLabel('project')).toBe('Projeto');
    expect(vm.kinds).toContain('module');
    expect(vm.canEdit).toBe(false);
    act(() => vm.toggle(1));
    expect(ui().expanded.has(1)).toBe(false);
    const fit = ui().fitRequest;
    act(() => result.current.select(2));
    expect(ui().fitRequest).toBe(fit);
    act(() => result.current.select(3));
    expect(ui()).toMatchObject({ focusId: 3, selection: { type: 'node', id: 3 } });
  });

  it('cria nó raiz: valida, cria, seleciona e foca', async () => {
    setPermissions('graph:write');
    useUiStore.setState({ graphId: 4 });
    const create = vi.spyOn(NodeApi.getInstance(), 'create').mockRejectedValueOnce(new Error('falhou')).mockResolvedValueOnce(makeNode(50));
    const { result } = renderHook(() => useTreeViewModel());
    expect(result.current.canEdit).toBe(true);
    await act(() => result.current.createRoot());
    expect(result.current.form.errors).toHaveProperty('name');
    act(() => result.current.form.set('name', 'Novo'));
    await act(() => result.current.createRoot());
    expect(toasts()).toEqual([['error', 'falhou']]);
    expect(result.current.form.values.name).toBe('Novo');
    await act(() => result.current.createRoot());
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Novo', graph_id: 4, parent_id: null, kind: 'project' }));
    expect(result.current.form.values.name).toBe('');
    expect(ui()).toMatchObject({ selection: { type: 'node', id: 50 }, focusId: 50 });
  });
});

describe('useNodeDetailViewModel', () => {
  beforeEach(() => {
    seedSample();
    setPermissions('graph:write');
  });

  it('deriva caminhos, opções e conexões', () => {
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    const vm = result.current;
    expect(vm).toMatchObject({ path: 'A / B', icon: 'lu:box', canEdit: true });
    expect(vm.color).toMatch(/^#/);
    expect(vm.parentOptions.map((o) => o.value)).toEqual([1, 3]);
    expect(vm.targetOptions.map((o) => o.value)).toEqual([1, 3]);
    expect(vm.outgoing).toEqual([{ id: 21, source: 'A / B', target: 'C', iface: null, protocol: null, implementsParent: true, callSiteCount: 1 }]);
    expect(vm.inheritedOutputs).toEqual([expect.objectContaining({ id: 20, iface: 'users', implementsParent: false, callSiteCount: 0 })]);
    expect(vm.incoming).toEqual([]);
    expect(vm.targetInterfaces).toEqual([]);
    expect(vm.kinds).toContainEqual({ value: 'module', label: 'Módulo' });
    expect(vm.nodeForm.values).toMatchObject({ name: 'B', kind: 'module', parent_id: '1', tech: '', description: '' });
    act(() => vm.selectNode(3));
    expect(ui().selection).toEqual({ type: 'node', id: 3 });
    act(() => result.current.selectConnection(20));
    expect(ui().selection).toEqual({ type: 'connection', id: 20 });
  });

  it('nó inexistente usa valores neutros', () => {
    const { result } = renderHook(() => useNodeDetailViewModel(99));
    expect(result.current).toMatchObject({ node: undefined, path: '', color: '#888', icon: 'lu:box' });
    expect(result.current.nodeForm.values).toMatchObject({ name: '', kind: 'project', parent_id: '' });
  });

  it('save valida e atualiza', async () => {
    const update = vi.spyOn(NodeApi.getInstance(), 'update').mockResolvedValue(makeNode(2));
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    act(() => result.current.nodeForm.set('name', ''));
    await act(() => result.current.save());
    expect(update).not.toHaveBeenCalled();
    act(() => result.current.nodeForm.set('name', 'B2'));
    await act(() => result.current.save());
    expect(update).toHaveBeenCalledWith(2, expect.objectContaining({ name: 'B2', parent_id: 1, tech: null }));
    expect(toasts()).toContainEqual(['success', 'Nó salvo']);
  });

  it('remove: confirma, exclui e seleciona o pai (ou nada para raiz)', async () => {
    const remove = vi.spyOn(NodeApi.getInstance(), 'remove').mockResolvedValue();
    const a = renderHook(() => useNodeDetailViewModel(2));
    confirmMock.mockReturnValueOnce(false);
    await act(() => a.result.current.remove());
    expect(remove).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenLastCalledWith(expect.not.stringContaining('descendentes'));
    await act(() => a.result.current.remove());
    expect(ui().selection).toEqual({ type: 'node', id: 1 });
    const b = renderHook(() => useNodeDetailViewModel(1));
    ui().select({ type: 'node', id: 1 });
    await act(() => b.result.current.remove());
    expect(confirmMock).toHaveBeenLastCalledWith(expect.stringContaining('seus 1 descendentes'));
    expect(ui().selection).toBeNull();
    remove.mockRejectedValueOnce(new Error('x'));
    ui().select({ type: 'node', id: 3 });
    const c = renderHook(() => useNodeDetailViewModel(3));
    await act(() => c.result.current.remove());
    expect(ui().selection).toEqual({ type: 'node', id: 3 });
  });

  it('addChild, addInterface e removeInterface', async () => {
    const create = vi
      .spyOn(NodeApi.getInstance(), 'create')
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce(makeNode(60, 2));
    const ifCreate = vi.spyOn(InterfaceApi.getInstance(), 'create').mockResolvedValue(makeIface(11, 2));
    const ifRemove = vi.spyOn(InterfaceApi.getInstance(), 'remove').mockResolvedValue();
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    await act(() => result.current.addChild());
    expect(create).not.toHaveBeenCalled();
    act(() => result.current.childForm.set('name', 'Filho'));
    await act(() => result.current.addChild());
    expect(result.current.childForm.values.name).toBe('Filho');
    await act(() => result.current.addChild());
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Filho', parent_id: 2, kind: 'module' }));
    expect(result.current.childForm.values.name).toBe('');
    expect(ui().expanded.has(2)).toBe(true);

    await act(() => result.current.addInterface());
    expect(ifCreate).not.toHaveBeenCalled();
    act(() => result.current.interfaceForm.set('name', 'GET /x'));
    await act(() => result.current.addInterface());
    expect(ifCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'GET /x', node_id: 2 }));
    expect(result.current.interfaceForm.values.name).toBe('');
    await act(async () => {
      await result.current.removeInterface(11);
    });
    expect(ifRemove).toHaveBeenCalledWith(11);
  });

  it('inheritOutput preenche a partir de uma saída do ancestral e limpa', () => {
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    act(() => result.current.inheritOutput('20'));
    expect(result.current.outputForm.values).toMatchObject({
      inherit: '20',
      target_id: '3',
      target_interface_id: '10',
      protocol: 'grpc',
      parent_connection_id: '20',
    });
    expect(result.current.targetInterfaces.map((i) => i.id)).toEqual([10]);
    act(() => result.current.inheritOutput(''));
    expect(result.current.outputForm.values).toMatchObject({ inherit: '', parent_connection_id: '', target_id: '3' });
    act(() => result.current.inheritOutput('21'));
    expect(result.current.outputForm.values).toMatchObject({ target_interface_id: '', protocol: 'grpc' });
  });

  it('addOutput: valida, cria interface nova quando pedido e a conexão', async () => {
    const ifCreate = vi.spyOn(InterfaceApi.getInstance(), 'create').mockResolvedValue(makeIface(12, 3));
    const connCreate = vi.spyOn(ConnectionApi.getInstance(), 'create').mockResolvedValue(makeConn(40, 2, 3));
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    await act(() => result.current.addOutput());
    expect(result.current.outputForm.errors).toHaveProperty('target_id');
    act(() => result.current.outputForm.set('target_id', '3'));
    act(() => result.current.outputForm.set('target_interface_id', '10'));
    await act(() => result.current.addOutput());
    expect(ifCreate).not.toHaveBeenCalled();
    expect(connCreate).toHaveBeenLastCalledWith(expect.objectContaining({ source_id: 2, target_id: 3, target_interface_id: 10, protocol: 'http' }));
    expect(result.current.outputForm.values.target_id).toBe('');

    act(() => {
      result.current.outputForm.set('target_id', '3');
      result.current.outputForm.set('new_interface', 'x'.repeat(301));
    });
    await act(() => result.current.addOutput());
    expect(result.current.outputForm.errors).toHaveProperty('name');
    expect(connCreate).toHaveBeenCalledTimes(1);

    act(() => result.current.outputForm.set('new_interface', ' orders '));
    await act(() => result.current.addOutput());
    expect(ifCreate).toHaveBeenCalledWith({ node_id: 3, name: 'orders', type: 'http' });
    expect(connCreate).toHaveBeenLastCalledWith(expect.objectContaining({ target_interface_id: 12 }));

    connCreate.mockRejectedValueOnce(new Error('dup'));
    act(() => result.current.outputForm.set('target_id', '3'));
    await act(() => result.current.addOutput());
    expect(result.current.outputForm.values.target_id).toBe('3');
    expect(toasts()).toContainEqual(['error', 'dup']);
  });

  it('removeConnection pede confirmação', async () => {
    const remove = vi.spyOn(ConnectionApi.getInstance(), 'remove').mockResolvedValue();
    const { result } = renderHook(() => useNodeDetailViewModel(2));
    confirmMock.mockReturnValueOnce(false);
    act(() => result.current.removeConnection(21));
    expect(remove).not.toHaveBeenCalled();
    act(() => result.current.removeConnection(21));
    await waitFor(() => expect(toasts()).toContainEqual(['success', 'Conexão removida']));
    expect(remove).toHaveBeenCalledWith(21);
  });

  it('recarrega o formulário quando o nó muda', () => {
    const { result, rerender } = renderHook(({ id }) => useNodeDetailViewModel(id), { initialProps: { id: 2 } });
    act(() => result.current.childForm.set('name', 'x'));
    rerender({ id: 3 });
    expect(result.current.nodeForm.values.name).toBe('C');
    expect(result.current.childForm.values.name).toBe('');
  });
});

describe('useConnectionDetailViewModel', () => {
  beforeEach(() => {
    seedSample();
    setPermissions('graph:write');
  });

  it('deriva rótulos, pai, implementações e locais', () => {
    const { result } = renderHook(() => useConnectionDetailViewModel(21));
    const vm = result.current;
    expect(vm).toMatchObject({ sourcePath: 'A / B', targetPath: 'C', canEdit: true });
    expect(vm.targetInterfaces.map((i) => i.id)).toEqual([10]);
    expect(vm.parentOptions).toEqual([{ value: 20, label: 'A → C [users]' }]);
    expect(vm.parent?.id).toBe(20);
    expect(vm.implementations).toEqual([]);
    expect(vm.callSites.map((c) => c.id)).toEqual([30]);
    expect(vm.form.values).toEqual({ protocol: '', target_interface_id: '', parent_connection_id: '20', description: '' });
    expect(vm.protocols).toContain('http');
    const p = renderHook(() => useConnectionDetailViewModel(20)).result.current;
    expect(p.implementations).toEqual([{ id: 21, label: 'A / B → C' }]);
    expect(p.parent).toBeUndefined();
    expect(p.form.values.target_interface_id).toBe('10');
    act(() => vm.selectNode(1));
    expect(ui().selection).toEqual({ type: 'node', id: 1 });
    act(() => vm.selectConnection(20));
    expect(ui().selection).toEqual({ type: 'connection', id: 20 });
  });

  it('conexão inexistente', async () => {
    const { result } = renderHook(() => useConnectionDetailViewModel(99));
    expect(result.current).toMatchObject({ conn: undefined, sourcePath: '', targetPath: '', targetInterfaces: [], parentOptions: [], implementations: [] });
    await act(() => result.current.remove());
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('save valida e atualiza', async () => {
    const update = vi.spyOn(ConnectionApi.getInstance(), 'update').mockResolvedValue(makeConn(21, 2, 3));
    const { result } = renderHook(() => useConnectionDetailViewModel(21));
    act(() => result.current.form.set('protocol', 'x'.repeat(60)));
    await act(() => result.current.save());
    expect(update).not.toHaveBeenCalled();
    act(() => result.current.form.set('protocol', 'kafka'));
    await act(() => result.current.save());
    expect(update).toHaveBeenCalledWith(21, { protocol: 'kafka', description: null, target_interface_id: null, parent_connection_id: 20 });
  });

  it('remove seleciona a origem', async () => {
    const remove = vi.spyOn(ConnectionApi.getInstance(), 'remove').mockResolvedValue();
    const { result } = renderHook(() => useConnectionDetailViewModel(21));
    confirmMock.mockReturnValueOnce(false);
    await act(() => result.current.remove());
    expect(remove).not.toHaveBeenCalled();
    await act(() => result.current.remove());
    expect(ui().selection).toEqual({ type: 'node', id: 2 });
    remove.mockRejectedValueOnce(new Error('x'));
    ui().select(null);
    await act(() => result.current.remove());
    expect(ui().selection).toBeNull();
  });

  it('locais: adicionar (com e sem linha) e remover', async () => {
    const create = vi.spyOn(CallSiteApi.getInstance(), 'create').mockResolvedValue(makeCallSite(31, 21));
    const remove = vi.spyOn(CallSiteApi.getInstance(), 'remove').mockResolvedValue();
    const { result } = renderHook(() => useConnectionDetailViewModel(21));
    await act(() => result.current.addCallSite());
    expect(create).not.toHaveBeenCalled();
    act(() => result.current.callSiteForm.set('file_path', 'src/a.ts'));
    await act(() => result.current.addCallSite());
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ connection_id: 21, file_path: 'src/a.ts', line: null }));
    expect(result.current.callSiteForm.values.file_path).toBe('');
    act(() => {
      result.current.callSiteForm.set('file_path', 'src/b.ts');
      result.current.callSiteForm.set('line', ' 12 ');
    });
    create.mockRejectedValueOnce(new Error('x'));
    await act(() => result.current.addCallSite());
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ line: 12 }));
    expect(result.current.callSiteForm.values.file_path).toBe('src/b.ts');
    await act(async () => {
      await result.current.removeCallSite(30);
    });
    expect(remove).toHaveBeenCalledWith(30);
  });
});

describe('useGraphSwitcherViewModel', () => {
  beforeEach(() => {
    useGraphStore.setState({ graphs: [makeGraphInfo(1, { name: 'Prod', nodeCount: 3 }), makeGraphInfo(2)] });
    useUiStore.setState({ graphId: 1 });
  });

  it('lista, grafo atual e troca', () => {
    const open = vi.spyOn(GraphSync.getInstance(), 'open').mockResolvedValue();
    const { result } = renderHook(() => useGraphSwitcherViewModel());
    expect(result.current).toMatchObject({ currentName: 'Prod', canDelete: true, canEdit: false, mode: { type: 'list' } });
    result.current.open(2);
    expect(open).toHaveBeenCalledWith(2);
    useUiStore.setState({ graphId: 9 });
    useGraphStore.setState({ graphs: [makeGraphInfo(1)] });
    const other = renderHook(() => useGraphSwitcherViewModel()).result.current;
    expect(other).toMatchObject({ current: null, currentName: '…', canDelete: false });
  });

  it('cria grafo: valida o nome, cria, abre e avisa', async () => {
    const create = vi.spyOn(GraphApi.getInstance(), 'create').mockResolvedValue(makeGraphInfo(5, { name: 'Novo' }));
    const open = vi.spyOn(GraphSync.getInstance(), 'open').mockResolvedValue();
    const { result } = renderHook(() => useGraphSwitcherViewModel());
    act(() => result.current.startCreate());
    expect(result.current.mode).toEqual({ type: 'create' });
    await act(() => result.current.submit());
    expect(result.current.error).toBe('Obrigatório');
    expect(result.current.mode).toEqual({ type: 'create' });
    act(() => result.current.setName('Novo'));
    await act(() => result.current.submit());
    expect(create).toHaveBeenCalledWith({ name: 'Novo' });
    expect(open).toHaveBeenCalledWith(5);
    expect(toasts()).toEqual([['success', 'Grafo "Novo" criado']]);
    expect(result.current).toMatchObject({ mode: { type: 'list' }, error: null, busy: false });
  });

  it('renomeia o grafo atual e cancela', async () => {
    const update = vi.spyOn(GraphApi.getInstance(), 'update').mockResolvedValue(makeGraphInfo(1));
    const { result } = renderHook(() => useGraphSwitcherViewModel());
    act(() => result.current.startRename());
    expect(result.current.name).toBe('Prod');
    act(() => result.current.setName('Prod 2'));
    await act(() => result.current.submit());
    expect(update).toHaveBeenCalledWith(1, { name: 'Prod 2' });
    expect(reload).toHaveBeenCalled();
    act(() => result.current.startRename());
    act(() => result.current.cancel());
    expect(result.current.mode).toEqual({ type: 'list' });
  });

  it('renomear sem grafo atual não chama a API', async () => {
    useUiStore.setState({ graphId: 9 });
    const update = vi.spyOn(GraphApi.getInstance(), 'update');
    const { result } = renderHook(() => useGraphSwitcherViewModel());
    act(() => result.current.startRename());
    expect(result.current.name).toBe('');
    act(() => result.current.setName('x'));
    await act(() => result.current.submit());
    expect(update).not.toHaveBeenCalled();
  });

  it('exclui com confirmação; erro aparece no formulário', async () => {
    const del = vi.spyOn(GraphApi.getInstance(), 'delete').mockResolvedValueOnce().mockRejectedValueOnce(new Error('em uso'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { result } = renderHook(() => useGraphSwitcherViewModel());
    act(() => result.current.remove());
    expect(del).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('3 nós'));
    act(() => result.current.remove());
    await waitFor(() => expect(toasts()).toEqual([['success', 'Grafo excluído']]));
    act(() => result.current.remove());
    await waitFor(() => expect(result.current.error).toBe('em uso'));
    useUiStore.setState({ graphId: 9 });
    const none = renderHook(() => useGraphSwitcherViewModel()).result.current;
    none.remove();
    expect(del).toHaveBeenCalledTimes(2);
  });
});

describe('useImportViewModel', () => {
  it('valida JSON e schema, confirma replace e importa', async () => {
    useUiStore.setState({ graphId: 3, importOpen: true });
    const imp = vi.spyOn(GraphApi.getInstance(), 'importDocument').mockResolvedValue({
      nodesCreated: 1,
      nodesUpdated: 0,
      interfacesCreated: 0,
      connectionsCreated: 0,
      connectionsUpdated: 0,
      callSitesCreated: 0,
      warnings: [],
    });
    const { result } = renderHook(() => useImportViewModel());
    act(() => result.current.setText('{'));
    await act(() => result.current.submit());
    expect(result.current.error).toMatch(/^JSON inválido: /);
    act(() => result.current.setText('{"mode":"x"}'));
    expect(result.current.error).toBeNull();
    await act(() => result.current.submit());
    expect(result.current.error).toMatch(/^mode: /);
    act(() => result.current.setText('{"mode":"replace"}'));
    confirmMock.mockReturnValueOnce(false);
    await act(() => result.current.submit());
    expect(imp).not.toHaveBeenCalled();
    await act(() => result.current.submit());
    expect(imp).toHaveBeenCalledWith(3, { mode: 'replace', nodes: [], connections: [] });
    expect(result.current.result?.nodesCreated).toBe(1);
    expect(result.current.error).toBeNull();
    imp.mockRejectedValueOnce(new Error('x'));
    await act(() => result.current.submit());
    expect(result.current.result).toBeNull();
    act(() => result.current.fillTemplate());
    expect(JSON.parse(result.current.text)).toHaveProperty('nodes');
    act(() => result.current.close());
    expect(ui().importOpen).toBe(false);
  });
});

describe('useNavRailViewModel', () => {
  it('estado dos painéis e telas', () => {
    setPermissions('graph:write');
    const { result } = renderHook(() => useNavRailViewModel());
    expect(result.current.isPanelActive('tree')).toBe(true);
    expect(result.current.isPanelActive('docs')).toBe(false);
    expect(result.current).toMatchObject({ canImport: true, reposActive: false, settingsActive: false, userName: '', initials: '?', roleLabel: '' });
    act(() => result.current.togglePanel('docs'));
    expect(ui().leftTab).toBe('docs');
    act(() => result.current.openRepos());
    expect(result.current.reposActive).toBe(true);
    act(() => result.current.openSettings());
    expect(result.current.settingsActive).toBe(true);
    act(() => ui().openSettings('llm'));
    act(() => result.current.openAccount());
    expect(ui().settingsSection).toBe('account');
    act(() => result.current.openImport());
    expect(ui().importOpen).toBe(true);
  });

  it('usuário: iniciais e papel; logout', () => {
    const logout = vi.spyOn(AuthSession.getInstance(), 'logout').mockResolvedValue();
    useAuthStore.setState({ user: makeUser({ name: 'ana maria souza', role: 'editor' }) });
    const { result } = renderHook(() => useNavRailViewModel());
    expect(result.current).toMatchObject({ userName: 'ana maria souza', initials: 'AM', roleLabel: 'Editor' });
    result.current.logout();
    expect(logout).toHaveBeenCalled();
    act(() => useAuthStore.setState({ user: makeUser({ name: '   ' }) }));
    expect(result.current.initials).toBe('?');
  });

  it('exportJson baixa o documento; erro vira toast', async () => {
    const exp = vi.spyOn(GraphApi.getInstance(), 'exportDocument').mockResolvedValueOnce({ mode: 'merge', nodes: [], connections: [] });
    const create = vi.fn<(obj: Blob) => string>(() => 'blob:x');
    const revoke = vi.fn<(url: string) => void>();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    useUiStore.setState({ graphId: 2 });
    const { result } = renderHook(() => useNavRailViewModel());
    await act(() => result.current.exportJson());
    expect(exp).toHaveBeenCalledWith(2);
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    exp.mockRejectedValueOnce(new Error('sem acesso'));
    await act(() => result.current.exportJson());
    expect(toasts()).toEqual([['error', 'sem acesso']]);
  });
});

describe('usePanelResizeViewModel', () => {
  const pointerDown = (vm: ReturnType<typeof usePanelResizeViewModel>, el: HTMLElement, clientX: number) => {
    const preventDefault = vi.fn<() => void>();
    vm.onPointerDown({ preventDefault, clientX, pointerId: 1, currentTarget: el } as unknown as Parameters<typeof vm.onPointerDown>[0]);
    expect(preventDefault).toHaveBeenCalled();
  };
  const move = (el: HTMLElement, clientX: number) => act(() => void el.dispatchEvent(new MouseEvent('pointermove', { clientX })));

  it('arrastar a borda esquerda muda a largura dentro dos limites', () => {
    const el = document.createElement('div');
    el.setPointerCapture = vi.fn<(id: number) => void>();
    const { result } = renderHook(() => usePanelResizeViewModel('left'));
    expect(result.current.width).toBe(300);
    pointerDown(result.current, el, 100);
    expect(document.body.classList.contains('resizing')).toBe(true);
    move(el, 150);
    expect(result.current.width).toBe(350);
    move(el, 2000);
    expect(result.current.width).toBe(window.innerWidth - 380 - 160);
    move(el, -1000);
    expect(result.current.width).toBe(220);
    act(() => void el.dispatchEvent(new MouseEvent('pointerup')));
    expect(document.body.classList.contains('resizing')).toBe(false);
    move(el, 150);
    expect(result.current.width).toBe(220);
  });

  it('painel direito cresce arrastando para a esquerda; teclado e reset', () => {
    const el = document.createElement('div');
    el.setPointerCapture = vi.fn<(id: number) => void>();
    const { result } = renderHook(() => usePanelResizeViewModel('right'));
    pointerDown(result.current, el, 500);
    move(el, 480);
    expect(result.current.width).toBe(400);
    act(() => void el.dispatchEvent(new MouseEvent('pointercancel')));
    act(() => result.current.onKeyDown({ key: 'ArrowRight' } as never));
    expect(result.current.width).toBe(380);
    act(() => result.current.onKeyDown({ key: 'ArrowLeft' } as never));
    expect(result.current.width).toBe(400);
    act(() => result.current.onKeyDown({ key: 'Enter' } as never));
    expect(result.current.width).toBe(400);
    act(() => result.current.reset());
    expect(result.current.width).toBe(380);
  });

  it('teclado no painel esquerdo e alternar expandido', () => {
    const { result } = renderHook(() => usePanelResizeViewModel('left'));
    act(() => result.current.onKeyDown({ key: 'ArrowRight' } as never));
    expect(result.current.width).toBe(320);
    expect(result.current.expanded).toBe(false);
    act(() => result.current.toggleExpanded());
    expect(result.current.width).toBe(Math.round(Math.min(window.innerWidth * 0.6, window.innerWidth - 380 - 160)));
    act(() => ui().setPanelWidth('left', Math.ceil(window.innerWidth * 0.5)));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggleExpanded());
    expect(result.current.width).toBe(300);
  });
});

describe('useDocumentViewerViewModel', () => {
  const detail = (o: Partial<DocumentDetail> = {}): DocumentDetail => ({
    ...makeDoc(1),
    content: 'a\r\nb\rc\nd',
    chunks: [],
    mentions: [
      { chunk_id: 1, node_id: 2, matched: 'B', method: 'exact', confidence: 1 },
      { chunk_id: 2, node_id: 2, matched: 'B', method: 'exact', confidence: 1 },
      { chunk_id: 2, node_id: 99, matched: 'Z', method: 'fuzzy', confidence: 0.5 },
    ],
    ...o,
  });

  it('fechado: não busca nada', () => {
    const get = vi.spyOn(DocumentApi.getInstance(), 'get');
    const { result } = renderHook(() => useDocumentViewerViewModel());
    expect(result.current).toMatchObject({ open: false, doc: null, lines: [], mentionedNodes: [], firstHighlightedLine: null });
    expect(result.current.isHighlighted(1)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('carrega o documento, destaca linhas e lista nós mencionados', async () => {
    seedSample();
    vi.spyOn(DocumentApi.getInstance(), 'get').mockResolvedValue(detail());
    useUiStore.setState({ docViewer: { documentId: 1, startLine: 2, endLine: 3 } });
    const { result } = renderHook(() => useDocumentViewerViewModel());
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    expect(result.current.lines).toEqual(['a', 'b', 'c', 'd']);
    expect([1, 2, 3, 4].map((l) => result.current.isHighlighted(l))).toEqual([false, true, true, false]);
    expect(result.current.firstHighlightedLine).toBe(2);
    expect(result.current.mentionedNodes).toEqual([{ id: 2, name: 'B', path: 'A / B' }]);
    act(() => ui().openDocument({ documentId: 1, startLine: 4 }));
    expect([3, 4].map((l) => result.current.isHighlighted(l))).toEqual([false, true]);
    act(() => result.current.focusNode(2));
    expect(ui()).toMatchObject({ selection: { type: 'node', id: 2 }, focusId: 2, docViewer: null });
  });

  it('erro de carregamento, Esc e fechar', async () => {
    vi.spyOn(DocumentApi.getInstance(), 'get').mockRejectedValue(new Error('404'));
    useUiStore.setState({ docViewer: { documentId: 5 }, focusId: 1 });
    const { result } = renderHook(() => useDocumentViewerViewModel());
    await waitFor(() => expect(result.current.error).toBe('404'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current.open).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.open).toBe(false);
    act(() => ui().openDocument({ documentId: 5 }));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

describe('useIconPickerViewModel', () => {
  it('automático, busca agrupada e escolha', () => {
    const onChange = vi.fn<(v: string | null) => void>();
    const { result } = renderHook(() => useIconPickerViewModel({ value: null, onChange, kind: 'database', tech: 'mysql' }));
    expect(result.current).toMatchObject({ effective: 'si:mysql', isAuto: true, label: 'Automático (MySQL)', open: false });
    expect(result.current.color).toMatch(/^#/);
    act(() => result.current.setQuery('mysql'));
    expect(result.current.groups).toEqual([{ group: 'Bancos de dados', icons: [expect.objectContaining({ id: 'si:mysql' })] }]);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(result.current.placement).toEqual({});
    act(() => result.current.choose('lu:database'));
    expect(onChange).toHaveBeenCalledWith('lu:database');
    expect(result.current).toMatchObject({ open: false, query: '' });
    expect(result.current.isSelected('lu:database')).toBe(false);
  });

  it('valor escolhido: rótulo do catálogo ou o próprio id', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useIconPickerViewModel({ value, onChange: vi.fn<(v: string | null) => void>(), kind: 'service', tech: '' }),
      {
        initialProps: { value: 'si:mysql' as string | null },
      },
    );
    expect(result.current).toMatchObject({ label: 'MySQL', isAuto: false });
    expect(result.current.isSelected('si:mysql')).toBe(true);
    rerender({ value: 'si:desconhecido' });
    expect(result.current.label).toBe('si:desconhecido');
  });

  it('posiciona o popover abaixo ou acima e fecha ao clicar fora', () => {
    const { result } = renderHook(() => useIconPickerViewModel({ value: null, onChange: vi.fn<(v: string | null) => void>(), kind: 'service', tech: '' }));
    const el = document.body.appendChild(document.createElement('div'));
    const inner = el.appendChild(document.createElement('span'));
    (result.current.rootRef as { current: HTMLDivElement | null }).current = el;
    const rect = (top: number, bottom: number, left = 10) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top, bottom, left } as DOMRect);
    rect(50, 80);
    act(() => result.current.toggle());
    expect(result.current.placement).toMatchObject({ position: 'fixed', left: 10, top: 86 });
    act(() => {
      inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.open).toBe(true);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.open).toBe(false);
    rect(window.innerHeight - 40, window.innerHeight - 10, 5000);
    act(() => result.current.toggle());
    expect(result.current.placement).toMatchObject({ bottom: 46, left: window.innerWidth - 328 });
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    el.remove();
  });
});
