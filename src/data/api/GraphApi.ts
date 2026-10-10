import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { GraphData, GraphInfo, ImportResult } from '../../../shared/types.ts';
import type { CreateGraphInput, ExchangeDocument, ExchangeDocumentInput, GraphFromReposInput, UpdateGraphInput } from '../../../shared/schemas.ts';

export class GraphApi {
  private static instance: GraphApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): GraphApi {
    return (GraphApi.instance ??= new GraphApi(http));
  }

  list(): Promise<GraphInfo[]> {
    return this.http.get<GraphInfo[]>('/graphs');
  }

  load(graphId: number): Promise<GraphData> {
    return this.http.get<GraphData>(`/graphs/${graphId}`);
  }

  create(input: CreateGraphInput): Promise<GraphInfo> {
    return this.http.post<GraphInfo>('/graphs', input);
  }

  update(graphId: number, input: UpdateGraphInput): Promise<GraphInfo> {
    return this.http.patch<GraphInfo>(`/graphs/${graphId}`, input);
  }

  delete(graphId: number): Promise<void> {
    return this.http.delete(`/graphs/${graphId}`);
  }

  fromRepos(input: GraphFromReposInput): Promise<GraphInfo> {
    return this.http.post<GraphInfo>('/graphs/from-repos', input);
  }

  exportDocument(graphId: number): Promise<ExchangeDocument> {
    return this.http.get<ExchangeDocument>(`/graphs/${graphId}/export`);
  }

  importDocument(graphId: number, doc: ExchangeDocumentInput): Promise<ImportResult> {
    return this.http.post<ImportResult>(`/graphs/${graphId}/import`, doc);
  }
}
