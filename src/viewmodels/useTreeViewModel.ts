import { NODE_KINDS, type NodeKind } from '../../shared/constants.ts';
import { createNodeSchema } from '../../shared/schemas.ts';
import type { GraphNode } from '../../shared/types.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { resolveIcon } from '../domain/iconCatalog.ts';
import { KIND_COLOR, KIND_LABEL } from '../domain/visual.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useCommand } from './useCommand.ts';
import { useForm } from './useForm.ts';
import { usePermissions } from './usePermissions.ts';

interface RootForm {
  name: string;
  kind: NodeKind;
  tech: string;
  icon: string | null;
}
const emptyRoot: RootForm = { name: '', kind: 'project', tech: '', icon: null };

export function useTreeViewModel() {
  const index = useGraphStore((s) => s.index);
  const expanded = useUiStore((s) => s.expanded);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const focus = useUiStore((s) => s.focus);
  const focusId = useUiStore((s) => s.focusId);
  const form = useForm<RootForm>(emptyRoot);
  const { busy, run } = useCommand();
  const { canEditGraph } = usePermissions();

  const createRoot = async () => {
    const input = form.validate(createNodeSchema, { ...form.values, parent_id: null, graph_id: useUiStore.getState().graphId });
    if (!input) return;
    const node = await run(() => NodeApi.getInstance().create(input), 'Nó criado');
    if (node) {
      form.reset(emptyRoot);
      select({ type: 'node', id: node.id });
      focus(node.id);
    }
  };

  return {
    roots: index.roots(),
    children: (id: number): GraphNode[] => index.children(id),
    hasChildren: (id: number) => index.hasChildren(id),
    isExpanded: (id: number) => expanded.has(id),
    isSelected: (id: number) => selection?.type === 'node' && selection.id === id,
    color: (kind: NodeKind) => KIND_COLOR[kind],
    icon: (node: GraphNode) => resolveIcon(node),
    isFocused: (id: number) => focusId === id,
    kindLabel: (kind: NodeKind) => KIND_LABEL[kind],
    kinds: NODE_KINDS,
    toggle: toggleExpanded,
    /** Clique na árvore: seleciona e foca, como na cena. */
    select: (id: number) => {
      select({ type: 'node', id });
      if (id !== focusId) focus(id);
    },
    form,
    busy,
    canEdit: canEditGraph,
    createRoot,
  };
}
