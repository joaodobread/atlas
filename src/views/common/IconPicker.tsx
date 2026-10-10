import type { NodeKind } from '../../../shared/constants.ts';
import { useIconPickerViewModel } from '../../viewmodels/useIconPickerViewModel.ts';
import { NodeIcon } from '../icons/NodeIcon.tsx';

interface IconPickerProps {
  value: string | null;
  onChange(value: string | null): void;
  kind: NodeKind;
  tech: string;
}

export function IconPicker(props: IconPickerProps) {
  const vm = useIconPickerViewModel(props);
  return (
    <div className="icon-picker" ref={vm.rootRef}>
      <button type="button" className="icon-picker-trigger" title={`Ícone: ${vm.label}`} onClick={vm.toggle} style={{ borderColor: vm.color }}>
        <NodeIcon id={vm.effective} size={18} color={vm.color} />
        {vm.isAuto && <span className="auto-dot" title="Automático" />}
      </button>
      {vm.open && (
        <div className="icon-popover" style={vm.placement}>
          <input autoFocus placeholder="Buscar ícone (mysql, fila, auth...)" value={vm.query} onChange={(e) => vm.setQuery(e.target.value)} />
          <button type="button" className={`icon-auto${vm.isAuto ? ' selected' : ''}`} onClick={() => vm.choose(null)}>
            Automático pelo tipo/tecnologia
          </button>
          <div className="icon-groups">
            {vm.groups.map((g) => (
              <div key={g.group}>
                <div className="icon-group-title">{g.group}</div>
                <div className="icon-grid">
                  {g.icons.map((i) => (
                    <button
                      type="button"
                      key={i.id}
                      title={i.label}
                      className={`icon-cell${vm.isSelected(i.id) ? ' selected' : ''}`}
                      onClick={() => vm.choose(i.id)}
                    >
                      <NodeIcon id={i.id} size={20} color={vm.color} />
                      <span>{i.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {vm.groups.length === 0 && <p className="muted">Nenhum ícone encontrado.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
