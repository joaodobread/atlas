import type { Role } from '../../../shared/constants.ts';
import type { ApiTokenView, User } from '../../../shared/types.ts';

export interface UserWithSecret extends User {
  password_hash: string;
}

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: number): Promise<User | null>;
  findByEmailWithSecret(email: string): Promise<UserWithSecret | null>;
  findByIdWithSecret(id: number): Promise<UserWithSecret | null>;
  count(): Promise<number>;
  countActiveAdmins(): Promise<number>;
  create(data: { email: string; name: string; role: Role; password_hash: string }): Promise<User>;
  update(id: number, data: Partial<{ email: string; name: string; role: Role; active: boolean; password_hash: string }>): Promise<User>;
  delete(id: number): Promise<boolean>;
  touchLogin(id: number): Promise<void>;
  setOnboarded(id: number, done: boolean): Promise<void>;
}

export interface SessionRecord {
  user_id: number;
  expires_at: string;
}

export interface ISessionRepository {
  create(tokenHash: string, userId: number, expiresAt: Date, userAgent: string | null): Promise<void>;
  /** Sessão não expirada, ou null. */
  findValid(tokenHash: string): Promise<SessionRecord | null>;
  extend(tokenHash: string, expiresAt: Date): Promise<void>;
  delete(tokenHash: string): Promise<void>;
  deleteForUser(userId: number): Promise<void>;
  deleteExpired(): Promise<void>;
}

export interface IApiTokenRepository {
  listForUser(userId: number): Promise<ApiTokenView[]>;
  create(userId: number, name: string, tokenHash: string, prefix: string): Promise<ApiTokenView>;
  findUserIdByHash(tokenHash: string): Promise<number | null>;
  touch(tokenHash: string): Promise<void>;
  delete(id: number, userId: number): Promise<boolean>;
}
