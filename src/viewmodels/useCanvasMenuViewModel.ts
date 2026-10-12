import { useState } from 'react';
import { NODE_KINDS, type NodeKind } from '../../shared/constants.ts';
import { createNodeSchema } from '../../shared/schemas.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { KIND_LABEL } from '../domain/visual.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useCommand } from './useCommand.ts';
import { useForm } from './useForm.ts';
import { usePermissions } from './usePermissions.ts';

interface MenuForm {
  name: string;
  kind: NodeKind;
}

/** Menu do clique direito na cena: cria um nó na raiz, dentro da caixa clicada ou como filho do nó clicado. */
export function useCanvasMenuViewModel() {
  const index = useGraphStore((s) => s.index);
  const select = useUiStore((s) => s.select);
  const expand = useUiStore((s) => s.expand);
  const { canEditGraph } = usePermissions();
  const { busy, run } = useCommand();
  const [menu, setMenu] = useState<{ x: number; y: number; parentId: number | null } | null>(null);
  const form = useForm<MenuForm>({ name: '', kind: 'project' });

  return {
    canCreate: canEditGraph,
    menu,
    busy,
    form,
    kinds: NODE_KINDS,
    kindLabel: (k: NodeKind) => KIND_LABEL[k],
    /** "na raiz" ou "em Conta prod / VPC" (onde o nó vai ficar). */
    placeLabel: menu?.parentId != null ? `em ${index.path(menu.parentId)}` : 'na raiz',
    /** Abre no ponto (px dentro da cena); filho de um nó vira módulo por padrão, na raiz, projeto. */
    open: (at: { x: number; y: number }, parentId: number | null) => {
      if (!canEditGraph) return;
      const parent = parentId != null ? index.node(parentId) : undefined;
      setMenu({ ...at, parentId: parent ? parent.id : null });
      form.reset({ name: '', kind: parent ? 'module' : 'project' });
    },
    close: () => setMenu(null),
    submit: async () => {
      if (!menu) return;
      const input = form.validate(createNodeSchema, {
        name: form.values.name,
        kind: form.values.kind,
        tech: '',
        icon: null,
        parent_id: menu.parentId,
        graph_id: useUiStore.getState().graphId,
      });
      if (!input) return;
      const node = await run(() => NodeApi.getInstance().create(input), 'Nó criado');
      if (!node) return;
      // O pai abre para o nó novo aparecer na cena.
      if (menu.parentId != null) expand([menu.parentId]);
      select({ type: 'node', id: node.id });
      setMenu(null);
    },
  };
}

export type CanvasMenuViewModel = ReturnType<typeof useCanvasMenuViewModel>;
