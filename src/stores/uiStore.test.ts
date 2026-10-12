import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../testing/vmFixtures.ts';
import { DEFAULT_PANEL_WIDTHS, useUiStore } from './uiStore.ts';

const ui = () => useUiStore.getState();

beforeEach(() => resetStores());

describe('uiStore', () => {
  it('pedidos de enquadrar, reorganizar e exportar incrementam contadores', () => {
    ui().requestFit();
    expect(ui().fitRequest).toBe(1);
    ui().requestReorganize();
    expect(ui()).toMatchObject({ reorganizeRequest: 1, fitRequest: 2 });
    ui().requestExport('png');
    expect(ui().exportRequest).toEqual({ format: 'png', seq: 1 });
    ui().requestExport('svg');
    expect(ui().exportRequest).toEqual({ format: 'svg', seq: 2 });
  });

  it('toggleLeft abre na aba, fecha se já aberta e volta para o grafo', () => {
    ui().toggleLeft('tree');
    expect(ui().leftOpen).toBe(false);
    ui().toggleLeft('docs');
    expect(ui()).toMatchObject({ leftOpen: true, leftTab: 'docs' });
    ui().openSettings();
    ui().toggleLeft('docs');
    expect(ui()).toMatchObject({ screen: 'graph', leftOpen: true, leftTab: 'docs' });
  });

  it('telas: configurações (mantendo a seção), repositórios e grafo', () => {
    ui().openSettings('llm');
    expect(ui()).toMatchObject({ screen: 'settings', settingsSection: 'llm' });
    ui().showRepos();
    expect(ui().screen).toBe('repos');
    ui().showSecurity({ owner: 'acme', name: 'api' });
    expect(ui()).toMatchObject({ screen: 'security', securityScope: { owner: 'acme', name: 'api' } });
    ui().showSecurity();
    expect(ui().securityScope).toBeNull();
    ui().openSettings();
    expect(ui().settingsSection).toBe('llm');
    ui().showGraph();
    expect(ui().screen).toBe('graph');
  });

  it('setGraph limpa seleção, foco e destaques; mesmo id não muda nada', () => {
    useUiStore.setState({ selection: { type: 'node', id: 1 }, focusId: 1, searchHighlight: new Set([1]) });
    ui().setGraph(1);
    expect(ui().selection).not.toBeNull();
    ui().setGraph(2);
    expect(ui()).toMatchObject({ graphId: 2, selection: null, focusId: null, searchHighlight: null, fitRequest: 1 });
  });

  it('foco expande o nó; null sai do foco', () => {
    ui().focus(5);
    expect(ui().focusId).toBe(5);
    expect(ui().expanded.has(5)).toBe(true);
    const expanded = ui().expanded;
    ui().focus(null);
    expect(ui().focusId).toBeNull();
    expect(ui().expanded).toBe(expanded);
    expect(ui().fitRequest).toBe(2);
  });

  it('expandir, recolher e definir expandidos', () => {
    ui().toggleExpanded(1);
    expect(ui().expanded.has(1)).toBe(true);
    ui().toggleExpanded(1);
    expect(ui().expanded.has(1)).toBe(false);
    ui().expand([2, 3]);
    expect([...ui().expanded]).toEqual([2, 3]);
    ui().setExpanded([4]);
    expect([...ui().expanded]).toEqual([4]);
  });

  it('modos e preferências simples', () => {
    ui().select({ type: 'connection', id: 3 });
    expect(ui().selection).toEqual({ type: 'connection', id: 3 });
    ui().setViewMode('3d');
    ui().toggleMagnet();
    ui().setLayoutMode('layers');
    ui().setLeftTab('docs');
    ui().setSearchHighlight([1, 2]);
    ui().openDocument({ documentId: 4 });
    ui().setImportOpen(true);
    expect(ui()).toMatchObject({ viewMode: '3d', magnet: false, layoutMode: 'layers', leftTab: 'docs', leftOpen: true, importOpen: true, fitRequest: 2 });
    expect([...ui().searchHighlight!]).toEqual([1, 2]);
    expect(ui().docViewer).toEqual({ documentId: 4 });
    ui().setSearchHighlight(null);
    expect(ui().searchHighlight).toBeNull();
  });

  it('larguras dos painéis: valor ou padrão', () => {
    ui().setPanelWidth('left', 500);
    expect(ui().panelWidths).toEqual({ left: 500, right: DEFAULT_PANEL_WIDTHS.right });
    ui().setPanelWidth('left', null);
    expect(ui().panelWidths.left).toBe(DEFAULT_PANEL_WIDTHS.left);
  });

  it('toasts com ids crescentes e dispensa', () => {
    ui().pushToast('info', 'a');
    ui().pushToast('error', 'b');
    const [a, b] = ui().toasts;
    expect(b!.id).toBeGreaterThan(a!.id);
    ui().dismissToast(a!.id);
    expect(ui().toasts.map((t) => t.message)).toEqual(['b']);
  });

  describe('persistência', () => {
    it('salva só os campos de preferência', () => {
      ui().setExpanded([1, 2]);
      ui().pushToast('info', 'x');
      const saved = JSON.parse(localStorage.getItem('comm-graph-ui')!) as { state: Record<string, unknown> };
      expect(saved.state.expanded).toEqual([1, 2]);
      expect(saved.state).not.toHaveProperty('toasts');
      expect(Object.keys(saved.state).sort()).toEqual(
        ['expanded', 'focusId', 'graphId', 'layoutMode', 'leftOpen', 'leftTab', 'magnet', 'panelWidths', 'selection', 'viewMode'].sort(),
      );
    });

    it('merge aplica padrões para valores ausentes, legados ou corrompidos', () => {
      const merge = useUiStore.persist.getOptions().merge!;
      const current = ui();
      const empty = merge(undefined, current);
      expect(empty).toMatchObject({
        graphId: 1,
        selection: null,
        focusId: null,
        viewMode: '2d',
        magnet: true,
        layoutMode: 'groups',
        leftTab: 'tree',
        leftOpen: true,
      });
      expect(empty.panelWidths).toEqual(DEFAULT_PANEL_WIDTHS);
      const bad = merge({ graphId: '7', viewMode: 'vr', layoutMode: 'force', leftTab: 'x', panelWidths: { left: 400 } }, current);
      expect(bad).toMatchObject({ graphId: 1, viewMode: '2d', layoutMode: 'groups', leftTab: 'tree' });
      expect(bad.panelWidths).toEqual({ left: 400, right: DEFAULT_PANEL_WIDTHS.right });
      const ok = merge(
        {
          graphId: 3,
          expanded: [1],
          selection: { type: 'node', id: 1 },
          focusId: 1,
          viewMode: '3d',
          magnet: false,
          layoutMode: 'free',
          leftTab: 'docs',
          leftOpen: false,
        },
        current,
      );
      expect(ok).toMatchObject({ graphId: 3, focusId: 1, viewMode: '3d', magnet: false, layoutMode: 'free', leftTab: 'docs', leftOpen: false });
      expect([...ok.expanded]).toEqual([1]);
      expect(merge({ layoutMode: 'layers' }, current).layoutMode).toBe('layers');
    });

    it('reidrata do localStorage', async () => {
      localStorage.setItem('comm-graph-ui', JSON.stringify({ state: { graphId: 8, expanded: [3], viewMode: '3d' }, version: 0 }));
      await useUiStore.persist.rehydrate();
      expect(ui().graphId).toBe(8);
      expect(ui().expanded.has(3)).toBe(true);
      expect(ui().viewMode).toBe('3d');
    });
  });
});
