import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Selection = { type: 'node'; id: number } | { type: 'connection'; id: number };

export type ViewMode = '3d' | '2d';
export type LeftTab = 'tree' | 'docs';
export type Screen = 'graph' | 'settings' | 'repos';
export type ExportFormat = 'png' | 'svg';
export type SettingsSection = 'account' | 'users' | 'llm' | 'github';
export type PanelSide = 'left' | 'right';
export type LayoutMode = 'groups' | 'layers' | 'free';
export const DEFAULT_PANEL_WIDTHS: Record<PanelSide, number> = { left: 300, right: 380 };

export interface DocViewerTarget {
  documentId: number;
  /** Faixa de linhas a destacar. */
  startLine?: number;
  endLine?: number;
}

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
}

interface UiState {
  selection: Selection | null;
  /** Grafo (diagrama) aberto. */
  graphId: number;
  expanded: ReadonlySet<number>;
  /** Nó em foco: só ele, sua subárvore e seus vizinhos aparecem na cena. */
  focusId: number | null;
  viewMode: ViewMode;
  /** 2D: encaixa os nós numa grade. */
  magnet: boolean;
  /** 2D: caixas aninhadas pela hierarquia (infra), diagrama em colunas (camadas) ou layout livre por forças. */
  layoutMode: LayoutMode;
  leftTab: LeftTab;
  /** Painel esquerdo aberto (a barra de navegação alterna). */
  leftOpen: boolean;
  /** Nós destacados na cena pelo resultado de uma busca em documentos. */
  searchHighlight: ReadonlySet<number> | null;
  docViewer: DocViewerTarget | null;
  /** Tela principal: o grafo ou as configurações. */
  screen: Screen;
  settingsSection: SettingsSection;
  panelWidths: Record<PanelSide, number>;
  importOpen: boolean;
  toasts: Toast[];
  /** Incrementado para pedir que a câmera enquadre o grafo. */
  fitRequest: number;
  requestFit(): void;
  /** Incrementado para soltar os nós arrastados e reorganizar a cena 2D. */
  reorganizeRequest: number;
  requestReorganize(): void;
  /** Pedido de exportação do diagrama 2D (a cena 2D atende). */
  exportRequest: { format: ExportFormat; seq: number } | null;
  requestExport(format: ExportFormat): void;
  /** Abre o painel esquerdo na aba; clicar na aba já aberta fecha o painel. */
  toggleLeft(tab: LeftTab): void;
  select(selection: Selection | null): void;
  /** Abre outro grafo (limpa seleção, foco e destaques). */
  setGraph(id: number): void;
  /** Foca um nó (expande um nível e reenquadra a câmera). null sai do foco. */
  focus(id: number | null): void;
  setViewMode(mode: ViewMode): void;
  toggleMagnet(): void;
  setLayoutMode(mode: LayoutMode): void;
  setLeftTab(tab: LeftTab): void;
  setSearchHighlight(ids: Iterable<number> | null): void;
  openDocument(target: DocViewerTarget | null): void;
  showRepos(): void;
  openSettings(section?: SettingsSection): void;
  showGraph(): void;
  setPanelWidth(side: PanelSide, width: number | null): void;
  toggleExpanded(id: number): void;
  expand(ids: Iterable<number>): void;
  setExpanded(ids: Iterable<number>): void;
  setImportOpen(open: boolean): void;
  pushToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

/** Model: estado de interface (seleção, nós expandidos, modais, toasts). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selection: null,
      graphId: 1,
      expanded: new Set<number>(),
      focusId: null,
      viewMode: '2d',
      magnet: true,
      layoutMode: 'groups',
      leftTab: 'tree',
      leftOpen: true,
      searchHighlight: null,
      docViewer: null,
      screen: 'graph',
      settingsSection: 'account',
      panelWidths: DEFAULT_PANEL_WIDTHS,
      importOpen: false,
      toasts: [],
      fitRequest: 0,
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
      reorganizeRequest: 0,
      exportRequest: null,
      requestExport: (format) => set((s) => ({ exportRequest: { format, seq: (s.exportRequest?.seq ?? 0) + 1 } })),
      requestReorganize: () => set((s) => ({ reorganizeRequest: s.reorganizeRequest + 1, fitRequest: s.fitRequest + 1 })),
      toggleLeft: (tab) =>
        set((s) => (s.screen === 'graph' && s.leftOpen && s.leftTab === tab ? { leftOpen: false } : { screen: 'graph', leftOpen: true, leftTab: tab })),
      select: (selection) => set({ selection }),
      setGraph: (graphId) =>
        set((s) => (s.graphId === graphId ? {} : { graphId, selection: null, focusId: null, searchHighlight: null, fitRequest: s.fitRequest + 1 })),
      focus: (id) =>
        set((s) => ({
          focusId: id,
          expanded: id != null ? new Set([...s.expanded, id]) : s.expanded,
          fitRequest: s.fitRequest + 1,
        })),
      toggleMagnet: () => set((s) => ({ magnet: !s.magnet })),
      setLayoutMode: (layoutMode) => set((s) => ({ layoutMode, fitRequest: s.fitRequest + 1 })),
      setLeftTab: (leftTab) => set({ leftTab, leftOpen: true }),
      setSearchHighlight: (ids) => set({ searchHighlight: ids ? new Set(ids) : null }),
      openDocument: (docViewer) => set({ docViewer }),
      showRepos: () => set({ screen: 'repos' }),
      openSettings: (section) => set((s) => ({ screen: 'settings', settingsSection: section ?? s.settingsSection })),
      showGraph: () => set({ screen: 'graph' }),
      setPanelWidth: (side, width) => set((s) => ({ panelWidths: { ...s.panelWidths, [side]: width ?? DEFAULT_PANEL_WIDTHS[side] } })),
      setViewMode: (viewMode) => set((s) => ({ viewMode, fitRequest: s.fitRequest + 1 })),
      toggleExpanded: (id) =>
        set((s) => {
          const next = new Set(s.expanded);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { expanded: next };
        }),
      expand: (ids) => set((s) => ({ expanded: new Set([...s.expanded, ...ids]) })),
      setExpanded: (ids) => set({ expanded: new Set(ids) }),
      setImportOpen: (importOpen) => set({ importOpen }),
      pushToast: (kind, message) => set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, kind, message }] })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'comm-graph-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        graphId: s.graphId,
        expanded: [...s.expanded],
        selection: s.selection,
        focusId: s.focusId,
        viewMode: s.viewMode,
        magnet: s.magnet,
        layoutMode: s.layoutMode,
        leftTab: s.leftTab,
        leftOpen: s.leftOpen,
        panelWidths: s.panelWidths,
      }),
      merge: (persisted, current) => {
        const p = persisted as
          | Partial<{
              graphId: number;
              expanded: number[];
              selection: Selection | null;
              focusId: number | null;
              viewMode: ViewMode;
              magnet: boolean;
              layoutMode: LayoutMode;
              leftTab: LeftTab;
              leftOpen: boolean;
              panelWidths: Record<PanelSide, number>;
            }>
          | undefined;
        return {
          ...current,
          graphId: typeof p?.graphId === 'number' ? p.graphId : 1,
          expanded: new Set(p?.expanded ?? []),
          selection: p?.selection ?? null,
          focusId: p?.focusId ?? null,
          viewMode: p?.viewMode === '3d' ? '3d' : '2d',
          magnet: p?.magnet ?? true,
          layoutMode: p?.layoutMode === 'free' || p?.layoutMode === 'layers' ? p.layoutMode : 'groups',
          leftTab: p?.leftTab === 'docs' ? 'docs' : 'tree',
          leftOpen: p?.leftOpen ?? true,
          panelWidths: { ...DEFAULT_PANEL_WIDTHS, ...p?.panelWidths },
        };
      },
    },
  ),
);
