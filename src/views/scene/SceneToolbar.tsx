import { ChevronsDownUp, ChevronsUpDown, Download, Magnet, RotateCcw, Scan } from 'lucide-react';
import { useSceneToolbarViewModel } from '../../viewmodels/useSceneToolbarViewModel.ts';
import { GraphSwitcher } from './GraphSwitcher.tsx';

export function SceneToolbar() {
  const vm = useSceneToolbarViewModel();
  return (
    <div className="scene-toolbar" role="toolbar" aria-label="Controles da cena">
      <GraphSwitcher />
      <span className="toolbar-sep" />
      <div className="segmented" role="group" aria-label="Modo de visualização">
        {vm.viewModes.map((m) => (
          <button key={m} className={vm.viewMode === m ? 'active' : ''} onClick={() => vm.setViewMode(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      {vm.layouts.length > 0 && (
        <div className="segmented" role="group" aria-label="Layout" data-tour="layouts">
          {vm.layouts.map((l) => (
            <button key={l.mode} className={vm.layoutMode === l.mode ? 'active' : ''} onClick={() => vm.setLayoutMode(l.mode)} title={l.title}>
              {l.label}
            </button>
          ))}
        </div>
      )}
      <span className="toolbar-sep" />
      <button className="tool" onClick={vm.expandAll} title="Expandir tudo" aria-label="Expandir tudo">
        <ChevronsUpDown size={16} />
      </button>
      <button className="tool" onClick={vm.collapseAll} title="Recolher tudo" aria-label="Recolher tudo">
        <ChevronsDownUp size={16} />
      </button>
      <button className="tool" onClick={vm.fit} title="Enquadrar" aria-label="Enquadrar">
        <Scan size={16} />
      </button>
      {vm.showMagnet && (
        <button
          className={`tool${vm.magnet ? ' active' : ''}`}
          onClick={vm.toggleMagnet}
          title={`Ímã ${vm.magnet ? 'ligado' : 'desligado'}: encaixa os nós numa grade`}
          aria-pressed={vm.magnet}
        >
          <Magnet size={16} />
        </button>
      )}
      {vm.showReorganize && (
        <button className="tool" onClick={vm.reorganize} title="Reorganizar: solta os nós arrastados" aria-label="Reorganizar">
          <RotateCcw size={16} />
        </button>
      )}
      <details className="tool-menu">
        <summary
          className={`tool${vm.canExport ? '' : ' disabled'}`}
          title={vm.canExport ? 'Exportar diagrama' : 'Exportação disponível no modo 2D'}
          aria-label="Exportar diagrama"
        >
          <Download size={16} />
        </summary>
        {vm.canExport && (
          <div className="menu" onClick={(e) => (e.currentTarget.closest('details') as HTMLDetailsElement).removeAttribute('open')}>
            <button onClick={vm.exportPng}>PNG (imagem)</button>
            <button onClick={vm.exportSvg}>SVG (vetor)</button>
          </div>
        )}
      </details>
      <span className="stats muted">{vm.stats}</span>
    </div>
  );
}
