import { changePasswordSchema, createApiTokenSchema, idParamSchema, loginSchema, onboardingSchema, setupSchema } from '../../../shared/schemas.ts';
import type { IApiTokenService, IAuthService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, noContent, ok, type HttpResponse } from '../HttpResponse.ts';
import { SESSION_COOKIE } from '../middlewares/AuthMiddleware.ts';

export class AuthController {
  constructor(
    private readonly auth: IAuthService,
    private readonly apiTokens: IApiTokenService,
  ) {}

  async status(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.auth.status(req.user));
  }

  async setup(req: HttpRequest): Promise<HttpResponse> {
    const s = await this.auth.setup(setupSchema.parse(req.body), { ip: req.ip, userAgent: req.userAgent });
    return ok(s.status, [{ name: SESSION_COOKIE, value: s.token, expires: s.expiresAt }]);
  }

  async login(req: HttpRequest): Promise<HttpResponse> {
    const s = await this.auth.login(loginSchema.parse(req.body), { ip: req.ip, userAgent: req.userAgent });
    return ok(s.status, [{ name: SESSION_COOKIE, value: s.token, expires: s.expiresAt }]);
  }

  async logout(req: HttpRequest): Promise<HttpResponse> {
    await this.auth.logout(req.cookies[SESSION_COOKIE] ?? null);
    return noContent([{ name: SESSION_COOKIE, value: null }]);
  }

  async onboarding(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.auth.setOnboarded(req.user!, onboardingSchema.parse(req.body).done));
  }

  async changePassword(req: HttpRequest): Promise<HttpResponse> {
    await this.auth.changePassword(req.user!, changePasswordSchema.parse(req.body));
    return noContent();
  }

  async listTokens(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.apiTokens.list(req.user!));
  }

  async createToken(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.apiTokens.create(req.user!, createApiTokenSchema.parse(req.body)));
  }

  async revokeToken(req: HttpRequest): Promise<HttpResponse> {
    await this.apiTokens.revoke(req.user!, idParamSchema.parse(req.params.id));
    return noContent();
  }
}
