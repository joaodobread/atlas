import { NODE_KINDS } from '../../shared/constants.ts';
import { KIND_DEFAULT_ICON } from '../domain/iconCatalog.ts';
import { KIND_COLOR, KIND_LABEL } from '../domain/visual.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export function useSceneOverlayViewModel() {
  const index = useGraphStore((s) => s.index);
  const focusId = useUiStore((s) => s.focusId);
  const focus = useUiStore((s) => s.focus);
  const select = useUiStore((s) => s.select);

  const focusNode = focusId != null ? index.node(focusId) : undefined;
  const trail = focusNode ? [...index.ancestors(focusNode.id)].reverse().concat(focusNode) : [];
  const presentKinds = new Set(index.nodes.map((n) => n.kind));

  return {
    inFocus: !!focusNode,
    trail: trail.map((n) => ({ id: n.id, name: n.name, current: n.id === focusId })),
    exitFocus: () => focus(null),
    focusOn: (id: number) => {
      focus(id);
      select({ type: 'node', id });
    },
    legend: NODE_KINDS.filter((k) => presentKinds.has(k)).map((k) => ({
      kind: k,
      label: KIND_LABEL[k],
      color: KIND_COLOR[k],
      icon: KIND_DEFAULT_ICON[k],
    })),
  };
}
