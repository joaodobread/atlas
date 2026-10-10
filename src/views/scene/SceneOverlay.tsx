import { useSceneOverlayViewModel } from '../../viewmodels/useSceneOverlayViewModel.ts';
import { NodeIcon } from '../icons/NodeIcon.tsx';
import { SceneToolbar } from './SceneToolbar.tsx';

export function SceneOverlay() {
  const vm = useSceneOverlayViewModel();
  return (
    <>
      <div className="scene-top">
        <SceneToolbar />
        {vm.inFocus && (
          <div className="focus-bar">
            <span className="muted">Foco:</span>
            <button className="crumb" onClick={vm.exitFocus}>
              Tudo
            </button>
            {vm.trail.map((c) => (
              <span key={c.id} className="crumb-wrap">
                <span className="muted">/</span>
                <button className={`crumb${c.current ? ' current' : ''}`} disabled={c.current} onClick={() => vm.focusOn(c.id)}>
                  {c.name}
                </button>
              </span>
            ))}
            <button className="exit" onClick={vm.exitFocus} title="Esc">
              Sair do foco
            </button>
          </div>
        )}
      </div>
      {vm.legend.length > 0 && (
        <div className="legend">
          {vm.legend.map((l) => (
            <span key={l.kind} className="legend-item">
              <NodeIcon id={l.icon} size={12} color={l.color} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
