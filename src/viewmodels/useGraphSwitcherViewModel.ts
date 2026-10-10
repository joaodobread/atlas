import { useState } from 'react';
import { createGraphSchema } from '../../shared/schemas.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { usePermissions } from './usePermissions.ts';

type Mode = { type: 'list' } | { type: 'create' } | { type: 'rename' };

/** Troca, cria, renomeia e exclui grafos (diagramas). */
export function useGraphSwitcherViewModel() {
  const graphs = useGraphStore((s) => s.graphs);
  const graphId = useUiStore((s) => s.graphId);
  const pushToast = useUiStore((s) => s.pushToast);
  const perms = usePermissions();
  const [mode, setMode] = useState<Mode>({ type: 'list' });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = graphs.find((g) => g.id === graphId) ?? null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode({ type: 'list' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const validName = () => {
    const parsed = createGraphSchema.safeParse({ name });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Nome inválido');
    return parsed.data;
  };

  return {
    graphs,
    current,
    currentName: current?.name ?? '…',
    mode,
    name,
    setName,
    error,
    busy,
    canEdit: perms.canEditGraph,
    open: (id: number) => void GraphSync.getInstance().open(id),
    startCreate: () => {
      setName('');
      setError(null);
      setMode({ type: 'create' });
    },
    startRename: () => {
      setName(current?.name ?? '');
      setError(null);
      setMode({ type: 'rename' });
    },
    cancel: () => setMode({ type: 'list' }),
    submit: () =>
      run(async () => {
        const input = validName();
        if (mode.type === 'create') {
          const g = await GraphApi.getInstance().create(input);
          await GraphSync.getInstance().open(g.id);
          pushToast('success', `Grafo "${g.name}" criado`);
        } else if (current) {
          await GraphApi.getInstance().update(current.id, { name: input.name });
          await GraphSync.getInstance().reload();
        }
      }),
    remove: () => {
      if (!current) return;
      if (!window.confirm(`Excluir o grafo "${current.name}" e todos os seus ${current.nodeCount} nós? Isso não pode ser desfeito.`)) return;
      void run(async () => {
        await GraphApi.getInstance().delete(current.id);
        await GraphSync.getInstance().reload();
        pushToast('success', 'Grafo excluído');
      }).catch((err) => pushToast('error', errorMessage(err)));
    },
    canDelete: graphs.length > 1,
  };
}
