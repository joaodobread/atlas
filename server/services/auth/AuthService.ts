import { ROLE_PERMISSIONS } from '../../../shared/constants.ts';
import type { AuthStatus } from '../../../shared/types.ts';
import type { ChangePasswordInput, LoginInput, SetupInput } from '../../../shared/schemas.ts';
import { AuthUser } from '../../core/auth/AuthUser.ts';
import { BusinessRuleError, TooManyRequestsError, UnauthorizedError } from '../../core/errors/AppError.ts';
import type { IPasswordHasher } from '../../infra/crypto/IPasswordHasher.ts';
import type { ITokenService } from '../../infra/crypto/TokenService.ts';
import type { IApiTokenRepository, ISessionRepository, IUserRepository } from '../../repositories/contracts/IUserRepository.ts';
import type { IAuthService, LoginContext, SessionResult } from '../contracts/index.ts';
import type { ILoginThrottle } from './LoginThrottle.ts';

const DAY_MS = 86_400_000;
/** Hash válido de uma senha qualquer: usado quando o e-mail não existe, para o tempo de resposta não revelar isso. */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class AuthService implements IAuthService {
  constructor(
    private readonly users: IUserRepository,
    private readonly sessions: ISessionRepository,
    private readonly apiTokens: IApiTokenRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
    private readonly throttle: ILoginThrottle,
    private readonly sessionDays: number,
  ) {}

  async status(user: AuthUser | null): Promise<AuthStatus> {
    return {
      needsSetup: (await this.users.count()) === 0,
      user: user?.user ?? null,
      permissions: user ? [...ROLE_PERMISSIONS[user.user.role]] : [],
    };
  }

  async setup(input: SetupInput, ctx: LoginContext): Promise<SessionResult> {
    if ((await this.users.count()) > 0) throw new BusinessRuleError('O sistema já foi configurado');
    const user = await this.users.create({ ...input, role: 'admin', password_hash: await this.hasher.hash(input.password) });
    return await this.startSession(user.id, ctx);
  }

  async login(input: LoginInput, ctx: LoginContext): Promise<SessionResult> {
    const keys = [`email:${input.email}`, ...(ctx.ip ? [`ip:${ctx.ip}`] : [])];
    if (keys.some((k) => this.throttle.isBlocked(k))) {
      throw new TooManyRequestsError('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    }
    const user = await this.users.findByEmailWithSecret(input.email);
    const valid = await this.hasher.verify(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid || !user.active) {
      keys.forEach((k) => this.throttle.fail(k));
      throw new UnauthorizedError('E-mail ou senha inválidos');
    }
    keys.forEach((k) => this.throttle.reset(k));
    return await this.startSession(user.id, ctx);
  }

  async logout(sessionToken: string | null): Promise<void> {
    if (sessionToken) await this.sessions.delete(this.tokens.hash(sessionToken));
  }

  async authenticate({ sessionToken, bearerToken }: { sessionToken: string | null; bearerToken: string | null }): Promise<AuthUser | null> {
    if (bearerToken) {
      const hash = this.tokens.hash(bearerToken);
      const userId = await this.apiTokens.findUserIdByHash(hash);
      const user = userId != null ? await this.users.findById(userId) : null;
      if (!user?.active) return null;
      await this.apiTokens.touch(hash);
      return new AuthUser(user, 'token');
    }
    if (sessionToken) {
      const hash = this.tokens.hash(sessionToken);
      const session = await this.sessions.findValid(hash);
      const user = session ? await this.users.findById(session.user_id) : null;
      if (!session || !user?.active) return null;
      // Renovação deslizante, no máximo uma vez por hora.
      const expires = new Date(session.expires_at).getTime();
      if (expires - Date.now() < this.sessionDays * DAY_MS - 3_600_000) await this.sessions.extend(hash, this.expiry());
      return new AuthUser(user, 'session');
    }
    return null;
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void> {
    const current = await this.users.findByIdWithSecret(user.id);
    if (!current || !(await this.hasher.verify(input.currentPassword, current.password_hash))) {
      throw new BusinessRuleError('Senha atual incorreta');
    }
    await this.users.update(user.id, { password_hash: await this.hasher.hash(input.newPassword) });
  }

  async setOnboarded(user: AuthUser, done: boolean): Promise<AuthStatus> {
    await this.users.setOnboarded(user.id, done);
    const fresh = (await this.users.findById(user.id))!;
    return await this.status(new AuthUser(fresh, user.via));
  }

  private async startSession(userId: number, ctx: LoginContext): Promise<SessionResult> {
    await this.sessions.deleteExpired();
    const token = this.tokens.generate('cgs');
    const expiresAt = this.expiry();
    await this.sessions.create(this.tokens.hash(token), userId, expiresAt, ctx.userAgent?.slice(0, 300) ?? null);
    await this.users.touchLogin(userId);
    const user = (await this.users.findById(userId))!;
    return { token, expiresAt, status: await this.status(new AuthUser(user, 'session')) };
  }

  private expiry(): Date {
    return new Date(Date.now() + this.sessionDays * DAY_MS);
  }
}
