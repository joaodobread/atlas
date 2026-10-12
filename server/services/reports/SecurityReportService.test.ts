import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoIntrospectionDetail, RepoMetricsSnapshot } from '../../../shared/types.ts';
import { makeFacts } from '../../../test/support/githubFakes.ts';
import { exemplaryFacts, exemplaryMetrics, postureInput } from '../../../test/support/securityFakes.ts';
import { BusinessRuleError, NotFoundError } from '../../core/errors/AppError.ts';
import type { ILlmProvider, JsonOutputSpec, LlmRequest } from '../../infra/llm/ILlmProvider.ts';
import type { IRepoIntrospectionRepository } from '../../repositories/contracts/IRepoIntrospectionRepository.ts';
import type { IRepoMetricsRepository } from '../../repositories/contracts/IRepoMetricsRepository.ts';
import type { ISecurityReportRepository, NewSecurityReport } from '../../repositories/contracts/ISecurityReportRepository.ts';
import type { IGithubSettingsService } from '../contracts/index.ts';
import { SecurityPostureBuilder } from './SecurityPosture.ts';
import { SecurityReportService } from './SecurityReportService.ts';

type Detail = Omit<RepoIntrospectionDetail, 'metrics' | 'history'>;

const detail = (name: string, over: Partial<Detail> = {}): Detail => {
  const input = postureInput(exemplaryFacts(), exemplaryMetrics(), { name });
  return {
    id: name.length,
    owner: 'Acme',
    name,
    htmlUrl: input.htmlUrl,
    analyzedAt: input.analyzedAt,
    archived: false,
    facts: input.facts,
    quality: input.quality,
    analysis: { purpose: 'API' },
    ...over,
  } as Detail;
};

class FakeLlm implements ILlmProvider {
  readonly provider = 'anthropic' as const;
  model: string | null = 'claude-x';
  configured = true;
  requests: LlmRequest[] = [];
  answer: unknown = { summary: 'Resumo do LLM', highlights: [], risks: [], roadmap: [] };
  fail: unknown = null;
  async complete(): Promise<string> {
    return '';
  }
  async completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    this.requests.push(request);
    if (this.fail) throw this.fail;
    return spec.parse(this.answer);
  }
}

describe('SecurityReportService', () => {
  let details: Detail[];
  let metrics: Map<string, RepoMetricsSnapshot>;
  let saved: NewSecurityReport[];
  let llm: FakeLlm;
  let owner: string | null;
  let service: SecurityReportService;

  beforeEach(() => {
    details = [detail('api'), detail('web'), detail('old', { archived: true }), detail('new', { facts: null, quality: null })];
    metrics = new Map([['api', exemplaryMetrics()]]);
    saved = [];
    llm = new FakeLlm();
    owner = 'Acme';
    const repos = {
      listDetails: async () => details,
      findByName: async (_o: string, n: string) => details.find((d) => d.name.toLowerCase() === n.toLowerCase()) ?? null,
    } as Partial<IRepoIntrospectionRepository> as IRepoIntrospectionRepository;
    const metricsRepo = { latest: async (_o: string, n: string) => metrics.get(n) ?? null } as Partial<IRepoMetricsRepository> as IRepoMetricsRepository;
    const reports: ISecurityReportRepository = {
      insert: async (r: NewSecurityReport) => {
        saved.push(r);
        return { ...r, id: saved.length, createdBy: r.createdBy ? 'Ana' : null, createdAt: 'agora' };
      },
      list: async (scope: string) => saved.filter((r) => r.scope === scope).map((r, i) => ({ ...r, id: i + 1, createdBy: null, createdAt: 'x' })),
    };
    const settings = {
      require: async () => {
        if (!owner) throw new BusinessRuleError('sem GitHub');
        return { owner, token: 't' };
      },
    } as unknown as IGithubSettingsService;
    service = new SecurityReportService(repos, metricsRepo, reports, settings, llm, new SecurityPostureBuilder());
  });

  it('portfólio: ignora arquivados e conta os não analisados', async () => {
    const v = await service.portfolio();
    expect(v.posture).toMatchObject({ repos: 3, analyzed: 2 });
    expect(v.posture.rows.map((r) => r.name).toSorted()).toEqual(['api', 'web']);
    expect(v.llm).toEqual({ configured: true, model: 'claude-x' });
    expect(v.reports).toEqual([]);
  });

  it('portfólio sem GitHub configurado fica vazio', async () => {
    owner = null;
    expect((await service.portfolio()).posture).toMatchObject({ repos: 0, analyzed: 0 });
    await expect(service.generate({ kind: 'report' }, null)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('repositório: postura (null sem análise) e histórico pelo escopo em minúsculas', async () => {
    const v = await service.repo('acme', 'API');
    expect(v.posture).toMatchObject({ owner: 'Acme', name: 'api', metricsAt: '2026-01-01T00:00:00Z' });
    expect((await service.repo('acme', 'new')).posture).toBeNull();
    await expect(service.repo('acme', 'nada')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('gera o relatório do repositório com o LLM (segredos redigidos) e guarda o momento da postura', async () => {
    details[0] = { ...details[0], analysis: { ...details[0].analysis!, purpose: 'usa token ghp_abcdefghijklmnopqrstuvwxyz0123' } };
    const r = await service.generate({ owner: 'acme', repo: 'api', kind: 'report', focus: '' }, 7);
    expect(r).toMatchObject({ scope: 'acme/api', kind: 'report', method: 'llm', model: 'claude-x', llmError: null, focus: null, createdBy: 'Ana', tips: null });
    expect(r.narrative?.summary).toBe('Resumo do LLM');
    expect(r.risk).toBe('low');
    expect(r.level).toBe(4);
    expect(llm.requests[0].messages[0].content).toContain('Repositório: Acme/api');
    expect(llm.requests[0].messages[0].content).not.toContain('ghp_');
    expect((await service.repo('acme', 'api')).reports).toHaveLength(1);
  });

  it('dicas do repositório com foco', async () => {
    llm.answer = { tips: [{ title: 'Fixe as actions', axis: 'supplyChain', why: 'w', how: 'h', effort: 'low' }] };
    const r = await service.generate({ owner: 'acme', repo: 'api', kind: 'tips', focus: 'pipeline' }, null);
    expect(r).toMatchObject({ kind: 'tips', focus: 'pipeline', narrative: null, tips: [{ title: 'Fixe as actions' }] });
    expect(llm.requests[0].system).toContain('dicas práticas');
    expect(llm.requests[0].messages[0].content).toContain('Foco pedido pelo usuário: pipeline');
  });

  it('LLM falhando cai na heurística e registra o erro', async () => {
    llm.fail = new Error('limite de taxa');
    const r = await service.generate({ owner: 'acme', repo: 'api', kind: 'report' }, null);
    expect(r).toMatchObject({ method: 'heuristic', model: null, llmError: 'limite de taxa' });
    expect(r.narrative?.summary).toContain('Acme/api');
    llm.fail = 'texto';
    const t = await service.generate({ owner: 'acme', repo: 'api', kind: 'tips' }, null);
    expect(t).toMatchObject({ method: 'heuristic', llmError: 'texto', narrative: null });
    expect(Array.isArray(t.tips)).toBe(true);
  });

  it('resposta inválida do LLM também cai na heurística', async () => {
    llm.answer = { summary: '' };
    expect(await service.generate({ owner: 'acme', repo: 'api', kind: 'report' }, null)).toMatchObject({ method: 'heuristic' });
  });

  it('sem LLM configurado usa a heurística direto', async () => {
    llm.configured = false;
    const r = await service.generate({ kind: 'report' }, null);
    expect(r).toMatchObject({ scope: '*', method: 'heuristic', llmError: null, level: null });
    expect(r.narrative?.summary).toContain('2 de 3 repositório(s)');
    const t = await service.generate({ kind: 'tips', focus: 'x' }, null);
    expect(t).toMatchObject({ scope: '*', kind: 'tips' });
    expect(llm.requests).toEqual([]);
  });

  it('portfólio com o LLM', async () => {
    const r = await service.generate({ kind: 'report' }, null);
    expect(r).toMatchObject({ scope: '*', method: 'llm' });
    expect(llm.requests[0].messages[0].content).toContain('## Adoção das práticas');
    expect((await service.portfolio()).reports).toHaveLength(1);
  });

  it('exige repositório existente e analisado; portfólio exige ao menos um analisado', async () => {
    await expect(service.generate({ owner: 'acme', repo: 'nada', kind: 'report' }, null)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.generate({ owner: 'acme', repo: 'new', kind: 'report' }, null)).rejects.toThrow('Analise o repositório');
    details = [detail('x', { facts: null, quality: null }), detail('y', { facts: makeFacts(), quality: null })];
    await expect(service.generate({ kind: 'report' }, null)).rejects.toThrow('Nenhum repositório analisado');
  });
});
