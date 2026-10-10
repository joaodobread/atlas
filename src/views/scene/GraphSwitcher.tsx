import type { FormEvent } from 'react';
import { Check, ChevronDown, Network } from 'lucide-react';
import { useGraphSwitcherViewModel } from '../../viewmodels/useGraphSwitcherViewModel.ts';

const close = (el: HTMLElement) => (el.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');

export function GraphSwitcher() {
  const vm = useGraphSwitcherViewModel();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.submit();
  };
  return (
    <details className="tool-menu graph-switcher" data-tour="graph-switcher">
      <summary className="graph-switcher-current" title="Trocar de grafo">
        <Network size={14} />
        <span>{vm.currentName}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="menu wide">
        {vm.mode.type === 'list' ? (
          <>
            <div className="menu-title">Grafos</div>
            {vm.graphs.map((g) => (
              <button
                key={g.id}
                className="graph-option"
                onClick={(e) => {
                  vm.open(g.id);
                  close(e.currentTarget);
                }}
              >
                <span className="check-slot">{vm.current?.id === g.id && <Check size={14} />}</span>
                <span className="grow">{g.name}</span>
                <span className="muted small">{g.nodeCount} nós</span>
              </button>
            ))}
            {vm.canEdit && (
              <>
                <div className="menu-sep" />
                <button onClick={vm.startCreate}>+ Novo grafo</button>
                <button onClick={vm.startRename}>Renomear “{vm.currentName}”</button>
                {vm.canDelete && (
                  <button className="danger" onClick={vm.remove}>
                    Excluir “{vm.currentName}”
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <form className="menu-form" onSubmit={submit}>
            <div className="menu-title">{vm.mode.type === 'create' ? 'Novo grafo' : 'Renomear grafo'}</div>
            <input autoFocus placeholder="Nome do grafo" value={vm.name} onChange={(e) => vm.setName(e.target.value)} />
            {vm.error && <span className="field-error">{vm.error}</span>}
            <div className="row">
              <button type="button" onClick={vm.cancel}>
                Cancelar
              </button>
              <button className="primary" disabled={vm.busy}>
                {vm.mode.type === 'create' ? 'Criar' : 'Salvar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
