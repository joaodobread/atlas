import { createGraphSchema, exchangeDocumentSchema, graphFromReposSchema, idParamSchema, updateGraphSchema } from '../../../shared/schemas.ts';
import type { IExchangeService, IGraphService, IGraphsService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, noContent, ok, type HttpResponse } from '../HttpResponse.ts';

export class GraphController {
  constructor(
    private readonly graph: IGraphService,
    private readonly graphs: IGraphsService,
    private readonly exchange: IExchangeService,
  ) {}

  async list(): Promise<HttpResponse> {
    return ok(await this.graphs.list());
  }

  async create(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.graphs.create(createGraphSchema.parse(req.body)));
  }

  async update(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.graphs.update(idParamSchema.parse(req.params.id), updateGraphSchema.parse(req.body)));
  }

  async destroy(req: HttpRequest): Promise<HttpResponse> {
    await this.graphs.delete(idParamSchema.parse(req.params.id));
    return noContent();
  }

  async fromRepos(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.graphs.generateFromRepos(graphFromReposSchema.parse(req.body)));
  }

  /** Dados de um grafo (nós, interfaces, conexões, locais). */
  async show(req: HttpRequest): Promise<HttpResponse> {
    const id = idParamSchema.parse(req.params.id);
    await this.graphs.get(id);
    return ok(await this.graph.getGraph(id));
  }

  async export(req: HttpRequest): Promise<HttpResponse> {
    const id = idParamSchema.parse(req.params.id);
    await this.graphs.get(id);
    return ok(await this.exchange.exportDocument(id));
  }

  async import(req: HttpRequest): Promise<HttpResponse> {
    const id = idParamSchema.parse(req.params.id);
    await this.graphs.get(id);
    return ok(await this.exchange.importDocument(exchangeDocumentSchema.parse(req.body), id));
  }
}
