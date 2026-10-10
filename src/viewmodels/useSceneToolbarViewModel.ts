import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore, type LayoutMode, type ViewMode } from '../stores/uiStore.ts';

const LAYOUTS: Array<{ mode: LayoutMode; label: string; title: string }> = [
  { mode: 'groups', label: 'Infra', title: 'Caixas aninhadas pela hierarquia (contas, VPCs, clusters)' },
  { mode: 'layers', label: 'Camadas', title: 'Diagrama em colunas' },
  { mode: 'free', label: 'Livre', title: 'Layout livre por forças' },
];

/** Controles da cena: modo 2D/3D, layout, expandir/recolher, enquadrar e reorganizar. */
export function useSceneToolbarViewModel() {
  const index = useGraphStore((s) => s.index);
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);
  const magnet = useUiStore((s) => s.magnet);
  const toggleMagnet = useUiStore((s) => s.toggleMagnet);
  const setExpanded = useUiStore((s) => s.setExpanded);
  const requestFit = useUiStore((s) => s.requestFit);
  const requestReorganize = useUiStore((s) => s.requestReorganize);
  const requestExport = useUiStore((s) => s.requestExport);

  const is2d = viewMode === '2d';
  return {
    viewModes: ['2d', '3d'] as ViewMode[],
    viewMode,
    setViewMode,
    layouts: is2d ? LAYOUTS : [],
    layoutMode,
    setLayoutMode,
    showMagnet: is2d && layoutMode === 'free',
    magnet,
    toggleMagnet,
    /** Só faz sentido onde dá para arrastar nós. */
    showReorganize: is2d && layoutMode !== 'groups',
    reorganize: requestReorganize,
    expandAll: () => {
      setExpanded(index.nodes.filter((n) => index.hasChildren(n.id)).map((n) => n.id));
      requestFit();
    },
    collapseAll: () => {
      setExpanded([]);
      requestFit();
    },
    fit: requestFit,
    /** Exportação usa o SVG da cena 2D. */
    canExport: is2d,
    exportPng: () => requestExport('png'),
    exportSvg: () => requestExport('svg'),
    stats: `${index.nodes.length} nós · ${index.connections.length} conexões`,
  };
}
