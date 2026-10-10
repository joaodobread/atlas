import crypto from 'node:crypto';
import path from 'node:path';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { IEventBus } from '../../core/events/EventBus.ts';
import type { IObjectStorage } from '../../infra/storage/IObjectStorage.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { DocumentDetail, DocumentSummary, NodeMention } from '../../../shared/types.ts';
import type { ImportDocumentsInput, UpsertDocumentInput } from '../../../shared/schemas.ts';
import type { IDocumentService, IEmbeddingIndexer, IMentionService, UpsertDocumentData, UpsertOutcome } from '../contracts/index.ts';
import type { MarkdownChunker } from './MarkdownChunker.ts';

export class DocumentService implements IDocumentService {
  constructor(
    private readonly documents: IDocumentRepository,
    private readonly chunker: MarkdownChunker,
    private readonly mentions: IMentionService,
    private readonly indexer: IEmbeddingIndexer,
    private readonly events: IEventBus,
    private readonly storage: IObjectStorage,
  ) {}

  async list(): Promise<DocumentSummary[]> {
    return await this.documents.listSummaries();
  }

  async get(id: number): Promise<DocumentDetail> {
    const doc = await this.documents.findById(id);
    if (!doc) throw new NotFoundError(`Documento ${id} não encontrado`);
    const summary = (await this.documents.listSummaries()).find((d) => d.id === id)!;
    const chunks = await this.documents.chunksOf(id);
    return { ...summary, content: doc.content, chunks, mentions: await this.documents.mentionsOfChunks(chunks.map((c) => c.id)) };
  }

  /** Upload pela UI/API: o arquivo original vai para o bucket privado (endereçado pelo conteúdo). */
  async upsert(input: UpsertDocumentInput): Promise<UpsertOutcome> {
    const hash = crypto.createHash('sha256').update(input.content).digest('hex');
    const ext = path.extname(input.path) || '.md';
    const stored = await this.storage.put('private', `documents/${hash}${ext}`, input.content, 'text/markdown; charset=utf-8');
    return await this.upsertData({ ...input, folderId: null, storageKey: stored.key });
  }

  async importMany(input: ImportDocumentsInput): Promise<UpsertOutcome[]> {
    const out: UpsertOutcome[] = [];
    for (const d of input.documents) out.push(await this.upsert(d));
    return out;
  }

  async upsertData(data: UpsertDocumentData): Promise<UpsertOutcome> {
    const hash = crypto.createHash('sha256').update(data.content).digest('hex');
    const title = data.title?.trim() || this.chunker.title(data.content, path.basename(data.path));
    const existing = await this.documents.findByPath(data.path);
    if (existing && existing.hash === hash && existing.title === title) return { id: existing.id, status: 'unchanged' };

    const record = {
      title,
      content: data.content,
      hash,
      folder_id: data.folderId,
      node_id: data.nodeId ?? null,
      source: data.source,
      storage_key: data.storageKey ?? null,
    };
    const id = existing ? (await this.documents.update(existing.id, record), existing.id) : await this.documents.insert({ path: data.path, ...record });

    const chunks = await this.documents.replaceChunks(id, this.chunker.chunk(data.content));
    await this.mentions.recompute(chunks.map((c) => c.id));
    this.events.emit('documents.changed', { documentIds: [id] });
    this.indexer.kick();
    return { id, status: existing ? 'updated' : 'created' };
  }

  async delete(id: number): Promise<void> {
    if (!(await this.documents.delete(id))) throw new NotFoundError(`Documento ${id} não encontrado`);
    this.events.emit('documents.changed', { documentIds: [id] });
  }

  async mentionsOfNode(nodeId: number): Promise<NodeMention[]> {
    return await this.documents.mentionsOfNode(nodeId, 100);
  }
}
