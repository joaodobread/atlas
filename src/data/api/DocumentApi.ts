import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { AskResult, DocumentDetail, DocumentSummary, IndexStatus, LlmInfo, NodeMention, SearchResult, WatchedFolder } from '../../../shared/types.ts';
import type { AskInput, ImportDocumentsInput, SearchQueryInput, UpsertDocumentInput } from '../../../shared/schemas.ts';

export interface UpsertOutcome {
  id: number;
  status: 'created' | 'updated' | 'unchanged';
}

export class DocumentApi {
  private static instance: DocumentApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): DocumentApi {
    return (DocumentApi.instance ??= new DocumentApi(http));
  }

  list(): Promise<DocumentSummary[]> {
    return this.http.get('/documents');
  }

  get(id: number): Promise<DocumentDetail> {
    return this.http.get(`/documents/${id}`);
  }

  upsert(input: UpsertDocumentInput): Promise<UpsertOutcome> {
    return this.http.post('/documents', input);
  }

  importMany(input: ImportDocumentsInput): Promise<UpsertOutcome[]> {
    return this.http.post('/documents/import', input);
  }

  remove(id: number): Promise<void> {
    return this.http.delete(`/documents/${id}`);
  }

  mentionsOfNode(nodeId: number): Promise<NodeMention[]> {
    return this.http.get(`/nodes/${nodeId}/mentions`);
  }

  folders(): Promise<WatchedFolder[]> {
    return this.http.get('/folders');
  }

  addFolder(path: string): Promise<WatchedFolder> {
    return this.http.post('/folders', { path });
  }

  removeFolder(id: number): Promise<void> {
    return this.http.delete(`/folders/${id}`);
  }

  rescanFolder(id: number): Promise<WatchedFolder> {
    return this.http.post(`/folders/${id}/rescan`);
  }

  search(input: SearchQueryInput): Promise<SearchResult> {
    const params = new URLSearchParams({ q: input.q, mode: input.mode, limit: String(input.limit) });
    return this.http.get(`/search?${params.toString()}`);
  }

  ask(input: AskInput): Promise<AskResult> {
    return this.http.post('/ask', input);
  }

  status(): Promise<IndexStatus> {
    return this.http.get('/index-status');
  }

  llm(): Promise<LlmInfo> {
    return this.http.get('/llm');
  }
}
