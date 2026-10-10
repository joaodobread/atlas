import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore.ts';

const TTL_MS = 4500;

export function useToastViewModel() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), t.kind === 'error' ? TTL_MS * 2 : TTL_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  return { toasts, dismiss };
}
