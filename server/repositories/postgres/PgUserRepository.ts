import type { Role } from '../../../shared/constants.ts';
import type { ApiTokenView, User } from '../../../shared/types.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { IDatabase, SqlValue } from '../../infra/database/IDatabase.ts';
import type { IApiTokenRepository, ISessionRepository, IUserRepository, SessionRecord, UserWithSecret } from '../contracts/IUserRepository.ts';

const PUBLIC_COLUMNS = 'id, email::text AS email, name, role, active, created_at, last_login_at, onboarded_at';
const WRITABLE = new Set(['email', 'name', 'role', 'active', 'password_hash']);

export class PgUserRepository implements IUserRepository {
  constructor(private readonly db: IDatabase) {}

  findAll(): Promise<User[]> {
    return this.db.all<User>(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY lower(name)`);
  }

  findById(id: number): Promise<User | null> {
    return this.db.get<User>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]);
  }

  findByEmailWithSecret(email: string): Promise<UserWithSecret | null> {
    return this.db.get<UserWithSecret>(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = ?`, [email]);
  }

  findByIdWithSecret(id: number): Promise<UserWithSecret | null> {
    return this.db.get<UserWithSecret>(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE id = ?`, [id]);
  }

  async count(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n;
  }

  async countActiveAdmins(): Promise<number> {
    return (await this.db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active`))!.n;
  }

  async create(data: { email: string; name: string; role: Role; password_hash: string }): Promise<User> {
    const id = await this.db.insert('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)', [
      data.email,
      data.name,
      data.role,
      data.password_hash,
    ]);
    return (await this.findById(id))!;
  }

  async update(id: number, data: Partial<{ email: string; name: string; role: Role; active: boolean; password_hash: string }>): Promise<User> {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    for (const [col, value] of Object.entries(data)) {
      if (value === undefined || !WRITABLE.has(col)) continue;
      sets.push(`${col} = ?`);
      values.push(value);
    }
    if (sets.length) await this.db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = ?`, [...values, id]);
    const user = await this.findById(id);
    if (!user) throw new NotFoundError(`Usuário ${id} não encontrado`);
    return user;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM users WHERE id = ?', [id])).changes > 0;
  }

  async touchLogin(id: number): Promise<void> {
    await this.db.run('UPDATE users SET last_login_at = now() WHERE id = ?', [id]);
  }

  async setOnboarded(id: number, done: boolean): Promise<void> {
    await this.db.run(`UPDATE users SET onboarded_at = ${done ? 'now()' : 'NULL'} WHERE id = ?`, [id]);
  }
}

export class PgSessionRepository implements ISessionRepository {
  constructor(private readonly db: IDatabase) {}

  async create(tokenHash: string, userId: number, expiresAt: Date, userAgent: string | null): Promise<void> {
    await this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)', [tokenHash, userId, expiresAt, userAgent]);
  }

  findValid(tokenHash: string): Promise<SessionRecord | null> {
    return this.db.get<SessionRecord>('SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > now()', [tokenHash]);
  }

  async extend(tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.run('UPDATE sessions SET expires_at = ?, last_seen_at = now() WHERE token_hash = ?', [expiresAt, tokenHash]);
  }

  async delete(tokenHash: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }

  async deleteForUser(userId: number): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  async deleteExpired(): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE expires_at <= now()');
  }
}

export class PgApiTokenRepository implements IApiTokenRepository {
  constructor(private readonly db: IDatabase) {}

  listForUser(userId: number): Promise<ApiTokenView[]> {
    return this.db.all<ApiTokenView>('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }

  async create(userId: number, name: string, tokenHash: string, prefix: string): Promise<ApiTokenView> {
    const id = await this.db.insert('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?)', [userId, name, tokenHash, prefix]);
    return (await this.db.get<ApiTokenView>('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE id = ?', [id]))!;
  }

  async findUserIdByHash(tokenHash: string): Promise<number | null> {
    return (await this.db.get<{ user_id: number }>('SELECT user_id FROM api_tokens WHERE token_hash = ?', [tokenHash]))?.user_id ?? null;
  }

  async touch(tokenHash: string): Promise<void> {
    await this.db.run('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ?', [tokenHash]);
  }

  async delete(id: number, userId: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM api_tokens WHERE id = ? AND user_id = ?', [id, userId])).changes > 0;
  }
}
