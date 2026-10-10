import { askSchema, searchQuerySchema } from '../../../shared/schemas.ts';
import type { IEmbeddingIndexer, ILlmMentionExtractor, IRagService, ISearchService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { ok, type HttpResponse } from '../HttpResponse.ts';

export class SearchController {
  constructor(
    private readonly searchService: ISearchService,
    private readonly rag: IRagService,
    private readonly indexer: IEmbeddingIndexer,
    private readonly mentions: ILlmMentionExtractor,
  ) {}

  async search(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.searchService.search(searchQuerySchema.parse(req.query)));
  }

  async ask(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.rag.ask(askSchema.parse(req.body)));
  }

  async status(): Promise<HttpResponse> {
    return ok({ ...(await this.indexer.status()), llmMentions: await this.mentions.status() });
  }

  async reprocessMentions(): Promise<HttpResponse> {
    await this.mentions.reprocessAll();
    return ok({ ...(await this.indexer.status()), llmMentions: await this.mentions.status() });
  }

  async llm(): Promise<HttpResponse> {
    return ok(this.rag.info());
  }
}
