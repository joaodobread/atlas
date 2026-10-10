import type { FormEvent } from 'react';
import type { NodeKind } from '../../../shared/constants.ts';
import type { GraphNode } from '../../../shared/types.ts';
import { useTreeViewModel } from '../../viewmodels/useTreeViewModel.ts';
import { Field } from '../common/Field.tsx';
import { IconPicker } from '../common/IconPicker.tsx';
import { NodeIcon } from '../icons/NodeIcon.tsx';

type TreeVM = ReturnType<typeof useTreeViewModel>;

export function TreePanel() {
  const vm = useTreeViewModel();
  const { values, errors, set } = vm.form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.createRoot();
  };

  return (
    <>
      <div className="tree">
        {vm.roots.length === 0 && <p className="muted">Nenhum nó ainda. Crie um abaixo.</p>}
        {vm.roots.map((n) => (
          <TreeItem key={n.id} node={n} depth={0} vm={vm} />
        ))}
      </div>

      {vm.canEdit && (
        <form className="card" onSubmit={submit} data-tour="new-node">
          <h3>Novo nó raiz</h3>
          <div className="row">
            <IconPicker value={values.icon} onChange={(v) => set('icon', v)} kind={values.kind} tech={values.tech} />
            <Field error={errors.name}>
              <input placeholder="Nome (ex.: API de Pedidos)" value={values.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <Field error={errors.kind}>
              <select value={values.kind} onChange={(e) => set('kind', e.target.value as NodeKind)}>
                {vm.kinds.map((k) => (
                  <option key={k} value={k}>
                    {vm.kindLabel(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field error={errors.tech}>
              <input placeholder="Tecnologia" value={values.tech} onChange={(e) => set('tech', e.target.value)} />
            </Field>
          </div>
          <button className="primary" disabled={vm.busy}>
            Criar
          </button>
        </form>
      )}
    </>
  );
}

function TreeItem({ node, depth, vm }: { node: GraphNode; depth: number; vm: TreeVM }) {
  const hasChildren = vm.hasChildren(node.id);
  const open = vm.isExpanded(node.id);
  return (
    <>
      <div
        className={`tree-row${vm.isSelected(node.id) ? ' selected' : ''}${vm.isFocused(node.id) ? ' focused' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => vm.select(node.id)}
      >
        <button
          className="caret"
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            vm.toggle(node.id);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        <NodeIcon id={vm.icon(node)} size={14} color={vm.color(node.kind)} />
        <span className="tree-name">{node.name}</span>
        <span className="tree-kind">{vm.kindLabel(node.kind)}</span>
      </div>
      {open && vm.children(node.id).map((c) => <TreeItem key={c.id} node={c} depth={depth + 1} vm={vm} />)}
    </>
  );
}
