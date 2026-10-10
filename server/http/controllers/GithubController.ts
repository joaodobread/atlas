import {
  applyProposalSchema,
  idParamSchema,
  ingestMetricsSchema,
  repoKeySchema,
  runIntrospectionSchema,
  updateGithubSettingsSchema,
} from '../../../shared/schemas.ts';
import type { IGithubSettingsService, IIntrospectionService, IMetricsService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, ok, type HttpResponse } from '../HttpResponse.ts';

export class GithubController {
  constructor(
    private readonly settings: IGithubSettingsService,
    private readonly introspection: IIntrospectionService,
    private readonly metrics: IMetricsService,
  ) {}

  async getSettings(): Promise<HttpResponse> {
    return ok(await this.settings.view());
  }

  async updateSettings(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.settings.update(updateGithubSettingsSchema.parse(req.body)));
  }

  async testSettings(): Promise<HttpResponse> {
    return ok(await this.settings.test());
  }

  async list(): Promise<HttpResponse> {
    return ok(await this.introspection.list());
  }

  async sync(): Promise<HttpResponse> {
    return ok(await this.introspection.sync());
  }

  async run(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.introspection.run(runIntrospectionSchema.parse(req.body ?? {})));
  }

  async state(): Promise<HttpResponse> {
    return ok(this.introspection.state());
  }

  async show(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.introspection.get(idParamSchema.parse(req.params.id)));
  }

  async apply(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.introspection.apply(idParamSchema.parse(req.params.id), applyProposalSchema.parse(req.body).graphId));
  }

  /** Chamado pelo workflow do GitHub (token de API com metrics:write). */
  async ingestMetrics(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.metrics.ingest(ingestMetricsSchema.parse(req.body)));
  }

  async metricsHistory(req: HttpRequest): Promise<HttpResponse> {
    const { owner, repo } = repoKeySchema.parse(req.params);
    return ok(await this.metrics.history(owner, repo));
  }
}
