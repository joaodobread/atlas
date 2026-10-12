import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioRepoRow, SecurityPortfolioView, SecurityReportRecord, SecurityRepoView } from '../../shared/types.ts';
import { ReportApi } from '../data/api/ReportApi.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { resetStores, setPermissions, toasts } from '../testing/vmFixtures.ts';
import { useSecurityReportViewModel } from './useSecurityReportViewModel.ts';

const flush = () => act(async () => {});
let api: ReportApi;

const row = (name: string, risk: PortfolioRepoRow['risk'], score: number | null): PortfolioRepoRow => ({
  owner: 'acme',
  name,
  score,
  risk,
  level: 1,
  axes: { vulnerabilities: null, pipeline: null, supplyChain: null, governance: null },
  critical: 0,
  high: 0,
  vulnerableDependencies: null,
  reasons: [],
});

const record = (id: number, o: Partial<SecurityReportRecord> = {}): SecurityReportRecord => ({
  id,
  scope: '*',
  kind: 'report',
  focus: null,
  method: 'llm',
  model: 'm',
  llmError: null,
  score: 50,
  risk: 'high',
  level: null,
  narrative: { summary: `r${id}`, highlights: [], risks: [], roadmap: [] },
  tips: null,
  createdBy: null,
  createdAt: '2026-10-12T10:00:00Z',
  ...o,
});

const portfolio = (reports: SecurityReportRecord[] = []): SecurityPortfolioView => ({
  posture: {
    repos: 3,
    analyzed: 3,
    score: 60,
    axes: { vulnerabilities: 50, pipeline: 60, supplyChain: 70, governance: 80 },
    byRisk: { critical: 1, high: 1, medium: 0, low: 1 },
    byLevel: [1, 1, 1, 0, 0],
    findings: { critical: 1, high: 0, medium: 0, low: 0 },
    vulnerableDependencies: 0,
    adoption: [],
    rows: [row('web', 'high', 40), row('lib', 'low', 90), row('api', 'critical', null), row('bff', 'high', null)],
  },
  reports,
  llm: { configured: true, model: 'm' },
});

const repoView = (reports: SecurityReportRecord[] = []): SecurityRepoView => ({ posture: null, reports, llm: { configured: false, model: null } });

beforeEach(() => {
  resetStores();
  api = ReportApi.getInstance();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useSecurityReportViewModel', () => {
  it('portfólio: carrega, ordena por risco e nota, filtra por texto e risco', async () => {
    vi.spyOn(api, 'securityPortfolio').mockResolvedValue(portfolio());
    const { result } = renderHook(() => useSecurityReportViewModel());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.portfolio?.analyzed).toBe(3);
    expect(result.current.rows.map((r) => r.name)).toEqual(['api', 'web', 'bff', 'lib']);
    act(() => result.current.setRisk('high'));
    expect(result.current.rows.map((r) => r.name)).toEqual(['web', 'bff']);
    act(() => result.current.setFilter('WE'));
    expect(result.current.rows.map((r) => r.name)).toEqual(['web']);
    expect(result.current.llm).toEqual({ configured: true, model: 'm' });
    expect(result.current.scope).toBeNull();
    expect(result.current.labels.risk.critical).toBe('Crítico');
    expect(result.current.band(80)).toBe('good');
    expect(result.current.pct(1, 2)).toBe(50);
    expect(result.current.when('x')).toBe('x');
  });

  it('erro ao carregar e recarregar', async () => {
    const get = vi.spyOn(api, 'securityPortfolio').mockRejectedValueOnce(new Error('fora do ar')).mockResolvedValueOnce(portfolio());
    const { result } = renderHook(() => useSecurityReportViewModel());
    await waitFor(() => expect(result.current.error).toBe('fora do ar'));
    act(() => result.current.reload());
    // O erro some logo no início do recarregamento; espera os dados chegarem.
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('repositório: mais recentes por tipo, histórico escolhido e navegação', async () => {
    useUiStore.setState({ securityScope: { owner: 'acme', name: 'api' } });
    const tips = record(3, { kind: 'tips', narrative: null, tips: [] });
    const get = vi.spyOn(api, 'securityRepo').mockResolvedValue(repoView([tips, record(2), record(1)]));
    const { result } = renderHook(() => useSecurityReportViewModel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledWith('acme', 'api');
    expect(result.current.report?.id).toBe(2);
    expect(result.current.tips?.id).toBe(3);
    expect(result.current.posture).toBeNull();
    expect(result.current.portfolio).toBeNull();
    act(() => result.current.pick(1));
    expect(result.current.report?.id).toBe(1);
    expect(result.current.tips?.id).toBe(3);
    act(() => result.current.pick(3));
    expect(result.current.report?.id).toBe(2);
    act(() => result.current.pick(null));
    expect(result.current.pickedId).toBeNull();

    act(() => result.current.openRepos());
    expect(useUiStore.getState().screen).toBe('repos');
    act(() => result.current.openRepo('acme', 'web'));
    expect(useUiStore.getState()).toMatchObject({ screen: 'security', securityScope: { owner: 'acme', name: 'web' } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('acme', 'web'));
    vi.spyOn(api, 'securityPortfolio').mockResolvedValue(portfolio());
    act(() => result.current.back());
    await waitFor(() => expect(result.current.portfolio).not.toBeNull());
    expect(result.current.scope).toBeNull();
  });

  it('ignora a resposta de um escopo que já foi trocado', async () => {
    let resolveRepo: (v: SecurityRepoView) => void = () => undefined;
    vi.spyOn(api, 'securityRepo')
      .mockImplementationOnce(() => new Promise((r) => (resolveRepo = r)))
      .mockReturnValue(new Promise(() => undefined));
    let rejectRepo: (e: Error) => void = () => undefined;
    vi.spyOn(api, 'securityPortfolio').mockImplementationOnce(() => new Promise((_, r) => (rejectRepo = r)));
    useUiStore.setState({ securityScope: { owner: 'acme', name: 'api' } });
    const { result } = renderHook(() => useSecurityReportViewModel());
    act(() => useUiStore.getState().showSecurity(null));
    await act(async () => resolveRepo(repoView([record(9)])));
    expect(result.current.reports).toEqual([]);
    act(() => useUiStore.getState().showSecurity({ owner: 'acme', name: 'x' }));
    await act(async () => rejectRepo(new Error('tarde')));
    expect(result.current.error).toBeNull();
  });

  it('gera relatório/dicas com foco, avisa quando o LLM falhou e trata erro', async () => {
    setPermissions('graph:write');
    useUiStore.setState({ securityScope: { owner: 'acme', name: 'api' } });
    vi.spyOn(api, 'securityRepo').mockResolvedValue(repoView());
    const gen = vi
      .spyOn(api, 'generateSecurity')
      .mockResolvedValueOnce(record(1))
      .mockResolvedValueOnce(record(2, { kind: 'tips', llmError: 'timeout' }))
      .mockRejectedValueOnce(new Error('Analise o repositório antes'));
    const { result } = renderHook(() => useSecurityReportViewModel());
    await flush();
    expect(result.current.canGenerate).toBe(true);
    act(() => result.current.setFocus('  pipeline  '));
    act(() => result.current.generate('report'));
    expect(result.current.generating).toBe('report');
    await waitFor(() => expect(result.current.generating).toBeNull());
    expect(gen).toHaveBeenLastCalledWith({ owner: 'acme', repo: 'api', kind: 'report', focus: 'pipeline' });
    act(() => result.current.setFocus(''));
    act(() => result.current.generate('tips'));
    await waitFor(() => expect(result.current.generating).toBeNull());
    expect(gen).toHaveBeenLastCalledWith({ owner: 'acme', repo: 'api', kind: 'tips' });
    act(() => result.current.generate('report'));
    await waitFor(() => expect(result.current.generating).toBeNull());
    expect(toasts()).toEqual([
      ['success', 'Relatório gerado.'],
      ['error', 'O LLM falhou (timeout); o conteúdo foi gerado pela heurística.'],
      ['error', 'Analise o repositório antes'],
    ]);
  });

  it('portfólio: gera sem owner/repo e dicas viram toast próprio', async () => {
    vi.spyOn(api, 'securityPortfolio').mockResolvedValue(portfolio());
    const gen = vi.spyOn(api, 'generateSecurity').mockResolvedValue(record(1, { kind: 'tips' }));
    const { result } = renderHook(() => useSecurityReportViewModel());
    await flush();
    expect(result.current.canGenerate).toBe(false);
    act(() => result.current.generate('tips'));
    await waitFor(() => expect(toasts()).toEqual([['success', 'Dicas geradas.']]));
    expect(gen).toHaveBeenCalledWith({ kind: 'tips' });
  });

  it('exporta Markdown do portfólio e do repositório e imprime', async () => {
    const create = vi.fn<(obj: Blob) => string>(() => 'blob:x');
    const revoke = vi.fn<(url: string) => void>();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this);
    });
    const print = vi.fn<() => void>();
    vi.stubGlobal('print', print);
    vi.spyOn(api, 'securityPortfolio').mockResolvedValue(portfolio([record(1)]));
    vi.spyOn(api, 'securityRepo').mockResolvedValue(repoView());
    const { result } = renderHook(() => useSecurityReportViewModel());
    await waitFor(() => expect(result.current.portfolio).not.toBeNull());
    act(() => result.current.exportMarkdown());
    expect(await create.mock.calls[0]![0].text()).toContain('# Relatório de segurança — portfólio');
    expect(anchors[0]!.download).toMatch(/^seguranca-portfolio-\d{4}-\d{2}-\d{2}\.md$/);
    expect(revoke).toHaveBeenCalledWith('blob:x');
    act(() => result.current.openRepo('acme', 'api'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.exportMarkdown());
    expect(anchors[1]!.download).toMatch(/^seguranca-acme-api-/);
    act(() => result.current.print());
    expect(print).toHaveBeenCalled();
  });
});
