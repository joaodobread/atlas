import { Maximize2, Minimize2, X } from 'lucide-react';
import type { LeftTab } from '../../stores/uiStore.ts';
import { DocsPanel } from '../docs/DocsPanel.tsx';
import { usePanelResizeViewModel } from '../../viewmodels/usePanelResizeViewModel.ts';
import { TreePanel } from './TreePanel.tsx';

const TITLES: Record<LeftTab, string> = { tree: 'Estrutura', docs: 'Documentos' };

interface LeftPanelProps {
  tab: LeftTab;
  onClose(): void;
}

export function LeftPanel({ tab, onClose }: LeftPanelProps) {
  const size = usePanelResizeViewModel('left');
  return (
    <aside className="panel panel-left">
      <div className="panel-header">
        <h2>{TITLES[tab]}</h2>
        <button
          className="tool"
          onClick={size.toggleExpanded}
          title={size.expanded ? 'Tamanho padrão' : 'Expandir painel'}
          aria-label={size.expanded ? 'Tamanho padrão' : 'Expandir painel'}
        >
          {size.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="tool" onClick={onClose} title="Fechar painel" aria-label="Fechar painel">
          <X size={14} />
        </button>
      </div>
      {tab === 'tree' ? <TreePanel /> : <DocsPanel />}
    </aside>
  );
}
