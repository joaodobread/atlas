import { useEffect } from 'react';
import { AuthSession } from '../data/AuthSession.ts';
import { useAuthStore } from '../stores/authStore.ts';

export function useRootViewModel() {
  const phase = useAuthStore((s) => s.phase);
  const error = useAuthStore((s) => s.error);

  useEffect(() => {
    void AuthSession.getInstance().load();
  }, []);

  return { phase, error, retry: () => void AuthSession.getInstance().load() };
}
