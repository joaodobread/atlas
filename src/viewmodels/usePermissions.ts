import type { Permission } from '../../shared/constants.ts';
import { useAuthStore } from '../stores/authStore.ts';

/** Permissões do usuário logado, para os ViewModels decidirem o que expor. */
export function usePermissions() {
  const permissions = useAuthStore((s) => s.permissions);
  return {
    can: (p: Permission) => permissions.has(p),
    canEditGraph: permissions.has('graph:write'),
    canEditDocs: permissions.has('docs:write'),
    canManageSettings: permissions.has('settings:manage'),
    canManageUsers: permissions.has('users:manage'),
  };
}
