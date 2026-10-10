import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { User } from '../../../shared/types.ts';
import { AuthUser } from '../../core/auth/AuthUser.ts';
import { BusinessRuleError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../../core/errors/AppError.ts';
import type { IPasswordHasher } from '../../infra/crypto/IPasswordHasher.ts';
import { TokenService } from '../../infra/crypto/TokenService.ts';
import type { PostgresDatabase } from '../../infra/database/PostgresDatabase.ts';
import { PgApiTokenRepository, PgSessionRepository, PgUserRepository } from '../../repositories/postgres/PgUserRepository.ts';
import { ApiTokenService } from './ApiTokenService.ts';
import { AuthService } from './AuthService.ts';
import { LoginThrottle } from './LoginThrottle.ts';
import { UserService } from './UserService.ts';

/** Hasher trivial (o real é lento de propósito). */
class FakeHasher implements IPasswordHasher {
  hash(password: string): Promise<string> {
    return Promise.resolve(`h:${password}`);
  }
  verify(password: string, stored: string): Promise<boolean> {
    return Promise.resolve(stored === `h:${password}`);
  }
}

const ctx = { ip: '10.0.0.1', userAgent: 'vitest' };
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

let db: PostgresDatabase;
let users: PgUserRepository;
let sessions: PgSessionRepository;
let apiTokens: PgApiTokenRepository;
let tokens: TokenService;
let throttle: LoginThrottle;
let auth: AuthService;
let userService: UserService;
let apiTokenService: ApiTokenService;

beforeEach(async () => {
  db = await testDatabase();
  await resetDatabase(db);
  users = new PgUserRepository(db);
  sessions = new PgSessionRepository(db);
  apiTokens = new PgApiTokenRepository(db);
  tokens = new TokenService();
  throttle = new LoginThrottle(3, 60_000);
  const hasher = new FakeHasher();
  auth = new AuthService(users, sessions, apiTokens, hasher, tokens, throttle, SESSION_DAYS);
  userService = new UserService(users, sessions, hasher);
  apiTokenService = new ApiTokenService(apiTokens, tokens);
});

const sessionCount = async () => (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM sessions'))!.n;

async function setupAdmin() {
  const r = await auth.setup({ name: 'Admin', email: 'admin@x.com', password: 'senha-forte' }, ctx);
  return { ...r, admin: new AuthUser(r.status.user!, 'session') };
}

describe('AuthService', () => {
  afterEach(() => vi.useRealTimers());

  it('status sem usuários pede setup e não tem permissões', async () => {
    expect(await auth.status(null)).toEqual({ needsSetup: true, user: null, permissions: [] });
  });

  it('setup cria o primeiro admin com sessão; não pode ser repetido', async () => {
    const { token, expiresAt, status } = await setupAdmin();
    expect(token).toMatch(/^cgs_/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_DAYS - 1) * DAY_MS);
    expect(status).toMatchObject({ needsSetup: false, user: { email: 'admin@x.com', role: 'admin' } });
    expect(status.permissions).toContain('users:manage');
    expect(status.user!.last_login_at).not.toBeNull();
    const row = await db.get<{ token_hash: string; user_agent: string }>('SELECT token_hash, user_agent FROM sessions');
    expect(row).toEqual({ token_hash: tokens.hash(token), user_agent: 'vitest' });
    await expect(auth.setup({ name: 'B', email: 'b@x.com', password: 'outra-senha' }, ctx)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('login com credenciais corretas abre sessão (userAgent ausente vira null) e limpa sessões expiradas', async () => {
    const { status } = await setupAdmin();
    await db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('velha', ?, now() - interval '1 day')", [status.user!.id]);
    const r = await auth.login({ email: 'admin@x.com', password: 'senha-forte' }, { ip: null, userAgent: null });
    expect(r.status.user?.email).toBe('admin@x.com');
    expect(await db.get("SELECT 1 FROM sessions WHERE token_hash = 'velha'")).toBeNull();
    expect(await db.get<{ user_agent: string | null }>('SELECT user_agent FROM sessions WHERE token_hash = ?', [tokens.hash(r.token)])).toEqual({
      user_agent: null,
    });
  });

  it('login inválido: senha errada, e-mail inexistente e usuário inativo', async () => {
    const { status, admin } = await setupAdmin();
    await expect(auth.login({ email: 'admin@x.com', password: 'errada' }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.login({ email: 'ninguem@x.com', password: 'qualquer' }, ctx)).rejects.toThrow('E-mail ou senha inválidos');
    const other = await userService.create({ name: 'Edu', email: 'edu@x.com', role: 'editor', password: 'senha-edu1' });
    await userService.update(admin, other.id, { active: false });
    await expect(auth.login({ email: 'edu@x.com', password: 'senha-edu1' }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(UnauthorizedError);
    expect(status.user).not.toBeNull();
  });

  it('bloqueia após falhas repetidas (por e-mail e por IP) e zera no sucesso', async () => {
    await setupAdmin();
    await expect(auth.login({ email: 'admin@x.com', password: 'errada' }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.login({ email: 'admin@x.com', password: 'errada' }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    await auth.login({ email: 'admin@x.com', password: 'senha-forte' }, ctx);
    expect(throttle.isBlocked('email:admin@x.com')).toBe(false);

    for (let i = 0; i < 3; i++) await expect(auth.login({ email: 'x@x.com', password: 'e' }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    // O IP ficou bloqueado: até a senha correta do admin é recusada desse IP.
    await expect(auth.login({ email: 'admin@x.com', password: 'senha-forte' }, ctx)).rejects.toBeInstanceOf(TooManyRequestsError);
    // De outro IP passa.
    await expect(auth.login({ email: 'admin@x.com', password: 'senha-forte' }, { ip: '10.0.0.2', userAgent: null })).resolves.toBeTruthy();
  });

  it('authenticate por sessão; logout derruba a sessão', async () => {
    const { token } = await setupAdmin();
    const u = await auth.authenticate({ sessionToken: token, bearerToken: null });
    expect(u?.via).toBe('session');
    expect(u?.user.email).toBe('admin@x.com');
    await auth.logout(token);
    expect(await auth.authenticate({ sessionToken: token, bearerToken: null })).toBeNull();
    await auth.logout(null);
  });

  it('authenticate sem credenciais ou com sessão desconhecida devolve null', async () => {
    expect(await auth.authenticate({ sessionToken: null, bearerToken: null })).toBeNull();
    expect(await auth.authenticate({ sessionToken: 'cgs_inexistente', bearerToken: null })).toBeNull();
  });

  it('sessão de usuário desativado não autentica', async () => {
    const { admin } = await setupAdmin();
    const ed = await userService.create({ name: 'Edu', email: 'edu@x.com', role: 'editor', password: 'senha-edu1' });
    const { token } = await auth.login({ email: 'edu@x.com', password: 'senha-edu1' }, ctx);
    await db.run('UPDATE users SET active = false WHERE id = ?', [ed.id]);
    expect(await auth.authenticate({ sessionToken: token, bearerToken: null })).toBeNull();
    expect(admin.id).not.toBe(ed.id);
  });

  it('renova a sessão (deslizante) só quando passou mais de uma hora', async () => {
    const { token } = await setupAdmin();
    const hash = tokens.hash(token);
    const expiresOf = async () =>
      new Date((await db.get<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE token_hash = ?', [hash]))!.expires_at).getTime();
    const original = await expiresOf();
    await auth.authenticate({ sessionToken: token, bearerToken: null });
    expect(await expiresOf()).toBe(original);

    // Simula uma sessão criada há 2 horas.
    await db.run("UPDATE sessions SET expires_at = expires_at - interval '2 hours' WHERE token_hash = ?", [hash]);
    const before = await expiresOf();
    await auth.authenticate({ sessionToken: token, bearerToken: null });
    expect(await expiresOf()).toBeGreaterThan(before + 3_600_000);
  });

  it('authenticate por token de API (bearer) usa as permissões do dono e registra o uso', async () => {
    const { admin } = await setupAdmin();
    const created = await apiTokenService.create(admin, { name: 'CI' });
    const u = await auth.authenticate({ sessionToken: null, bearerToken: created.token });
    expect(u?.via).toBe('token');
    expect(u?.can('users:manage')).toBe(true);
    const [view] = await apiTokenService.list(admin);
    expect(view?.last_used_at).not.toBeNull();

    expect(await auth.authenticate({ sessionToken: null, bearerToken: 'cgt_errado' })).toBeNull();
    await db.run('UPDATE users SET active = false WHERE id = ?', [admin.id]);
    expect(await auth.authenticate({ sessionToken: null, bearerToken: created.token })).toBeNull();
  });

  it('changePassword exige a senha atual', async () => {
    const { admin } = await setupAdmin();
    await expect(auth.changePassword(admin, { currentPassword: 'errada', newPassword: 'nova-senha' })).rejects.toThrow('Senha atual incorreta');
    await auth.changePassword(admin, { currentPassword: 'senha-forte', newPassword: 'nova-senha' });
    await expect(auth.login({ email: 'admin@x.com', password: 'senha-forte' }, ctx)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.login({ email: 'admin@x.com', password: 'nova-senha' }, ctx)).resolves.toBeTruthy();
  });

  it('changePassword de usuário que não existe mais falha', async () => {
    const ghost: User = { id: 999, email: 'g@x.com', name: 'G', role: 'viewer', active: true, created_at: '', last_login_at: null, onboarded_at: null };
    await expect(auth.changePassword(new AuthUser(ghost, 'session'), { currentPassword: 'a', newPassword: 'bbbbbbbb' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('setOnboarded marca e desmarca o tutorial', async () => {
    const { admin } = await setupAdmin();
    const done = await auth.setOnboarded(admin, true);
    expect(done.user?.onboarded_at).not.toBeNull();
    const again = await auth.setOnboarded(new AuthUser(admin.user, 'token'), false);
    expect(again.user?.onboarded_at).toBeNull();
    expect(again.permissions).toContain('settings:manage');
  });
});

describe('UserService', () => {
  it('cria e lista usuários; e-mail duplicado é recusado', async () => {
    await setupAdmin();
    const u = await userService.create({ name: 'Ana', email: 'ana@x.com', role: 'viewer', password: 'senha-ana1' });
    expect(u).toMatchObject({ name: 'Ana', role: 'viewer', active: true });
    expect('password_hash' in u).toBe(false);
    expect((await userService.list()).map((x) => x.email)).toEqual(['admin@x.com', 'ana@x.com']);
    await expect(userService.create({ name: 'Ana 2', email: 'ana@x.com', role: 'viewer', password: 'senha-ana1' })).rejects.toThrow(
      'Já existe um usuário com este e-mail',
    );
  });

  it('update: inexistente, e-mail em uso e troca de dados', async () => {
    const { admin } = await setupAdmin();
    const ana = await userService.create({ name: 'Ana', email: 'ana@x.com', role: 'viewer', password: 'senha-ana1' });
    await expect(userService.update(admin, 999, { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(userService.update(admin, ana.id, { email: 'admin@x.com' })).rejects.toThrow('Já existe um usuário com este e-mail');
    const same = await userService.update(admin, ana.id, { email: 'ana@x.com', name: 'Ana Maria', role: 'editor' });
    expect(same).toMatchObject({ name: 'Ana Maria', role: 'editor', email: 'ana@x.com' });
    const moved = await userService.update(admin, ana.id, { email: 'ana2@x.com' });
    expect(moved.email).toBe('ana2@x.com');
  });

  it('troca de senha ou desativação derruba as sessões do usuário', async () => {
    const { admin } = await setupAdmin();
    const ana = await userService.create({ name: 'Ana', email: 'ana@x.com', role: 'viewer', password: 'senha-ana1' });
    const { token } = await auth.login({ email: 'ana@x.com', password: 'senha-ana1' }, ctx);
    await userService.update(admin, ana.id, { name: 'Só nome' });
    expect(await auth.authenticate({ sessionToken: token, bearerToken: null })).not.toBeNull();
    await userService.update(admin, ana.id, { password: 'nova-senha-ana' });
    expect(await auth.authenticate({ sessionToken: token, bearerToken: null })).toBeNull();
    const second = await auth.login({ email: 'ana@x.com', password: 'nova-senha-ana' }, ctx);
    await userService.update(admin, ana.id, { active: false });
    expect(await auth.authenticate({ sessionToken: second.token, bearerToken: null })).toBeNull();
    expect(await sessionCount()).toBe(1); // só a do admin
  });

  it('não permite remover o último admin ativo (rebaixar ou desativar)', async () => {
    const { admin } = await setupAdmin();
    await expect(userService.update(admin, admin.id, { role: 'editor' })).rejects.toThrow('Precisa existir ao menos um administrador ativo');
    await expect(userService.update(admin, admin.id, { active: false })).rejects.toThrow('Precisa existir ao menos um administrador ativo');
    // Manter o papel admin é permitido.
    await expect(userService.update(admin, admin.id, { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
  });

  it('com dois admins pode rebaixar outro, mas não desativar a si mesmo', async () => {
    const { admin } = await setupAdmin();
    const b = await userService.create({ name: 'Bia', email: 'bia@x.com', role: 'admin', password: 'senha-bia1' });
    await expect(userService.update(admin, admin.id, { active: false })).rejects.toThrow('Você não pode desativar a si mesmo');
    await expect(userService.update(admin, b.id, { role: 'viewer' })).resolves.toMatchObject({ role: 'viewer' });
  });

  it('admin inativo pode ser rebaixado mesmo sendo o último admin', async () => {
    const { admin } = await setupAdmin();
    const b = await userService.create({ name: 'Bia', email: 'bia@x.com', role: 'admin', password: 'senha-bia1' });
    await userService.update(admin, b.id, { active: false });
    await expect(userService.update(admin, b.id, { role: 'editor' })).resolves.toMatchObject({ role: 'editor', active: false });
  });

  it('delete: inexistente, a si mesmo, último admin e sucesso', async () => {
    const { admin } = await setupAdmin();
    await expect(userService.delete(admin, 999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(userService.delete(admin, admin.id)).rejects.toThrow('Você não pode excluir a si mesmo');

    const b = await userService.create({ name: 'Bia', email: 'bia@x.com', role: 'admin', password: 'senha-bia1' });
    const bia = new AuthUser(b, 'session');
    await db.run('UPDATE users SET active = false WHERE id = ?', [b.id]);
    // Bia (inativa) tenta excluir o único admin ativo.
    await expect(userService.delete(bia, admin.id)).rejects.toThrow('Precisa existir ao menos um administrador ativo');

    const v = await userService.create({ name: 'Vi', email: 'vi@x.com', role: 'viewer', password: 'senha-vi12' });
    await userService.delete(admin, v.id);
    await userService.delete(admin, b.id);
    expect((await userService.list()).map((x) => x.email)).toEqual(['admin@x.com']);
  });
});

describe('ApiTokenService', () => {
  it('cria (devolve o token só uma vez), lista e revoga apenas os próprios tokens', async () => {
    const { admin } = await setupAdmin();
    const created = await apiTokenService.create(admin, { name: 'CI' });
    expect(created.token).toMatch(/^cgt_/);
    expect(created.prefix).toBe(created.token.slice(0, 10));
    const stored = await db.get<{ token_hash: string }>('SELECT token_hash FROM api_tokens WHERE id = ?', [created.id]);
    expect(stored?.token_hash).toBe(tokens.hash(created.token));

    const list = await apiTokenService.list(admin);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('token');

    const other = new AuthUser(await userService.create({ name: 'Ana', email: 'ana@x.com', role: 'editor', password: 'senha-ana1' }), 'session');
    await expect(apiTokenService.revoke(other, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await apiTokenService.revoke(admin, created.id);
    expect(await apiTokenService.list(admin)).toEqual([]);
    await expect(apiTokenService.revoke(admin, created.id)).rejects.toThrow('Token não encontrado');
  });
});
