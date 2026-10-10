import { create } from 'zustand';
import type { Permission } from '../../shared/constants.ts';
import type { AuthStatus, User } from '../../shared/types.ts';

type Phase = 'loading' | 'needs-setup' | 'anonymous' | 'authenticated' | 'offline';

interface AuthState {
  phase: Phase;
  user: User | null;
  permissions: ReadonlySet<Permission>;
  error: string | null;
  apply(status: AuthStatus): void;
  signOut(): void;
  fail(error: string): void;
}

/** Model: sessão do usuário atual. */
export const useAuthStore = create<AuthState>()((set) => ({
  phase: 'loading',
  user: null,
  permissions: new Set(),
  error: null,
  apply: (s) =>
    set({
      phase: s.user ? 'authenticated' : s.needsSetup ? 'needs-setup' : 'anonymous',
      user: s.user,
      permissions: new Set(s.permissions),
      error: null,
    }),
  signOut: () => set({ phase: 'anonymous', user: null, permissions: new Set() }),
  fail: (error) => set({ phase: 'offline', error }),
}));
