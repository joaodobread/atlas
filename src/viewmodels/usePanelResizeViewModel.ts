import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useUiStore, type PanelSide } from '../stores/uiStore.ts';

const MIN = 220;
/** Espaço mínimo que sobra para a cena. */
const MIN_STAGE = 160;

/** Arrastar a borda de um painel lateral para mudar a largura; clique duplo volta ao padrão. */
export function usePanelResizeViewModel(side: PanelSide) {
  const width = useUiStore((s) => s.panelWidths[side]);
  const other = useUiStore((s) => s.panelWidths[side === 'left' ? 'right' : 'left']);
  const setPanelWidth = useUiStore((s) => s.setPanelWidth);

  const clamp = (w: number) => Math.round(Math.max(MIN, Math.min(w, window.innerWidth - other - MIN_STAGE)));
  const expanded = width > window.innerWidth * 0.4;

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      setPanelWidth(side, clamp(side === 'left' ? startWidth + dx : startWidth - dx));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return {
    width,
    onPointerDown,
    reset: () => setPanelWidth(side, null),
    expanded,
    /** Alterna entre o tamanho padrão e ~60% da janela. */
    toggleExpanded: () => (expanded ? setPanelWidth(side, null) : setPanelWidth(side, clamp(window.innerWidth * 0.6))),
    /** Teclado: setas mudam a largura em 20px. */
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const delta = (e.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1);
      setPanelWidth(side, clamp(width + delta));
    },
  };
}
