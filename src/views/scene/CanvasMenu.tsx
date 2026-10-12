import { useEffect, useRef } from 'react';
import type { NodeKind } from '../../../shared/constants.ts';
import type { CanvasMenuViewModel } from '../../viewmodels/useCanvasMenuViewModel.ts';

/** Formulário rápido do clique direito na cena (nome + tipo). Fecha com Esc ou clicando fora. */
export function CanvasMenu({ vm }: { vm: CanvasMenuViewModel }) {
  const ref = useRef<HTMLFormElement>(null);
  const menu = vm.menu;
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && vm.close();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) vm.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu]);
  if (!menu) return null;
  const f = vm.form;
  return (
    <form
      ref={ref}
      className="canvas-menu"
      style={{ left: menu.x, top: menu.y }}
      onSubmit={(e) => {
        e.preventDefault();
        void vm.submit();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="canvas-menu-title small muted">Novo nó {vm.placeLabel}</div>
      <input autoFocus placeholder="Nome (ex.: API de Pedidos)" value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
      {f.errors.name && <span className="field-error small">{f.errors.name}</span>}
      <div className="row">
        <select value={f.values.kind} onChange={(e) => f.set('kind', e.target.value as NodeKind)}>
          {vm.kinds.map((k) => (
            <option key={k} value={k}>
              {vm.kindLabel(k)}
            </option>
          ))}
        </select>
        <button className="primary" disabled={vm.busy}>
          Criar
        </button>
      </div>
    </form>
  );
}
