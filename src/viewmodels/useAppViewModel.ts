import { useEffect } from 'react';
import { GraphSync } from '../data/GraphSync.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export function useAppViewModel() {
  const status = useGraphStore((s) => s.status);
  const error = useGraphStore((s) => s.error);
  const index = useGraphStore((s) => s.index);
  const selection = useUiStore((s) => s.selection);
  const importOpen = useUiStore((s) => s.importOpen);
  const select = useUiStore((s) => s.select);
  const focusId = useUiStore((s) => s.focusId);
  const focus = useUiStore((s) => s.focus);
  const viewMode = useUiStore((s) => s.viewMode);
  const leftTab = useUiStore((s) => s.leftTab);
  const leftOpen = useUiStore((s) => s.leftOpen);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const panelWidths = useUiStore((s) => s.panelWidths);
  const screen = useUiStore((s) => s.screen);

  useEffect(() => {
    void GraphSync.getInstance().reload();
  }, []);

  // Seleção persistida pode apontar para algo que não existe mais.
  useEffect(() => {
    if (status !== 'ready' || !selection) return;
    const exists = selection.type === 'node' ? index.node(selection.id) : index.connection(selection.id);
    if (!exists) select(null);
  }, [status, index, selection, select]);

  useEffect(() => {
    if (status === 'ready' && focusId != null && !index.node(focusId)) focus(null);
  }, [status, index, focusId, focus]);

  // Esc sai do foco (exceto quando digitando num campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key === 'Escape' && !typing && useUiStore.getState().focusId != null) focus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  return {
    status,
    error,
    importOpen,
    selection,
    viewMode,
    leftTab,
    leftOpen,
    closeLeft: () => toggleLeft(leftTab),
    hasSelection: selection != null,
    panelWidths,
    screen,
    retry: () => void GraphSync.getInstance().reload(),
  };
}
