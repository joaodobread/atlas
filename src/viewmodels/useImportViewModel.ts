import { useState } from 'react';
import { exchangeDocumentSchema, type ExchangeDocumentInput } from '../../shared/schemas.ts';
import type { ImportResult } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useCommand } from './useCommand.ts';

const TEMPLATE: ExchangeDocumentInput = {
  mode: 'merge',
  nodes: [
    { ref: 'db', name: 'MySQL', kind: 'database', tech: 'mysql', interfaces: [{ name: 'users', type: 'table' }] },
    { ref: 'api', name: 'Node API', kind: 'service', tech: 'node', interfaces: [{ name: 'GET /users', type: 'http' }] },
    { ref: 'api.users', name: 'UsersModule', kind: 'module', parent: 'api' },
  ],
  connections: [
    { ref: 'api->db', from: 'api', to: 'db', protocol: 'sql' },
    {
      from: 'api.users',
      to: 'db',
      interface: 'users',
      protocol: 'sql',
      implements: 'api->db',
      callSites: [{ file_path: 'src/users/repo.ts', line: 10, symbol: 'UsersRepo.findAll' }],
    },
  ],
};

export function useImportViewModel() {
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const { busy, run } = useCommand();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const submit = async () => {
    setResult(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      setError(`JSON inválido: ${errorMessage(err)}`);
      return;
    }
    const parsed = exchangeDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      setError(errorMessage(parsed.error));
      return;
    }
    if (parsed.data.mode === 'replace' && !confirm('Modo "replace" apaga TODO o grafo atual antes de importar. Continuar?')) return;
    setError(null);
    const res = await run(() => GraphApi.getInstance().importDocument(useUiStore.getState().graphId, parsed.data), 'Importação concluída');
    if (res) setResult(res);
  };

  return {
    text,
    setText: (t: string) => {
      setText(t);
      setError(null);
    },
    error,
    result,
    busy,
    submit,
    fillTemplate: () => setText(JSON.stringify(TEMPLATE, null, 2)),
    close: () => setImportOpen(false),
  };
}
