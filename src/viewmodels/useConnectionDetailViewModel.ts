import { useEffect } from 'react';
import { PROTOCOLS } from '../../shared/constants.ts';
import { createCallSiteSchema, updateConnectionSchema } from '../../shared/schemas.ts';
import type { Connection } from '../../shared/types.ts';
import { CallSiteApi } from '../data/api/CallSiteApi.ts';
import { ConnectionApi } from '../data/api/ConnectionApi.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useCommand } from './useCommand.ts';
import { idOrNull, useForm } from './useForm.ts';
import { usePermissions } from './usePermissions.ts';

interface ConnectionForm {
  protocol: string;
  target_interface_id: string;
  parent_connection_id: string;
  description: string;
}

interface CallSiteForm {
  file_path: string;
  line: string;
  symbol: string;
  notes: string;
}

const toForm = (c: Connection | undefined): ConnectionForm => ({
  protocol: c?.protocol ?? '',
  target_interface_id: c?.target_interface_id != null ? String(c.target_interface_id) : '',
  parent_connection_id: c?.parent_connection_id != null ? String(c.parent_connection_id) : '',
  description: c?.description ?? '',
});
const emptyCallSite: CallSiteForm = { file_path: '', line: '', symbol: '', notes: '' };

export function useConnectionDetailViewModel(connectionId: number) {
  const index = useGraphStore((s) => s.index);
  const select = useUiStore((s) => s.select);
  const { busy, run } = useCommand();
  const { canEditGraph } = usePermissions();

  const conn = index.connection(connectionId);
  const form = useForm<ConnectionForm>(toForm(conn));
  const callSiteForm = useForm<CallSiteForm>(emptyCallSite);

  useEffect(() => form.reset(toForm(conn)), [conn]);
  useEffect(() => callSiteForm.reset(emptyCallSite), [connectionId]);

  const label = (c: Connection) => {
    const iface = index.iface(c.target_interface_id)?.name;
    return `${index.path(c.source_id)} → ${index.path(c.target_id)}${iface ? ` [${iface}]` : ''}`;
  };

  const save = async () => {
    const v = form.values;
    const input = form.validate(updateConnectionSchema, {
      protocol: v.protocol,
      description: v.description,
      target_interface_id: idOrNull(v.target_interface_id),
      parent_connection_id: idOrNull(v.parent_connection_id),
    });
    if (input) await run(() => ConnectionApi.getInstance().update(connectionId, input), 'Conexão salva');
  };

  const remove = async () => {
    if (!conn || !confirm('Excluir esta conexão?')) return;
    const ok = await run(async () => (await ConnectionApi.getInstance().remove(connectionId), true), 'Conexão excluída');
    if (ok) select({ type: 'node', id: conn.source_id });
  };

  const addCallSite = async () => {
    const v = callSiteForm.values;
    const input = callSiteForm.validate(createCallSiteSchema, {
      connection_id: connectionId,
      file_path: v.file_path,
      line: v.line.trim() === '' ? null : Number(v.line),
      symbol: v.symbol,
      notes: v.notes,
    });
    if (!input) return;
    if (await run(() => CallSiteApi.getInstance().create(input), 'Local registrado')) callSiteForm.reset(emptyCallSite);
  };

  const removeCallSite = (id: number) => run(() => CallSiteApi.getInstance().remove(id), 'Local removido');

  // Candidatas a "implementa": saídas de ancestrais da origem.
  const parentCandidates = conn ? index.inheritedOutputs(conn.source_id).filter((c) => c.id !== conn.id) : [];

  return {
    conn,
    busy,
    canEdit: canEditGraph,
    sourcePath: conn ? index.path(conn.source_id) : '',
    targetPath: conn ? index.path(conn.target_id) : '',
    targetInterfaces: conn ? index.interfaces(conn.target_id) : [],
    protocols: PROTOCOLS,
    parentOptions: parentCandidates.map((c) => ({ value: c.id, label: label(c) })),
    parent: conn?.parent_connection_id != null ? index.connection(conn.parent_connection_id) : undefined,
    implementations: conn ? index.implementations(conn.id).map((c) => ({ id: c.id, label: label(c) })) : [],
    callSites: index.callSites(connectionId),
    label,
    form,
    callSiteForm,
    save,
    remove,
    addCallSite,
    removeCallSite,
    selectNode: (id: number) => select({ type: 'node', id }),
    selectConnection: (id: number) => select({ type: 'connection', id }),
  };
}
