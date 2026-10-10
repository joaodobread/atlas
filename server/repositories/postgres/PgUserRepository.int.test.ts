import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import { PgApiTokenRepository, PgSessionRepository, PgUserRepository } from './PgUserRepository.ts';

describe('PgUserRepository', () => {
  let users: PgUserRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    users = new PgUserRepository(db);
  });

  const mk = (email: string, name: string, role: 'admin' | 'editor' | 'viewer' = 'viewer') =>
    users.create({ email, name, role, password_hash: `hash-${name}` });

  it('create devolve só colunas públicas (sem password_hash)', async () => {
    const u = await mk('Ana@Ex.com', 'Ana', 'admin');
    expect(u).toMatchObject({ email: 'Ana@Ex.com', name: 'Ana', role: 'admin', active: true, last_login_at: null, onboarded_at: null });
    expect(u).not.toHaveProperty('password_hash');
    expect(typeof u.email).toBe('string');
  });

  it('e-mail é único sem diferenciar maiúsculas; busca com segredo é case-insensitive', async () => {
    const u = await mk('ana@ex.com', 'Ana');
    await expect(mk('ANA@EX.COM', 'Outra')).rejects.toThrow(/unique|duplicate/i);
    const s = await users.findByEmailWithSecret('ANA@ex.com');
    expect(s).toMatchObject({ id: u.id, password_hash: 'hash-Ana' });
    expect(await users.findByIdWithSecret(u.id)).toMatchObject({ password_hash: 'hash-Ana' });
    expect(await users.findByEmailWithSecret('nao@ex.com')).toBeNull();
    expect(await users.findByIdWithSecret(999)).toBeNull();
    expect(await users.findById(999)).toBeNull();
  });

  it('findAll ordena por nome; count e countActiveAdmins', async () => {
    const z = await mk('z@x', 'zeca', 'admin');
    await mk('b@x', 'Bia', 'admin');
    await mk('c@x', 'carla', 'editor');
    expect((await users.findAll()).map((u) => u.name)).toEqual(['Bia', 'carla', 'zeca']);
    expect(await users.count()).toBe(3);
    expect(await users.countActiveAdmins()).toBe(2);
    await users.update(z.id, { active: false });
    expect(await users.countActiveAdmins()).toBe(1);
  });

  it('update grava só colunas permitidas e ignora undefined', async () => {
    const u = await mk('a@x', 'A');
    const up = await users.update(u.id, { name: 'B', role: 'editor', email: undefined, id: 99, created_at: 'x' } as never);
    expect(up).toMatchObject({ id: u.id, name: 'B', role: 'editor', email: 'a@x' });
    await users.update(u.id, { password_hash: 'novo' });
    expect((await users.findByIdWithSecret(u.id))?.password_hash).toBe('novo');
    expect(await users.update(u.id, {})).toEqual(up);
  });

  it('update de usuário inexistente lança NotFoundError', async () => {
    await expect(users.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete, touchLogin e setOnboarded', async () => {
    const u = await mk('a@x', 'A');
    await users.touchLogin(u.id);
    expect((await users.findById(u.id))?.last_login_at).toMatch(/Z$/);
    await users.setOnboarded(u.id, true);
    expect((await users.findById(u.id))?.onboarded_at).toMatch(/Z$/);
    await users.setOnboarded(u.id, false);
    expect((await users.findById(u.id))?.onboarded_at).toBeNull();
    expect(await users.delete(u.id)).toBe(true);
    expect(await users.delete(u.id)).toBe(false);
  });
});

describe('PgSessionRepository', () => {
  let users: PgUserRepository;
  let sessions: PgSessionRepository;
  let uid: number;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    users = new PgUserRepository(db);
    sessions = new PgSessionRepository(db);
    uid = (await users.create({ email: 'a@x', name: 'A', role: 'admin', password_hash: 'h' })).id;
  });

  const future = () => new Date(Date.now() + 3_600_000);
  // Folga de 1h: o relógio do container do Postgres pode estar alguns segundos atrás do host.
  const past = () => new Date(Date.now() - 3_600_000);

  it('findValid só acha sessão não expirada', async () => {
    const exp = future();
    await sessions.create('h1', uid, exp, 'Firefox');
    await sessions.create('h2', uid, past(), null);
    expect(await sessions.findValid('h1')).toEqual({ user_id: uid, expires_at: exp.toISOString() });
    expect(await sessions.findValid('h2')).toBeNull();
    expect(await sessions.findValid('nada')).toBeNull();
  });

  it('extend renova uma sessão expirada', async () => {
    await sessions.create('h', uid, past(), null);
    await sessions.extend('h', future());
    expect(await sessions.findValid('h')).not.toBeNull();
  });

  it('delete, deleteForUser e deleteExpired', async () => {
    const db = await testDatabase();
    const other = (await users.create({ email: 'b@x', name: 'B', role: 'viewer', password_hash: 'h' })).id;
    await sessions.create('a1', uid, future(), null);
    await sessions.create('a2', uid, future(), null);
    await sessions.create('b1', other, future(), null);
    await sessions.create('b2', other, past(), null);
    const hashes = async () => (await db.all<{ token_hash: string }>('SELECT token_hash FROM sessions ORDER BY 1')).map((r) => r.token_hash);

    await sessions.delete('a1');
    expect(await hashes()).toEqual(['a2', 'b1', 'b2']);
    await sessions.deleteExpired();
    expect(await hashes()).toEqual(['a2', 'b1']);
    await sessions.deleteForUser(uid);
    expect(await hashes()).toEqual(['b1']);
  });

  it('apagar o usuário apaga as sessões (cascata)', async () => {
    await sessions.create('h', uid, future(), null);
    await users.delete(uid);
    expect(await sessions.findValid('h')).toBeNull();
  });
});

describe('PgApiTokenRepository', () => {
  let tokens: PgApiTokenRepository;
  let uid: number;
  let other: number;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    const users = new PgUserRepository(db);
    tokens = new PgApiTokenRepository(db);
    uid = (await users.create({ email: 'a@x', name: 'A', role: 'admin', password_hash: 'h' })).id;
    other = (await users.create({ email: 'b@x', name: 'B', role: 'admin', password_hash: 'h' })).id;
  });

  it('create devolve a visão pública (sem hash) e lista por usuário, mais recente primeiro', async () => {
    const t1 = await tokens.create(uid, 'ci', 'hash1', 'cgt_abc');
    expect(t1).toEqual({ id: t1.id, name: 'ci', prefix: 'cgt_abc', created_at: expect.stringMatching(/Z$/), last_used_at: null });
    const db = await testDatabase();
    await db.run("UPDATE api_tokens SET created_at = now() - interval '1 day' WHERE id = ?", [t1.id]);
    const t2 = await tokens.create(uid, 'script', 'hash2', 'cgt_def');
    await tokens.create(other, 'dele', 'hash3', 'cgt_ghi');
    expect((await tokens.listForUser(uid)).map((t) => t.id)).toEqual([t2.id, t1.id]);
  });

  it('findUserIdByHash e touch', async () => {
    await tokens.create(uid, 'ci', 'hash1', 'cgt');
    expect(await tokens.findUserIdByHash('hash1')).toBe(uid);
    expect(await tokens.findUserIdByHash('x')).toBeNull();
    await tokens.touch('hash1');
    expect((await tokens.listForUser(uid))[0].last_used_at).toMatch(/Z$/);
  });

  it('hash de token é único', async () => {
    await tokens.create(uid, 'a', 'mesmo', 'p');
    await expect(tokens.create(other, 'b', 'mesmo', 'p')).rejects.toThrow(/unique|duplicate/i);
  });

  it('delete só remove token do próprio usuário', async () => {
    const t = await tokens.create(uid, 'ci', 'hash1', 'cgt');
    expect(await tokens.delete(t.id, other)).toBe(false);
    expect(await tokens.delete(t.id, uid)).toBe(true);
    expect(await tokens.delete(t.id, uid)).toBe(false);
  });
});
