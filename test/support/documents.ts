import { EventBus } from '../../server/core/events/EventBus.ts';
import type { PostgresDatabase } from '../../server/infra/database/PostgresDatabase.ts';
import { PgCallSiteRepository } from '../../server/repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../../server/repositories/postgres/PgConnectionRepository.ts';
import { PgDocumentRepository } from '../../server/repositories/postgres/PgDocumentRepository.ts';
import { PgGraphRepository } from '../../server/repositories/postgres/PgGraphRepository.ts';
import { PgInterfaceRepository } from '../../server/repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../../server/repositories/postgres/PgNodeRepository.ts';
import { PgWatchedFolderRepository } from '../../server/repositories/postgres/PgWatchedFolderRepository.ts';
import type { IEmbeddingIndexer } from '../../server/services/contracts/index.ts';
import { DocumentService } from '../../server/services/documents/DocumentService.ts';
import { MarkdownChunker } from '../../server/services/documents/MarkdownChunker.ts';
import { MentionService } from '../../server/services/documents/MentionService.ts';
import { GraphService } from '../../server/services/GraphService.ts';
import { MemoryObjectStorage } from './MemoryObjectStorage.ts';

/** Indexador que só conta os "kicks" (a indexação real é testada à parte). */
export class CountingIndexer implements IEmbeddingIndexer {
  kicks = 0;
  kick(): void {
    this.kicks++;
  }
  status(): ReturnType<IEmbeddingIndexer['status']> {
    return Promise.reject(new Error('não usado'));
  }
}

/** Repositórios Postgres reais + DocumentService/MentionService ligados à mão. */
export function documentsKit(db: PostgresDatabase) {
  const events = new EventBus();
  const documents = new PgDocumentRepository(db);
  const nodes = new PgNodeRepository(db);
  const interfaces = new PgInterfaceRepository(db);
  const connections = new PgConnectionRepository(db);
  const callSites = new PgCallSiteRepository(db);
  const graphs = new PgGraphRepository(db);
  const folders = new PgWatchedFolderRepository(db);
  const storage = new MemoryObjectStorage();
  const indexer = new CountingIndexer();
  const mentions = new MentionService(documents, nodes, interfaces, events);
  const chunker = new MarkdownChunker();
  const documentService = new DocumentService(documents, chunker, mentions, indexer, events, storage);
  const graph = new GraphService(nodes, interfaces, connections, callSites);
  return { db, events, documents, nodes, interfaces, connections, callSites, graphs, folders, storage, indexer, mentions, chunker, documentService, graph };
}

export type DocumentsKit = ReturnType<typeof documentsKit>;
