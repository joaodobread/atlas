import type { LoginInput, SetupInput } from '../../shared/schemas.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { HttpService } from '../core/http/HttpService.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { AuthApi } from './api/AuthApi.ts';

/** Ciclo de vida da sessão: status inicial, login/setup/logout e reação a 401. */
export class AuthSession {
  private static instance: AuthSession | undefined;

  private constructor(
    private readonly api: AuthApi,
    http: HttpService,
  ) {
    http.onUnauthorized(() => useAuthStore.getState().signOut());
  }

  static getInstance(): AuthSession {
    return (AuthSession.instance ??= new AuthSession(AuthApi.getInstance(), HttpService.getInstance()));
  }

  async load(): Promise<void> {
    try {
      useAuthStore.getState().apply(await this.api.status());
    } catch (err) {
      useAuthStore.getState().fail(errorMessage(err));
    }
  }

  async login(input: LoginInput): Promise<void> {
    useAuthStore.getState().apply(await this.api.login(input));
  }

  async setup(input: SetupInput): Promise<void> {
    useAuthStore.getState().apply(await this.api.setup(input));
  }

  async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    useAuthStore.getState().signOut();
  }
}
