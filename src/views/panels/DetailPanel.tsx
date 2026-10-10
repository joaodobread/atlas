import { X } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore.ts';
import { ConnectionDetailView } from './ConnectionDetailView.tsx';
import { NodeDetailView } from './NodeDetailView.tsx';

/** Só aparece com algo selecionado. */
export function DetailPanel() {
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  if (!selection) return null;
  return (
    <aside className="panel panel-right">
      <button className="tool panel-close" onClick={() => select(null)} title="Fechar" aria-label="Fechar detalhes">
        <X size={14} />
      </button>
      {selection.type === 'node' && <NodeDetailView key={`n${selection.id}`} nodeId={selection.id} />}
      {selection.type === 'connection' && <ConnectionDetailView key={`c${selection.id}`} connectionId={selection.id} />}
    </aside>
  );
}
