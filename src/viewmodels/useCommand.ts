import { useCallback, useState } from 'react';
import { errorMessage } from '../core/errorMessage.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useUiStore } from '../stores/uiStore.ts';

/**
 * Executa uma mutação, recarrega o grafo e reporta sucesso/erro via toast.
 * @returns o resultado da ação, ou undefined em caso de erro.
 */
export function useCommand() {
  const [busy, setBusy] = useState(false);
  const pushToast = useUiStore((s) => s.pushToast);

  const run = useCallback(
    async <T>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        await GraphSync.getInstance().reload();
        if (success) pushToast('success', success);
        return result;
      } catch (err) {
        pushToast('error', errorMessage(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [pushToast],
  );

  return { busy, run };
}
