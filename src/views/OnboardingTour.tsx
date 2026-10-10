import type { CSSProperties } from 'react';
import { useOnboardingViewModel } from '../viewmodels/useOnboardingViewModel.ts';

const PAD = 6;
const CARD_W = 340;

/** Destaca o elemento do passo atual e mostra a explicação ao lado. */
export function OnboardingTour() {
  const vm = useOnboardingViewModel();
  if (!vm.active) return null;
  const r = vm.rect;
  const card: CSSProperties = r
    ? (() => {
        const right = r.right + 14 + CARD_W < window.innerWidth;
        const left = right ? r.right + 14 : Math.max(12, Math.min(window.innerWidth - CARD_W - 12, r.left));
        const top = right ? Math.min(Math.max(12, r.top), window.innerHeight - 240) : Math.min(r.bottom + 14, window.innerHeight - 240);
        return { left, top, width: CARD_W };
      })()
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 420 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={vm.step.title}>
      {r ? (
        <div className="tour-spotlight" style={{ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }} />
      ) : (
        <div className="tour-backdrop" />
      )}
      <div className="tour-card" style={card}>
        <span className="muted small">
          {vm.index + 1} de {vm.total}
        </span>
        <h3>{vm.step.title}</h3>
        <p>{vm.step.body}</p>
        <div className="row actions">
          <button className="link-button" onClick={vm.skip}>
            Pular tour
          </button>
          <span className="spacer" />
          {vm.index > 0 && <button onClick={vm.back}>Voltar</button>}
          <button className="primary" autoFocus onClick={vm.next}>
            {vm.isLast ? 'Concluir' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>
  );
}
