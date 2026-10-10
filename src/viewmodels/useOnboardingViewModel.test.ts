import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../data/api/AuthApi.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeUser, resetStores, toasts } from '../testing/vmFixtures.ts';
import { restartOnboarding, TOUR_STEPS, useOnboardingViewModel } from './useOnboardingViewModel.ts';

const ui = () => useUiStore.getState();
const fresh = makeUser({ onboarded_at: null });

beforeEach(() => resetStores());
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useOnboardingViewModel', () => {
  it('inativo sem usuário ou com tutorial concluído', () => {
    const { result } = renderHook(() => useOnboardingViewModel());
    expect(result.current.active).toBe(false);
    act(() => useAuthStore.setState({ user: makeUser() }));
    expect(result.current.active).toBe(false);
  });

  it('percorre os passos preparando a tela e medindo o alvo', async () => {
    const nav = document.body.appendChild(document.createElement('div'));
    nav.setAttribute('data-tour', 'nav');
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ x: 1, y: 2, width: 3, height: 4 } as DOMRect);
    useAuthStore.setState({ user: fresh });
    useUiStore.setState({ screen: 'settings' });
    const { result } = renderHook(() => useOnboardingViewModel());
    expect(result.current).toMatchObject({ active: true, index: 0, total: TOUR_STEPS.length, isLast: false, rect: null });
    expect(ui().screen).toBe('graph');
    act(() => result.current.back());
    expect(result.current.index).toBe(0);

    act(() => result.current.next());
    expect(result.current.step.target).toBe('[data-tour="nav"]');
    await waitFor(() => expect(result.current.rect).toMatchObject({ x: 1, width: 3 }));
    act(() => result.current.next());
    expect(result.current.rect).toBeNull();
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.index).toBe(2);
    act(() => result.current.next());

    // "Monte o grafo": abre a árvore se estiver fechada; já aberta não alterna.
    act(() => ui().toggleLeft('tree'));
    expect(ui().leftOpen).toBe(false);
    act(() => result.current.next());
    expect(ui()).toMatchObject({ leftOpen: true, leftTab: 'tree' });
    act(() => result.current.back());
    act(() => result.current.next());
    expect(ui()).toMatchObject({ leftOpen: true, leftTab: 'tree' });

    // "Documentos": troca para a aba de documentos.
    act(() => result.current.next());
    expect(ui()).toMatchObject({ leftOpen: true, leftTab: 'docs' });
    act(() => result.current.back());
    act(() => ui().setLeftTab('docs'));
    act(() => result.current.next());
    expect(ui()).toMatchObject({ leftOpen: true, leftTab: 'docs' });

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.isLast).toBe(true);
  });

  it('concluir no último passo marca como visto', async () => {
    const setOnboarded = vi
      .spyOn(AuthApi.getInstance(), 'setOnboarded')
      .mockResolvedValue({ needsSetup: false, user: makeUser(), permissions: ['graph:read'] });
    useAuthStore.setState({ user: fresh });
    const { result } = renderHook(() => useOnboardingViewModel());
    for (let i = 1; i < TOUR_STEPS.length; i++) act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.active).toBe(false);
    await waitFor(() => expect(useAuthStore.getState().user?.onboarded_at).not.toBeNull());
    expect(setOnboarded).toHaveBeenCalledWith(true);
  });

  it('pular com erro avisa e reativar recomeça do início', async () => {
    vi.spyOn(AuthApi.getInstance(), 'setOnboarded').mockRejectedValue(new Error('offline'));
    useAuthStore.setState({ user: fresh });
    const { result } = renderHook(() => useOnboardingViewModel());
    act(() => result.current.next());
    act(() => result.current.skip());
    expect(result.current.active).toBe(false);
    await waitFor(() => expect(toasts()).toEqual([['error', 'offline']]));
    act(() => useAuthStore.setState({ user: makeUser() }));
    act(() => useAuthStore.setState({ user: makeUser({ onboarded_at: null }) }));
    expect(result.current).toMatchObject({ active: true, index: 0 });
  });
});

describe('restartOnboarding', () => {
  it('reabre o tutorial e volta para o grafo', async () => {
    vi.spyOn(AuthApi.getInstance(), 'setOnboarded').mockResolvedValue({ needsSetup: false, user: fresh, permissions: [] });
    useUiStore.setState({ screen: 'settings' });
    await restartOnboarding();
    expect(useAuthStore.getState().user?.onboarded_at).toBeNull();
    expect(ui().screen).toBe('graph');
  });
});
