import { ROLE_PERMISSIONS, type Permission } from '../../../shared/constants.ts';
import type { User } from '../../../shared/types.ts';

/** Usuário autenticado na requisição, com as permissões do seu papel. */
export class AuthUser {
  readonly permissions: ReadonlySet<Permission>;

  constructor(
    readonly user: User,
    /** Como se autenticou: cookie de sessão ou token de API. */
    readonly via: 'session' | 'token',
  ) {
    this.permissions = new Set(ROLE_PERMISSIONS[user.role]);
  }

  get id(): number {
    return this.user.id;
  }

  can(permission: Permission): boolean {
    return this.permissions.has(permission);
  }
}
