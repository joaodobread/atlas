import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { ApiTokenView, AuthStatus, CreatedApiToken } from '../../../shared/types.ts';
import type { ChangePasswordInput, CreateApiTokenInput, LoginInput, SetupInput } from '../../../shared/schemas.ts';

export class AuthApi {
  private static instance: AuthApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): AuthApi {
    return (AuthApi.instance ??= new AuthApi(http));
  }

  status(): Promise<AuthStatus> {
    return this.http.get('/auth/status');
  }

  setup(input: SetupInput): Promise<AuthStatus> {
    return this.http.post('/auth/setup', input);
  }

  login(input: LoginInput): Promise<AuthStatus> {
    return this.http.post('/auth/login', input);
  }

  logout(): Promise<void> {
    return this.http.post('/auth/logout');
  }

  /** Marca o tutorial como concluído (true) ou para mostrar de novo (false). */
  setOnboarded(done: boolean): Promise<AuthStatus> {
    return this.http.post('/auth/onboarding', { done });
  }

  changePassword(input: ChangePasswordInput): Promise<void> {
    return this.http.post('/auth/password', input);
  }

  tokens(): Promise<ApiTokenView[]> {
    return this.http.get('/auth/tokens');
  }

  createToken(input: CreateApiTokenInput): Promise<CreatedApiToken> {
    return this.http.post('/auth/tokens', input);
  }

  revokeToken(id: number): Promise<void> {
    return this.http.delete(`/auth/tokens/${id}`);
  }
}
