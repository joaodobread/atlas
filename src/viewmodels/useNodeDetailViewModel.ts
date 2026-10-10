import { useEffect } from 'react';
import { NODE_KINDS, PROTOCOLS, type NodeKind } from '../../shared/constants.ts';
import { createConnectionSchema, createInterfaceSchema, createNodeSchema, updateNodeSchema } from '../../shared/schemas.ts';
import type { Connection, GraphNode } from '../../shared/types.ts';
import { ConnectionApi } from '../data/api/ConnectionApi.ts';
import { InterfaceApi } from '../data/api/InterfaceApi.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { resolveIcon } from '../domain/iconCatalog.ts';
import { KIND_COLOR, KIND_LABEL } from '../domain/visual.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useCommand } from './useCommand.ts';
import { idOrNull, useForm } from './useForm.ts';
import { usePermissions } from './usePermissions.ts';

interface NodeForm {
  name: string;
  kind: NodeKind;
  tech: string;
  icon: string | null;
  description: string;
  parent_id: string;
}

interface ChildForm {
  name: string;
  kind: NodeKind;
  tech: string;
}

interface InterfaceForm {
  name: string;
  type: string;
  spec: string;
}

interface OutputForm {
  inherit: string;
  target_id: string;
  target_interface_id: string;
  new_interface: string;
  protocol: string;
  description: string;
  parent_connection_id: string;
}

const toNodeForm = (n: GraphNode | undefined): NodeForm => ({
  name: n?.name ?? '',
  kind: n?.kind ?? 'project',
  tech: n?.tech ?? '',
  icon: n?.icon ?? null,
  description: n?.description ?? '',
  parent_id: n?.parent_id != null ? String(n.parent_id) : '',
});
const emptyChild: ChildForm = { name: '', kind: 'module', tech: '' };
const emptyInterface: InterfaceForm = { name: '', type: '', spec: '' };
const emptyOutput: OutputForm = {
  inherit: '',
  target_id: '',
  target_interface_id: '',
  new_interface: '',
  protocol: 'http',
  description: '',
  parent_connection_id: '',
};

export function useNodeDetailViewModel(nodeId: number) {
  const index = useGraphStore((s) => s.index);
  const select = useUiStore((s) => s.select);
  const expand = useUiStore((s) => s.expand);
  const { busy, run } = useCommand();
  const { canEditGraph } = usePermissions();

  const node = index.node(nodeId);
  const nodeForm = useForm<NodeForm>(toNodeForm(node));
  const childForm = useForm<ChildForm>(emptyChild);
  const interfaceForm = useForm<InterfaceForm>(emptyInterface);
  const outputForm = useForm<OutputForm>(emptyOutput);

  // Recarrega o formulário quando muda o nó selecionado ou ele é atualizado.
  useEffect(() => nodeForm.reset(toNodeForm(node)), [node?.id, node?.updated_at]);
  useEffect(() => {
    childForm.reset(emptyChild);
    interfaceForm.reset(emptyInterface);
    outputForm.reset(emptyOutput);
  }, [nodeId]);

  const subtree = index.subtree(nodeId);
  const describe = (c: Connection) => ({
    id: c.id,
    source: index.path(c.source_id),
    target: index.path(c.target_id),
    iface: index.iface(c.target_interface_id)?.name ?? null,
    protocol: c.protocol,
    implementsParent: c.parent_connection_id != null,
    callSiteCount: index.callSites(c.id).length,
  });

  const targetId = idOrNull(outputForm.values.target_id);

  // ---------- Ações ----------
  const save = async () => {
    const v = nodeForm.values;
    const input = nodeForm.validate(updateNodeSchema, { ...v, parent_id: idOrNull(v.parent_id) });
    if (input) await run(() => NodeApi.getInstance().update(nodeId, input), 'Nó salvo');
  };

  const remove = async () => {
    const extra = subtree.size > 1 ? ` e seus ${subtree.size - 1} descendentes` : '';
    if (!confirm(`Excluir "${node?.name}"${extra}? As conexões ligadas também serão removidas.`)) return;
    const ok = await run(async () => (await NodeApi.getInstance().remove(nodeId), true), 'Nó excluído');
    if (ok) select(node?.parent_id != null ? { type: 'node', id: node.parent_id } : null);
  };

  const addChild = async () => {
    const input = childForm.validate(createNodeSchema, { ...childForm.values, parent_id: nodeId });
    if (!input) return;
    const child = await run(() => NodeApi.getInstance().create(input), 'Submódulo criado');
    if (child) {
      childForm.reset(emptyChild);
      expand([nodeId]);
    }
  };

  const addInterface = async () => {
    const input = interfaceForm.validate(createInterfaceSchema, { ...interfaceForm.values, node_id: nodeId });
    if (!input) return;
    if (await run(() => InterfaceApi.getInstance().create(input), 'Interface criada')) interfaceForm.reset(emptyInterface);
  };

  const removeInterface = (id: number) => run(() => InterfaceApi.getInstance().remove(id), 'Interface removida');

  /** Preenche o formulário de saída a partir de uma saída de ancestral. */
  const inheritOutput = (value: string) => {
    const parent = value ? index.connection(Number(value)) : undefined;
    outputForm.setValues((v) =>
      parent
        ? {
            ...v,
            inherit: value,
            target_id: String(parent.target_id),
            target_interface_id: parent.target_interface_id != null ? String(parent.target_interface_id) : '',
            protocol: parent.protocol ?? v.protocol,
            parent_connection_id: String(parent.id),
          }
        : { ...v, inherit: '', parent_connection_id: '' },
    );
  };

  const addOutput = async () => {
    const v = outputForm.values;
    const base = {
      source_id: nodeId,
      target_id: idOrNull(v.target_id),
      target_interface_id: idOrNull(v.target_interface_id),
      parent_connection_id: idOrNull(v.parent_connection_id),
      protocol: v.protocol,
      description: v.description,
    };
    const newIface = v.new_interface.trim();
    // Valida a conexão (sem interface quando ela ainda será criada) e depois a nova interface.
    const input = outputForm.validate(createConnectionSchema, { ...base, target_interface_id: newIface ? null : base.target_interface_id });
    if (!input) return;
    const ifaceInput = newIface ? outputForm.validate(createInterfaceSchema, { node_id: input.target_id, name: newIface, type: input.protocol }) : null;
    if (newIface && !ifaceInput) return;

    const created = await run(async () => {
      const iface = ifaceInput ? await InterfaceApi.getInstance().create(ifaceInput) : null;
      return ConnectionApi.getInstance().create({ ...input, target_interface_id: iface?.id ?? input.target_interface_id });
    }, 'Saída criada');
    if (created) outputForm.reset(emptyOutput);
  };

  const removeConnection = (id: number) => {
    if (confirm('Excluir esta conexão?')) void run(() => ConnectionApi.getInstance().remove(id), 'Conexão removida');
  };

  return {
    node,
    busy,
    canEdit: canEditGraph,
    path: node ? index.path(node.id) : '',
    color: node ? KIND_COLOR[node.kind] : '#888',
    icon: node ? resolveIcon(node) : 'lu:box',
    kinds: NODE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
    protocols: PROTOCOLS,
    // Pais possíveis: qualquer nó fora da subárvore.
    parentOptions: index
      .nodesByPath()
      .filter((n) => !subtree.has(n.id))
      .map((n) => ({ value: n.id, label: index.path(n.id) })),
    children: index.children(nodeId),
    interfaces: index.interfaces(nodeId),
    outgoing: index.outgoing(nodeId).map(describe),
    incoming: index.incoming(nodeId).map(describe),
    inheritedOutputs: index.inheritedOutputs(nodeId).map(describe),
    targetOptions: index
      .nodesByPath()
      .filter((n) => n.id !== nodeId)
      .map((n) => ({ value: n.id, label: index.path(n.id) })),
    targetInterfaces: targetId != null ? index.interfaces(targetId) : [],
    nodeForm,
    childForm,
    interfaceForm,
    outputForm,
    save,
    remove,
    addChild,
    addInterface,
    removeInterface,
    inheritOutput,
    addOutput,
    removeConnection,
    selectNode: (id: number) => select({ type: 'node', id }),
    selectConnection: (id: number) => select({ type: 'connection', id }),
  };
}
