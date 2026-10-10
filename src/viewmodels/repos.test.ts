import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntrospectionRunState, RepoIntrospectionDetail, RepoIntrospectionSummary } from '../../shared/types.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { GithubApi } from '../data/api/GithubApi.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeGraphInfo, makeNode, makeRepo, resetStores, seedGraph, setPermissions, toasts } from '../testing/vmFixtures.ts';
import { DEPTH_OPTIONS, useGenerateGraphViewModel } from './useGenerateGraphViewModel.ts';
import { ageLabel, BAND_LABEL, bandOf, CATEGORY_LABEL, CHECK_STATUS_LABEL, idleClass, useReposViewModel } from './useReposViewModel.ts';

const idle: IntrospectionRunState = { running: false, queued: 0, current: null, done: 0, failed: 0, progress: [] };
const flush = () => act(async () => {});
let api: GithubApi;

beforeEach(() => {
  resetStores();
  api = GithubApi.getInstance();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bandOf', () => {
  it('classifica a nota', () => {
    expect([null, 8, 7.9, 5, 4.9].map(bandOf)).toEqual(['none', 'good', 'mid', 'mid', 'bad']);
  });
});

describe('useReposViewModel', () => {
  const repos: RepoIntrospectionSummary[] = [
    makeRepo(1, { name: 'api', system: 'Pedidos', score: 9, analyzedAt: 'x', confidence: 0.9, hasMetrics: true, nodeId: 5 }),
    makeRepo(2, { name: 'web', system: 'Pedidos', score: 4, analyzedAt: 'x', confidence: 0.5, failingCategories: ['tests'] }),
    makeRepo(3, { name: 'auth', system: 'Contas', score: 6, analyzedAt: 'x', confidence: 0.7, description: 'Login central' }),
    makeRepo(4, { name: 'lib', system: null, score: null }),
    makeRepo(5, { name: 'bff', system: 'Borda', score: 4, analyzedAt: 'x', confidence: 0.6 }),
  ];
  const detail = (o: Partial<RepoIntrospectionDetail> = {}) => ({ ...makeRepo(1), documentId: 8, ...o }) as RepoIntrospectionDetail;

  function mount(list = repos, state = idle) {
    vi.spyOn(api, 'repos').mockResolvedValue(list);
    vi.spyOn(api, 'state').mockResolvedValue(state);
    return renderHook(() => useReposViewModel());
  }

  it('carrega, agrupa por sistema (piores primeiro, sem sistema no fim) e calcula estatísticas', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    expect(result.current.groups.map((g) => [g.name, g.repos.map((r) => r.name)])).toEqual([
      ['Borda', ['bff']],
      ['Pedidos', ['web', 'api']],
      ['Contas', ['auth']],
      ['Sem sistema', ['lib']],
    ]);
    expect(result.current.stats).toEqual({
      total: 5,
      analyzed: 4,
      bands: { good: 1, mid: 1, bad: 2, none: 1 },
      withMetrics: 25,
      medianConfidence: 65,
      linked: 1,
      needAttention: 0,
      watch: 0,
      idleYear: 0,
      oldPrs: 0,
      reposWithOldPrs: 0,
      prsUnreadable: 0,
    });
    expect(result.current).toMatchObject({
      canRun: false,
      canConfigure: false,
      currentGraphName: 'atual',
      statusLabel: CHECK_STATUS_LABEL,
      categoryLabel: CATEGORY_LABEL,
      bandLabel: BAND_LABEL,
    });
  });

  it('estatísticas sem repositórios analisados e mediana ímpar', async () => {
    const { result } = mount([makeRepo(1), makeRepo(2, { analyzedAt: 'x', confidence: 0.3 })]);
    await waitFor(() => expect(result.current.stats.total).toBe(2));
    expect(result.current.stats).toMatchObject({ analyzed: 1, withMetrics: 0, medianConfidence: 30 });
    const empty = mount([]);
    await flush();
    expect(empty.result.current.stats).toMatchObject({ withMetrics: null, medianConfidence: null });
  });

  it('filtros por texto, faixa e categoria reprovada', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    act(() => result.current.setFilter(' PEDIDOS '));
    expect(result.current.visibleCount).toBe(2);
    act(() => result.current.setFilter('login'));
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['auth']);
    act(() => result.current.setFilter(''));
    act(() => result.current.setBand('bad'));
    expect(result.current.visibleCount).toBe(2);
    act(() => result.current.setFailing('tests'));
    expect(result.current.groups.flatMap((g) => g.repos.map((r) => r.name))).toEqual(['web']);
  });

  it('saúde: estatísticas, filtros de atividade/atenção, atalhos e ordenação', async () => {
    const day = 24 * 3600 * 1000;
    const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
    const activity = (oldPrs: number, openPrs: number | null = oldPrs) => ({ collectedAt: ago(0), openPrs, draftPrs: 0, oldPrs, pulls: [], error: null });
    const list = [
      makeRepo(1, { name: 'novo', pushedAt: ago(5), activity: activity(0, 1) }),
      makeRepo(2, { name: 'parado', pushedAt: ago(400), attention: { level: 'attention', reasons: ['Sem commits há 13 meses'] } }),
      makeRepo(3, { name: 'prs', pushedAt: ago(100), activity: activity(3), attention: { level: 'watch', reasons: ['3 PR(s)'] } }),
      makeRepo(4, { name: 'velho-arq', pushedAt: ago(900), archived: true }),
      makeRepo(5, { name: 'sem-perm', pushedAt: null, activity: activity(0, null) }),
    ];
    const { result } = mount(list);
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    expect(result.current.stats).toMatchObject({ needAttention: 1, watch: 1, idleYear: 1, oldPrs: 3, reposWithOldPrs: 1, prsUnreadable: 1 });

    act(() => result.current.setIdle(3));
    expect(result.current.groups.flatMap((g) => g.repos.map((r) => r.name)).sort()).toEqual(['parado', 'prs', 'velho-arq']);
    act(() => result.current.setIdle(''));
    act(() => result.current.setAttention('watch'));
    expect(result.current.visibleCount).toBe(2);

    act(() => result.current.setAttention(''));
    act(() => result.current.showAttention());
    expect(result.current.attention).toBe('attention');
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['parado']);

    act(() => result.current.setAttention(''));
    act(() => result.current.showOldPrs());
    expect(result.current.groups[0]!.repos.map((r) => r.name).slice(0, 2)).toEqual(['prs', 'novo']);

    act(() => result.current.showIdleYear());
    expect(result.current.idle).toBe(12);
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['velho-arq', 'parado']);
  });

  it('progresso das análises em andamento vira linhas para a tela', async () => {
    const started = new Date().toISOString();
    const { result } = mount(repos, {
      ...idle,
      running: true,
      progress: [{ repo: 'api', depth: 'full', stage: 'scanning', done: 30, total: 120, startedAt: started, stageStartedAt: started }],
    });
    await waitFor(() => expect(result.current.progressRows).toHaveLength(1));
    expect(result.current.progressRows[0]).toMatchObject({ repo: 'api', label: 'Etapa 3 de 5 · Lendo o código', counter: '30/120 arquivos', percent: 25 });
    const empty = mount();
    await waitFor(() => expect(empty.result.current.visibleCount).toBe(5));
    expect(empty.result.current.progressRows).toEqual([]);
  });

  it('selecionar todos vale para a lista filtrada e alterna', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    expect(result.current).toMatchObject({ allChecked: false, someChecked: false });
    act(() => result.current.toggleChecked('api'));
    expect(result.current).toMatchObject({ allChecked: false, someChecked: true });
    act(() => result.current.toggleAll());
    expect(result.current).toMatchObject({ allChecked: true, someChecked: false });
    expect(result.current.checked.size).toBe(5);
    // Com filtro, só os visíveis entram/saem.
    act(() => result.current.setFilter('pedidos'));
    act(() => result.current.toggleAll());
    expect([...result.current.checked].sort((a, b) => a.localeCompare(b))).toEqual(['auth', 'bff', 'lib']);
    act(() => result.current.toggleAll());
    expect(result.current.checked.size).toBe(5);
    act(() => result.current.setFilter('nada-casa'));
    expect(result.current.allChecked).toBe(false);
  });

  it('rótulos de idade e cor pelo tempo parado', () => {
    const now = Date.parse('2026-10-10T00:00:00Z');
    const ago = (d: number) => new Date(now - d * 24 * 3600 * 1000).toISOString();
    expect([null, ago(0), ago(1), ago(12), ago(100), ago(800)].map((d) => ageLabel(d, now))).toEqual([
      '—',
      'hoje',
      'há 1 dia',
      'há 12 dias',
      'há 3 meses',
      'há 2 anos',
    ]);
    expect([null, ago(10), ago(200), ago(400)].map((d) => idleClass(d, now))).toEqual(['muted', '', 'warn-text', 'bad-text']);
  });

  it('ordenação por colunas com nulos no fim', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    act(() => result.current.sortBy('name'));
    expect(result.current.sort).toEqual({ key: 'name', dir: 1 });
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0]!.name).toBeNull();
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['api', 'auth', 'bff', 'lib', 'web']);
    act(() => result.current.sortBy('name'));
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['web', 'lib', 'bff', 'auth', 'api']);
    act(() => result.current.sortBy('score'));
    expect(result.current.sort).toEqual({ key: 'score', dir: -1 });
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['api', 'auth', 'bff', 'web', 'lib']);
    act(() => result.current.sortBy('pushedAt'));
    expect(result.current.groups[0]!.repos.map((r) => r.name)).toEqual(['api', 'auth', 'bff', 'lib', 'web']);
    act(() => result.current.sortBy('system'));
    expect(result.current.sort).toEqual({ key: 'system', dir: 1 });
  });

  it('marcação de repositórios', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.visibleCount).toBe(5));
    act(() => result.current.toggleChecked('api'));
    act(() => result.current.toggleChecked('web'));
    expect(result.current.selectedRepos.map((r) => r.name)).toEqual(['api', 'web']);
    act(() => result.current.toggleChecked('api'));
    expect([...result.current.checked]).toEqual(['web']);
  });

  it('detalhe: seleciona, recarrega junto e fecha; erro vira toast', async () => {
    const repo = vi
      .spyOn(api, 'repo')
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ score: 3 }))
      .mockRejectedValueOnce(new Error('404'));
    const { result } = mount();
    await flush();
    act(() => result.current.select(1));
    expect(result.current.selectedId).toBe(1);
    await waitFor(() => expect(result.current.detail?.id).toBe(1));
    act(() => result.current.closeGenerate());
    await waitFor(() => expect(result.current.detail?.score).toBe(3));
    expect(repo).toHaveBeenCalledTimes(2);
    act(() => result.current.select(2));
    await waitFor(() => expect(toasts()).toEqual([['error', '404']]));
    act(() => result.current.closeDetail());
    expect(result.current).toMatchObject({ selectedId: null, detail: null });
  });

  it('acompanha a análise em andamento e recarrega documentos ao terminar', async () => {
    vi.useFakeTimers();
    const docsReload = vi.spyOn(DocsSync.getInstance(), 'reload').mockResolvedValue();
    vi.spyOn(api, 'repos').mockResolvedValue(repos);
    const state = vi
      .spyOn(api, 'state')
      .mockResolvedValueOnce({ ...idle, running: true })
      .mockResolvedValueOnce({ ...idle, queued: 1 })
      .mockResolvedValueOnce(idle);
    const { result } = renderHook(() => useReposViewModel());
    await flush();
    expect(result.current.state?.running).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(state).toHaveBeenCalledTimes(2);
    expect(docsReload).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(state).toHaveBeenCalledTimes(3);
    expect(docsReload).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(state).toHaveBeenCalledTimes(3);
  });

  it('erros na carga inicial e no polling viram toast', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'repos').mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('rede'));
    vi.spyOn(api, 'state').mockResolvedValue({ ...idle, running: true });
    renderHook(() => useReposViewModel());
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(toasts()).toEqual([['error', 'rede']]);
    vi.spyOn(api, 'repos').mockRejectedValueOnce(new Error('inicial'));
    renderHook(() => useReposViewModel());
    await flush();
    expect(toasts().at(-1)).toEqual(['error', 'inicial']);
  });

  it('sincronizar e analisar (todos ou marcados)', async () => {
    setPermissions('graph:write', 'settings:manage');
    const { result } = mount();
    await flush();
    expect(result.current).toMatchObject({ canRun: true, canConfigure: true });
    const sync = vi
      .spyOn(api, 'sync')
      .mockResolvedValueOnce([makeRepo(9)])
      .mockRejectedValueOnce(new Error('token'));
    await act(() => result.current.sync());
    expect(result.current.visibleCount).toBe(1);
    expect(toasts()).toEqual([['success', 'Lista de repositórios atualizada']]);
    await act(() => result.current.sync());
    expect(toasts().at(-1)).toEqual(['error', 'token']);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBe(false);

    const introspect = vi.spyOn(api, 'introspect').mockResolvedValue(idle);
    act(() => result.current.setForce(true));
    await act(() => result.current.introspect(false));
    expect(introspect).toHaveBeenLastCalledWith({ repos: undefined, force: true, depth: 'medium' });
    act(() => result.current.toggleChecked('api'));
    await act(() => result.current.introspect(true));
    expect(introspect).toHaveBeenLastCalledWith({ repos: ['api'], force: true, depth: 'medium' });
    expect(result.current.force).toBe(true);
  });

  it('aplicar proposta no grafo atual, abrir documento e configurações', async () => {
    vi.spyOn(GraphSync.getInstance(), 'reload').mockResolvedValue();
    useGraphStore.setState({ graphs: [makeGraphInfo(2, { name: 'Prod' })] });
    useUiStore.setState({ graphId: 2 });
    const apply = vi
      .spyOn(api, 'apply')
      .mockResolvedValueOnce({
        nodesCreated: 1,
        nodesUpdated: 0,
        interfacesCreated: 0,
        connectionsCreated: 0,
        connectionsUpdated: 0,
        callSitesCreated: 0,
        warnings: ['a', 'b'],
      })
      .mockResolvedValueOnce({
        nodesCreated: 0,
        nodesUpdated: 0,
        interfacesCreated: 0,
        connectionsCreated: 0,
        connectionsUpdated: 0,
        callSitesCreated: 0,
        warnings: [],
      })
      .mockRejectedValueOnce(new Error('conflito'));
    const { result } = mount();
    await flush();
    expect(result.current.currentGraphName).toBe('Prod');
    await act(() => result.current.apply());
    act(() => result.current.openDocument());
    expect(apply).not.toHaveBeenCalled();
    expect(useUiStore.getState().docViewer).toBeNull();

    vi.spyOn(api, 'repo').mockResolvedValue(detail());
    act(() => result.current.select(1));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    await act(() => result.current.apply());
    expect(apply).toHaveBeenCalledWith(1, 2);
    expect(toasts()).toEqual([
      ['success', 'Proposta aplicada no grafo “Prod”'],
      ['info', 'a; b'],
    ]);
    await act(() => result.current.apply());
    expect(toasts()).toHaveLength(3);
    await act(() => result.current.apply());
    expect(toasts().at(-1)).toEqual(['error', 'conflito']);

    act(() => result.current.openDocument());
    expect(useUiStore.getState().docViewer).toEqual({ documentId: 8 });
    act(() => result.current.openSettings());
    expect(useUiStore.getState()).toMatchObject({ screen: 'settings', settingsSection: 'github' });
    act(() => result.current.openGenerate());
    expect(result.current.generating).toBe(true);
    act(() => result.current.closeGenerate());
    expect(result.current.generating).toBe(false);
  });
});

describe('useGenerateGraphViewModel', () => {
  const llm = (configured: boolean) => vi.spyOn(DocumentApi.getInstance(), 'llm').mockResolvedValue({ configured, provider: 'anthropic', model: 'm' });

  it('nome padrão, avisos e habilitação do envio', async () => {
    vi.spyOn(DocumentApi.getInstance(), 'llm').mockRejectedValue(new Error('x'));
    const one = renderHook(() => useGenerateGraphViewModel([makeRepo(1, { name: 'api' })], vi.fn<() => void>()));
    expect(one.result.current.name).toBe('api');
    await waitFor(() => expect(one.result.current.llmConfigured).toBe(false));
    expect(one.result.current).toMatchObject({
      depth: 'medium',
      showLlmWarning: true,
      costWarning: null,
      canSubmit: true,
      busy: false,
      options: DEPTH_OPTIONS,
    });
    act(() => one.result.current.setDepth('full'));
    expect(one.result.current).toMatchObject({ costWarning: { title: 'Atenção: a geração completa consome muitos tokens.' }, canSubmit: false });
    expect(one.result.current.costWarning?.body).toContain('Com 1 repositório(s)');
    act(() => one.result.current.setAcknowledged(true));
    expect(one.result.current.canSubmit).toBe(true);
    act(() => one.result.current.setDepth('max'));
    expect(one.result.current.costWarning?.title).toBe('Atenção: a geração máxima é a mais cara e a mais demorada.');
    expect(one.result.current.costWarning?.body).toContain('todo o código');
    act(() => one.result.current.setDepth('fast'));
    expect(one.result.current.showLlmWarning).toBe(false);
    act(() => one.result.current.setName('  '));
    expect(one.result.current.canSubmit).toBe(false);
    const many = renderHook(() => useGenerateGraphViewModel([makeRepo(1), makeRepo(2)], vi.fn<() => void>()));
    expect(many.result.current.name).toBe('2 repositórios');
    expect(many.result.current.selectedNames).toEqual(['r1', 'r2']);
  });

  it('conta o que precisa ser analisado por profundidade', async () => {
    llm(true);
    const selected = [
      makeRepo(1, { analysisDepth: null }),
      makeRepo(2, { analysisDepth: 'fast' }),
      makeRepo(3, { analysisDepth: 'medium' }),
      makeRepo(4, { analysisDepth: 'full', stale: true }),
      makeRepo(5, { analysisDepth: 'full' }),
    ];
    const { result } = renderHook(() => useGenerateGraphViewModel(selected, vi.fn<() => void>()));
    await waitFor(() => expect(result.current.llmConfigured).toBe(true));
    expect(result.current.pendingCount).toBe(3);
    act(() => result.current.setDepth('full'));
    expect(result.current.pendingCount).toBe(4);
    act(() => result.current.setDepth('fast'));
    expect(result.current.pendingCount).toBe(0);
  });

  it('envio inválido mostra o erro', async () => {
    llm(true);
    const { result } = renderHook(() => useGenerateGraphViewModel([makeRepo(1)], vi.fn<() => void>()));
    act(() => result.current.setName(''));
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.error).toBe('Obrigatório'));
  });

  it('sem análise pendente: gera, abre o grafo e fecha', async () => {
    llm(true);
    const onClose = vi.fn<() => void>();
    const fromRepos = vi.spyOn(GraphApi.getInstance(), 'fromRepos').mockResolvedValue(makeGraphInfo(7, { name: 'G', nodeCount: 4 }));
    // Abrir o grafo carrega os nós: 1 > 2 > 3 (folha).
    const open = vi.spyOn(GraphSync.getInstance(), 'open').mockImplementation(async () => {
      seedGraph({ nodes: [makeNode(1), makeNode(2, 1), makeNode(3, 2)] });
    });
    useUiStore.setState({ screen: 'repos' });
    const { result } = renderHook(() => useGenerateGraphViewModel([makeRepo(1, { name: 'api', analysisDepth: 'medium' })], onClose));
    act(() => result.current.submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fromRepos).toHaveBeenCalledWith({ name: 'api', depth: 'medium', repoIds: [1] });
    expect(open).toHaveBeenCalledWith(7);
    expect(toasts()).toEqual([['success', 'Grafo “G” criado com 4 nós']]);
    expect(useUiStore.getState().screen).toBe('graph');
    // Abre expandido (só quem tem filhos).
    expect([...useUiStore.getState().expanded].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('analisa o que falta, acompanha a fila e gera', async () => {
    vi.useFakeTimers();
    llm(true);
    const introspect = vi.spyOn(api, 'introspect').mockResolvedValue(idle);
    vi.spyOn(api, 'repos')
      .mockResolvedValueOnce([makeRepo(1, { name: 'a', status: 'running' }), makeRepo(2, { name: 'b', status: 'done' }), makeRepo(3, { name: 'x' })])
      .mockResolvedValueOnce([makeRepo(1, { name: 'a', status: 'done', error: 'LLM falhou (sem crédito)' }), makeRepo(2, { name: 'b', status: 'done' })]);
    const started = new Date(Date.now() - 65_000).toISOString();
    vi.spyOn(api, 'state').mockResolvedValue({
      ...idle,
      running: true,
      progress: [
        { repo: 'a', depth: 'medium', stage: 'analyzing', done: null, total: null, startedAt: started, stageStartedAt: started },
        { repo: 'outro', depth: 'medium', stage: 'collecting', done: null, total: null, startedAt: started, stageStartedAt: started },
      ],
    });
    vi.spyOn(GraphApi.getInstance(), 'fromRepos').mockResolvedValue(makeGraphInfo(7));
    vi.spyOn(GraphSync.getInstance(), 'open').mockResolvedValue();
    const onClose = vi.fn<() => void>();
    const { result } = renderHook(() => useGenerateGraphViewModel([makeRepo(1, { name: 'a' }), makeRepo(2, { name: 'b' })], onClose));
    act(() => result.current.submit());
    await flush();
    expect(introspect).toHaveBeenCalledWith({ repos: ['a', 'b'], depth: 'medium', force: false });
    expect(result.current.phase).toEqual({ type: 'analyzing', done: 0, total: 2, progress: [] });
    expect(result.current.busy).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2500));
    // Só o progresso dos repositórios pedidos.
    expect(result.current.phase).toEqual({
      type: 'analyzing',
      done: 1,
      total: 2,
      progress: [{ repo: 'a', label: 'Etapa 2 de 3 · Analisando com o LLM', counter: null, percent: null, elapsed: expect.stringMatching(/^1:0\d$/) }],
    });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(onClose).toHaveBeenCalled();
    // Concluído com aviso vira toast informativo.
    expect(toasts()).toContainEqual(['info', 'a: LLM falhou (sem crédito)']);
  });

  it('falhas na análise e na geração voltam ao formulário', async () => {
    vi.useFakeTimers();
    llm(true);
    vi.spyOn(api, 'introspect').mockResolvedValue(idle);
    vi.spyOn(api, 'repos').mockResolvedValue([makeRepo(1, { name: 'a', status: 'error', error: 'boom' }), makeRepo(2, { name: 'b', status: 'error' })]);
    vi.spyOn(api, 'state').mockResolvedValue(idle);
    const { result } = renderHook(() => useGenerateGraphViewModel([makeRepo(1, { name: 'a' }), makeRepo(2, { name: 'b' })], vi.fn<() => void>()));
    act(() => result.current.submit());
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(result.current.error).toBe('Falha ao analisar: a (boom); b (erro)');
    expect(result.current.phase).toEqual({ type: 'form' });

    vi.spyOn(GraphApi.getInstance(), 'fromRepos').mockRejectedValue(new Error('limite'));
    act(() => result.current.setDepth('fast'));
    act(() => result.current.submit());
    await flush();
    expect(result.current.error).toBe('limite');
  });

  it('fechar durante a análise cancela a espera', async () => {
    vi.useFakeTimers();
    llm(true);
    vi.spyOn(api, 'introspect').mockResolvedValue(idle);
    vi.spyOn(api, 'repos').mockResolvedValue([makeRepo(1, { name: 'a', status: 'running' })]);
    vi.spyOn(api, 'state').mockResolvedValue(idle);
    const onClose = vi.fn<() => void>();
    const { result } = renderHook(() => useGenerateGraphViewModel([makeRepo(1, { name: 'a' })], onClose));
    act(() => result.current.submit());
    await flush();
    act(() => result.current.close());
    expect(onClose).toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(result.current.error).toBe('Cancelado');
  });
});
