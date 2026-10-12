import type { GenerateSecurityReportInput } from '../../../shared/schemas.ts';
import { securityNarrativeSchema, securityTipsSchema } from '../../../shared/schemas.ts';
import type {
  RepoIntrospectionDetail,
  SecurityNarrative,
  SecurityPortfolioView,
  SecurityPosture,
  SecurityReportRecord,
  SecurityRepoView,
  SecurityTip,
} from '../../../shared/types.ts';
import { BusinessRuleError, NotFoundError } from '../../core/errors/AppError.ts';
import type { ILlmProvider } from '../../infra/llm/ILlmProvider.ts';
import type { IRepoIntrospectionRepository } from '../../repositories/contracts/IRepoIntrospectionRepository.ts';
import type { IRepoMetricsRepository } from '../../repositories/contracts/IRepoMetricsRepository.ts';
import type { ISecurityReportRepository } from '../../repositories/contracts/ISecurityReportRepository.ts';
import type { IGithubSettingsService, ISecurityReportService } from '../contracts/index.ts';
import { redactSecrets } from '../github/redactSecrets.ts';
import type { SecurityPostureBuilder } from './SecurityPosture.ts';
import {
  heuristicNarrative,
  heuristicPortfolioNarrative,
  heuristicTips,
  NARRATIVE_JSON_SCHEMA,
  portfolioPrompt,
  posturePrompt,
  SECURITY_SYSTEM,
  TIPS_JSON_SCHEMA,
  TIPS_SYSTEM,
} from './securityNarrative.ts';

const HISTORY_LIMIT = 20;
const PORTFOLIO = '*';

type Detail = Omit<RepoIntrospectionDetail, 'metrics' | 'history'>;
type Analyzed = Detail & { facts: NonNullable<Detail['facts']>; quality: NonNullable<Detail['quality']> };

const scopeOf = (owner: string, name: string) => `${owner}/${name}`.toLowerCase();
const analyzed = (d: Detail): d is Analyzed => d.facts != null && d.quality != null;

/**
 * Relatório de segurança/DevSecOps: postura calculada (4 eixos, maturidade, risco) e, sob demanda,
 * o relatório escrito e dicas gerados pelo LLM, guardados com histórico.
 */
export class SecurityReportService implements ISecurityReportService {
  constructor(
    private readonly repos: IRepoIntrospectionRepository,
    private readonly metrics: IRepoMetricsRepository,
    private readonly reports: ISecurityReportRepository,
    private readonly settings: IGithubSettingsService,
    private readonly llm: ILlmProvider,
    private readonly builder: SecurityPostureBuilder,
  ) {}

  async portfolio(): Promise<SecurityPortfolioView> {
    const { postures, total } = await this.allPostures();
    return { posture: this.builder.portfolio(postures, total), reports: await this.reports.list(PORTFOLIO, HISTORY_LIMIT), llm: this.llmInfo() };
  }

  async repo(owner: string, name: string): Promise<SecurityRepoView> {
    const d = await this.repos.findByName(owner, name);
    if (!d) throw new NotFoundError(`Repositório ${owner}/${name} não encontrado`);
    return {
      posture: analyzed(d) ? await this.postureOf(d) : null,
      reports: await this.reports.list(scopeOf(d.owner, d.name), HISTORY_LIMIT),
      llm: this.llmInfo(),
    };
  }

  async generate(input: GenerateSecurityReportInput, userId: number | null): Promise<SecurityReportRecord> {
    const focus = input.focus || null;
    let scope: string;
    let postures: SecurityPosture[];
    let prompt: string;
    let fallback: () => SecurityNarrative | SecurityTip[];
    let snapshot: Pick<SecurityReportRecord, 'score' | 'risk' | 'level'>;

    if (input.owner && input.repo) {
      const d = await this.repos.findByName(input.owner, input.repo);
      if (!d) throw new NotFoundError(`Repositório ${input.owner}/${input.repo} não encontrado`);
      if (!analyzed(d)) throw new BusinessRuleError('Analise o repositório antes de gerar o relatório de segurança.');
      const p = await this.postureOf(d);
      scope = scopeOf(d.owner, d.name);
      postures = [p];
      prompt = posturePrompt(p, d.facts, d.analysis, focus);
      fallback = () => (input.kind === 'tips' ? heuristicTips(postures, focus) : heuristicNarrative(p));
      snapshot = { score: p.score, risk: p.risk, level: p.maturity.level };
    } else {
      const all = await this.allPostures();
      if (!all.postures.length) throw new BusinessRuleError('Nenhum repositório analisado ainda: analise os repositórios antes de gerar o relatório.');
      const pp = this.builder.portfolio(all.postures, all.total);
      scope = PORTFOLIO;
      postures = all.postures;
      prompt = portfolioPrompt(pp, postures, focus);
      fallback = () => (input.kind === 'tips' ? heuristicTips(postures, focus) : heuristicPortfolioNarrative(pp, postures));
      snapshot = { score: pp.score, risk: pp.rows[0]?.risk ?? null, level: null };
    }

    let content: SecurityNarrative | SecurityTip[];
    let method: SecurityReportRecord['method'] = 'heuristic';
    let llmError: string | null = null;
    if (this.llm.configured) {
      try {
        const request = {
          system: input.kind === 'tips' ? TIPS_SYSTEM : SECURITY_SYSTEM,
          messages: [{ role: 'user' as const, content: redactSecrets(prompt) }],
          maxTokens: 8000,
        };
        content =
          input.kind === 'tips'
            ? (await this.llm.completeJson(request, { name: 'security_tips', schema: TIPS_JSON_SCHEMA, parse: (v) => securityTipsSchema.parse(v) })).tips
            : await this.llm.completeJson(request, { name: 'security_report', schema: NARRATIVE_JSON_SCHEMA, parse: (v) => securityNarrativeSchema.parse(v) });
        method = 'llm';
      } catch (err) {
        llmError = err instanceof Error ? err.message : String(err);
        content = fallback();
      }
    } else content = fallback();

    return await this.reports.insert({
      scope,
      kind: input.kind,
      focus,
      method,
      model: method === 'llm' ? this.llm.model : null,
      llmError,
      ...snapshot,
      narrative: Array.isArray(content) ? null : content,
      tips: Array.isArray(content) ? content : null,
      createdBy: userId,
    });
  }

  private llmInfo() {
    return { configured: this.llm.configured, model: this.llm.model };
  }

  private async postureOf(d: Analyzed): Promise<SecurityPosture> {
    return this.builder.build({
      owner: d.owner,
      name: d.name,
      htmlUrl: d.htmlUrl,
      analyzedAt: d.analyzedAt,
      facts: d.facts,
      quality: d.quality,
      metrics: await this.metrics.latest(d.owner, d.name),
    });
  }

  /** Repositórios arquivados ficam fora do consolidado. */
  private async allPostures(): Promise<{ postures: SecurityPosture[]; total: number }> {
    let owner: string;
    try {
      owner = (await this.settings.require()).owner;
    } catch {
      return { postures: [], total: 0 };
    }
    const list = (await this.repos.listDetails(owner)).filter((d) => !d.archived);
    return { postures: await Promise.all(list.filter(analyzed).map((d) => this.postureOf(d))), total: list.length };
  }
}
