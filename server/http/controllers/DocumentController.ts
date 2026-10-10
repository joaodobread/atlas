import { idParamSchema, importDocumentsSchema, upsertDocumentSchema, watchedFolderSchema } from '../../../shared/schemas.ts';
import type { IDocumentService, IFolderWatchService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, noContent, ok, type HttpResponse } from '../HttpResponse.ts';

export class DocumentController {
  constructor(
    private readonly documents: IDocumentService,
    private readonly folders: IFolderWatchService,
  ) {}

  async list(): Promise<HttpResponse> {
    return ok(await this.documents.list());
  }

  async show(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.documents.get(idParamSchema.parse(req.params.id)));
  }

  /** Cria ou atualiza pelo `path`. */
  async upsert(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.documents.upsert(upsertDocumentSchema.parse(req.body)));
  }

  async import(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.documents.importMany(importDocumentsSchema.parse(req.body)));
  }

  async destroy(req: HttpRequest): Promise<HttpResponse> {
    await this.documents.delete(idParamSchema.parse(req.params.id));
    return noContent();
  }

  async mentionsOfNode(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.documents.mentionsOfNode(idParamSchema.parse(req.params.id)));
  }

  async listFolders(): Promise<HttpResponse> {
    return ok(await this.folders.list());
  }

  async addFolder(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.folders.add(watchedFolderSchema.parse(req.body).path));
  }

  async removeFolder(req: HttpRequest): Promise<HttpResponse> {
    await this.folders.remove(idParamSchema.parse(req.params.id));
    return noContent();
  }

  async rescanFolder(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.folders.rescan(idParamSchema.parse(req.params.id)));
  }
}
