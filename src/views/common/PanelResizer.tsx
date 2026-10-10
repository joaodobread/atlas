import type { PanelSide } from '../../stores/uiStore.ts';
import { usePanelResizeViewModel } from '../../viewmodels/usePanelResizeViewModel.ts';

export function PanelResizer({ side }: { side: PanelSide }) {
  const vm = usePanelResizeViewModel(side);
  return (
    <div
      className={`panel-resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Redimensionar painel esquerdo' : 'Redimensionar painel direito'}
      aria-valuenow={vm.width}
      tabIndex={0}
      title="Arraste para redimensionar · clique duplo para o tamanho padrão"
      onPointerDown={vm.onPointerDown}
      onDoubleClick={vm.reset}
      onKeyDown={vm.onKeyDown}
    />
  );
}
