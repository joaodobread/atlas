import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { NodeMention } from '../../shared/types.ts';
import { HttpError } from '../core/http/HttpError.ts';
import { AuthSession } from '../data/AuthSession.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeConn, makeNode, resetStores, seedGraph, setPermissions, toasts } from '../testing/vmFixtures.ts';
import { useAuthFormViewModel } from './useAuthFormViewModel.ts';
import { useCommand } from './useCommand.ts';
import { idOrNull, useForm } from './useForm.ts';
import { useNodeMentionsViewModel } from './useNodeMentionsViewModel.ts';
import { usePermissions } from './usePermissions.ts';
import { useRootViewModel } from './useRootViewModel.ts';
import { useSceneOverlayViewModel } from './useSceneOverlayViewModel.ts';
import { useSceneToolbarViewModel } from './useSceneToolbarViewModel.ts';
import { useSettingsScreenViewModel } from './useSettingsScreenViewModel.ts';
import { useToastViewModel } from './useToastViewModel.ts';

beforeEach(() => resetStores());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('usePermissions', () => {
  it('expõe flags conforme as permissões', () => {
    setPermissions('graph:write', 'users:manage');
    const { result } = renderHook(() => usePermissions());
    expect(result.current).toMatchObject({ canEditGraph: true, canEditDocs: false, canManageSettings: false, canManageUsers: true });
    expect(result.current.can('graph:write')).toBe(true);
    expect(result.current.can('docs:read')).toBe(false);
  });
});

describe('useForm', () => {
  it('set altera valor e limpa o erro do campo; validate preenche erros', () => {
    const { result } = renderHook(() => useForm({ name: '', age: 0 }));
    const schema = z.object({ name: z.string().min(1, 'Obrigatório'), age: z.number().min(1, 'idade').min(2, 'segunda') });
    let out: unknown;
    act(() => {
      out = result.current.validate(schema, result.current.values);
    });
    expect(out).toBeNull();
    expect(result.current.errors).toEqual({ name: 'Obrigatório', age: 'idade' });
    act(() => result.current.set('name', 'x'));
    expect(result.current.values.name).toBe('x');
    expect(result.current.errors).toEqual({ age: 'idade' });
    const before = result.current.errors;
    act(() => result.current.set('name', 'y'));
    expect(result.current.errors).toBe(before);
    act(() => {
      out = result.current.validate(schema, { name: 'a', age: 3 });
    });
    expect(out).toEqual({ name: 'a', age: 3 });
    expect(result.current.errors).toEqual({});
  });

  it('erro sem caminho vai para "_"; reset limpa tudo', () => {
    const { result } = renderHook(() => useForm({ a: 1 }));
    act(() => {
      result.current.validate(z.string(), 5);
    });
    expect(Object.keys(result.current.errors)).toEqual(['_']);
    act(() => result.current.reset({ a: 2 }));
    expect(result.current.values).toEqual({ a: 2 });
    expect(result.current.errors).toEqual({});
  });

  it('idOrNull', () => {
    expect(idOrNull('')).toBeNull();
    expect(idOrNull('4')).toBe(4);
  });
});

describe('useCommand', () => {
  it('executa, recarrega o grafo e avisa sucesso', async () => {
    const reload = vi.spyOn(GraphSync.getInstance(), 'reload').mockResolvedValue();
    const { result } = renderHook(() => useCommand());
    let out: unknown;
    await act(async () => {
      out = await result.current.run(async () => 7, 'feito');
    });
    expect(out).toBe(7);
    expect(reload).toHaveBeenCalled();
    expect(toasts()).toEqual([['success', 'feito']]);
    expect(result.current.busy).toBe(false);
    await act(async () => {
      out = await result.current.run(async () => 8);
    });
    expect(toasts()).toHaveLength(1);
  });

  it('erro vira toast e retorna undefined', async () => {
    const { result } = renderHook(() => useCommand());
    let out: unknown = 'x';
    await act(async () => {
      out = await result.current.run(() => Promise.reject(new HttpError(400, 'ruim', [{ path: 'name', message: 'curto' }])));
    });
    expect(out).toBeUndefined();
    expect(toasts()).toEqual([['error', 'ruim: name: curto']]);
  });
});

describe('useToastViewModel', () => {
  it('dispensa toasts após o tempo (erros ficam o dobro)', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToastViewModel());
    act(() => {
      useUiStore.getState().pushToast('info', 'i');
      useUiStore.getState().pushToast('error', 'e');
    });
    expect(result.current.toasts).toHaveLength(2);
    act(() => vi.advanceTimersByTime(4500));
    expect(result.current.toasts.map((t) => t.kind)).toEqual(['error']);
    act(() => vi.advanceTimersByTime(9000));
    expect(result.current.toasts).toHaveLength(0);
    act(() => useUiStore.getState().pushToast('info', 'z'));
    act(() => result.current.dismiss(result.current.toasts[0]!.id));
    expect(result.current.toasts).toHaveLength(0);
    unmount();
  });
});

describe('useRootViewModel', () => {
  it('carrega a sessão ao montar e no retry', () => {
    const load = vi.spyOn(AuthSession.getInstance(), 'load').mockResolvedValue();
    useAuthStore.setState({ phase: 'offline', error: 'x' });
    const { result } = renderHook(() => useRootViewModel());
    expect(result.current).toMatchObject({ phase: 'offline', error: 'x' });
    result.current.retry();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('useSceneOverlayViewModel', () => {
  it('trilha do foco, legenda e ações', () => {
    seedGraph({ nodes: [makeNode(1, null, { name: 'A', kind: 'project' }), makeNode(2, 1, { name: 'B', kind: 'database' })] });
    useUiStore.setState({ focusId: 2 });
    const { result } = renderHook(() => useSceneOverlayViewModel());
    expect(result.current.inFocus).toBe(true);
    expect(result.current.trail).toEqual([
      { id: 1, name: 'A', current: false },
      { id: 2, name: 'B', current: true },
    ]);
    expect(result.current.legend.map((l) => l.kind)).toEqual(['project', 'database']);
    act(() => result.current.focusOn(1));
    expect(useUiStore.getState()).toMatchObject({ focusId: 1, selection: { type: 'node', id: 1 } });
    act(() => result.current.exitFocus());
    expect(result.current.inFocus).toBe(false);
    expect(result.current.trail).toEqual([]);
  });
});

describe('useNodeMentionsViewModel', () => {
  const mention: NodeMention = {
    chunkId: 1,
    documentId: 3,
    path: 'a\\b/c.md',
    title: 't',
    heading: 'h',
    startLine: 1,
    endLine: 2,
    matched: 'x',
    method: 'exact',
    confidence: 1,
    excerpt: '',
  };

  it('carrega menções e abre o documento', async () => {
    vi.spyOn(DocumentApi.getInstance(), 'mentionsOfNode').mockResolvedValue([mention]);
    const { result } = renderHook(() => useNodeMentionsViewModel(1));
    expect(result.current.mentions).toBeNull();
    await waitFor(() => expect(result.current.mentions).toHaveLength(1));
    expect(result.current.fileName(mention.path)).toBe('c.md');
    // Fallback defensivo: sem segmentos devolve o próprio valor.
    const weird = { split: () => [] } as unknown as string;
    expect(result.current.fileName(weird)).toBe(weird);
    act(() => result.current.open(mention));
    expect(useUiStore.getState().docViewer).toEqual({ documentId: 3, startLine: 1, endLine: 2 });
  });

  it('erro vira lista vazia; respostas após desmontar são ignoradas', async () => {
    const spy = vi.spyOn(DocumentApi.getInstance(), 'mentionsOfNode').mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useNodeMentionsViewModel(1));
    await waitFor(() => expect(result.current.mentions).toEqual([]));
    let resolve!: (m: NodeMention[]) => void;
    let reject!: (e: Error) => void;
    spy.mockReturnValueOnce(new Promise((r) => (resolve = r))).mockReturnValueOnce(new Promise((_r, j) => (reject = j)));
    const a = renderHook(() => useNodeMentionsViewModel(2));
    a.unmount();
    const b = renderHook(() => useNodeMentionsViewModel(3));
    b.unmount();
    await act(async () => {
      resolve([mention]);
      reject(new Error('y'));
      await Promise.resolve();
    });
    expect(a.result.current.mentions).toBeNull();
    expect(b.result.current.mentions).toBeNull();
  });
});

describe('useSettingsScreenViewModel', () => {
  it('sem permissões: só "Minha conta", mesmo pedindo outra seção', () => {
    useUiStore.setState({ settingsSection: 'users' });
    const { result } = renderHook(() => useSettingsScreenViewModel());
    expect(result.current.groups).toEqual([{ name: 'Pessoal', items: [expect.objectContaining({ id: 'account' })] }]);
    expect(result.current.current.id).toBe('account');
  });

  it('admin vê todas as seções agrupadas; select e back', () => {
    setPermissions('users:manage', 'settings:manage');
    useUiStore.setState({ settingsSection: 'github', screen: 'settings' });
    const { result } = renderHook(() => useSettingsScreenViewModel());
    expect(result.current.groups.map((g) => g.name)).toEqual(['Pessoal', 'Administração', 'Integrações']);
    expect(result.current.groups[2]!.items.map((i) => i.id)).toEqual(['llm', 'github']);
    expect(result.current.current.id).toBe('github');
    expect(result.current.current).not.toHaveProperty('allowed');
    act(() => result.current.select('llm'));
    expect(result.current.current.id).toBe('llm');
    act(() => result.current.back());
    expect(useUiStore.getState().screen).toBe('graph');
  });
});

describe('useSceneToolbarViewModel', () => {
  beforeEach(() => {
    seedGraph({ nodes: [makeNode(1), makeNode(2, 1), makeNode(3)], connections: [makeConn(1, 2, 3)] });
  });

  it('2D em grupos: layouts, sem ímã e sem reorganizar', () => {
    const { result } = renderHook(() => useSceneToolbarViewModel());
    expect(result.current.layouts.map((l) => l.mode)).toEqual(['groups', 'layers', 'free']);
    expect(result.current).toMatchObject({ showMagnet: false, showReorganize: false, canExport: true, stats: '3 nós · 1 conexões' });
    act(() => result.current.setLayoutMode('free'));
    expect(result.current).toMatchObject({ showMagnet: true, showReorganize: true });
    act(() => result.current.setLayoutMode('layers'));
    expect(result.current).toMatchObject({ showMagnet: false, showReorganize: true });
    act(() => result.current.setViewMode('3d'));
    expect(result.current).toMatchObject({ layouts: [], showMagnet: false, showReorganize: false, canExport: false });
  });

  it('expandir/recolher tudo, enquadrar, reorganizar, exportar e ímã', () => {
    const { result } = renderHook(() => useSceneToolbarViewModel());
    act(() => result.current.expandAll());
    expect([...useUiStore.getState().expanded]).toEqual([1]);
    act(() => result.current.collapseAll());
    expect(useUiStore.getState().expanded.size).toBe(0);
    act(() => result.current.fit());
    act(() => result.current.reorganize());
    act(() => result.current.exportPng());
    expect(useUiStore.getState().exportRequest).toEqual({ format: 'png', seq: 1 });
    act(() => result.current.exportSvg());
    expect(useUiStore.getState().exportRequest).toEqual({ format: 'svg', seq: 2 });
    act(() => result.current.toggleMagnet());
    expect(result.current.magnet).toBe(false);
    expect(useUiStore.getState().reorganizeRequest).toBe(1);
  });
});

describe('useAuthFormViewModel', () => {
  it('setup: valida, confere senhas, envia e mostra erro da API', async () => {
    const setup = vi.spyOn(AuthSession.getInstance(), 'setup').mockRejectedValueOnce(new Error('já existe')).mockResolvedValueOnce();
    const { result } = renderHook(() => useAuthFormViewModel('setup'));
    await act(() => result.current.submit());
    expect(result.current.form.errors).toHaveProperty('email');
    act(() => {
      result.current.form.set('name', 'Ana');
      result.current.form.set('email', 'A@B.com');
      result.current.form.set('password', '12345678');
      result.current.form.set('confirm', 'outra');
    });
    await act(() => result.current.submit());
    expect(result.current.error).toBe('As senhas não conferem');
    act(() => result.current.form.set('confirm', '12345678'));
    await act(() => result.current.submit());
    expect(setup).toHaveBeenCalledWith({ name: 'Ana', email: 'a@b.com', password: '12345678' });
    expect(result.current.error).toBe('já existe');
    expect(result.current.busy).toBe(false);
    await act(() => result.current.submit());
    expect(result.current.error).toBeNull();
  });

  it('login: valida e envia', async () => {
    const login = vi.spyOn(AuthSession.getInstance(), 'login').mockRejectedValueOnce(new HttpError(401, 'Credenciais inválidas'));
    const { result } = renderHook(() => useAuthFormViewModel('login'));
    expect(result.current.mode).toBe('login');
    await act(() => result.current.submit());
    expect(login).not.toHaveBeenCalled();
    act(() => {
      result.current.form.set('email', 'a@b.com');
      result.current.form.set('password', 'x');
    });
    await act(() => result.current.submit());
    expect(login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'x' });
    expect(result.current.error).toBe('Credenciais inválidas');
  });
});
