import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpService } from '../core/http/HttpService.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { makeUser, resetSingleton, resetStores } from '../testing/vmFixtures.ts';
import { AuthApi } from './api/AuthApi.ts';
import { AuthSession } from './AuthSession.ts';

const authed = { needsSetup: false, user: makeUser(), permissions: ['graph:read' as const] };

beforeEach(() => {
  resetStores();
  resetSingleton(AuthSession);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthSession', () => {
  it('registra o handler de 401 que encerra a sessão', () => {
    const spy = vi.spyOn(HttpService.getInstance(), 'onUnauthorized');
    const session = AuthSession.getInstance();
    expect(AuthSession.getInstance()).toBe(session);
    useAuthStore.getState().apply(authed);
    spy.mock.calls[0]![0]();
    expect(useAuthStore.getState().phase).toBe('anonymous');
  });

  it('load aplica o status ou marca offline', async () => {
    const status = vi.spyOn(AuthApi.getInstance(), 'status').mockResolvedValueOnce(authed);
    await AuthSession.getInstance().load();
    expect(useAuthStore.getState().phase).toBe('authenticated');
    status.mockRejectedValueOnce(new Error('sem rede'));
    await AuthSession.getInstance().load();
    expect(useAuthStore.getState()).toMatchObject({ phase: 'offline', error: 'sem rede' });
  });

  it('login, setup e logout', async () => {
    const api = AuthApi.getInstance();
    vi.spyOn(api, 'login').mockResolvedValue(authed);
    vi.spyOn(api, 'setup').mockResolvedValue({ needsSetup: true, user: null, permissions: [] });
    const logout = vi.spyOn(api, 'logout').mockRejectedValue(new Error('x'));
    const s = AuthSession.getInstance();
    await s.login({ email: 'a@b.com', password: 'x' });
    expect(useAuthStore.getState().user?.id).toBe(1);
    await s.setup({ name: 'a', email: 'a@b.com', password: 'xxxxxxxx' });
    expect(useAuthStore.getState().phase).toBe('needs-setup');
    useAuthStore.getState().apply(authed);
    await s.logout();
    expect(logout).toHaveBeenCalled();
    expect(useAuthStore.getState().phase).toBe('anonymous');
  });
});
