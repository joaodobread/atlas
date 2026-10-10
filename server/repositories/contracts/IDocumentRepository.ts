import type { ChunkMention, DocChunk, DocumentSource, DocumentSummary, MentionMethod, NodeMention } from '../../../shared/types.ts';

export interface DocumentRecord {
  id: number;
  path: string;
  title: string;
  source: DocumentSource;
  folder_id: number | null;
  node_id: number | null;
  content: string;
  hash: string;
  /** Arquivo original no bucket privado (uploads). */
  storage_key: string | null;
  created_at: string;
  updated_at: string;
}

export type NewDocument = Pick<DocumentRecord, 'path' | 'title' | 'source' | 'folder_id' | 'node_id' | 'content' | 'hash'> & { storage_key?: string | null };
export type ChunkInput = Pick<DocChunk, 'ordinal' | 'heading' | 'content' | 'start_line' | 'end_line'>;
export type ChunkWithDocument = DocChunk & { path: string; title: string; node_id: number | null };

export interface TextHit {
  chunkId: number;
  /** ts_rank: maior = mais relevante. */
  rank: number;
  snippet: string;
}

export interface IndexCounts {
  documents: number;
  graphDocuments: number;
  chunks: number;
  embedded: number;
  pending: number;
}

export interface IDocumentRepository {
  listSummaries(): Promise<DocumentSummary[]>;
  findById(id: number): Promise<DocumentRecord | null>;
  findByPath(path: string): Promise<DocumentRecord | null>;
  listByFolder(folderId: number): Promise<Array<Pick<DocumentRecord, 'id' | 'path'>>>;
  insert(doc: NewDocument): Promise<number>;
  update(
    id: number,
    doc: Pick<DocumentRecord, 'title' | 'content' | 'hash' | 'folder_id' | 'node_id' | 'source'> & { storage_key?: string | null },
  ): Promise<void>;
  /** Documentos gerados do modelo do grafo. */
  listGraphDocuments(): Promise<Array<Pick<DocumentRecord, 'id' | 'node_id' | 'path'>>>;
  delete(id: number): Promise<boolean>;

  replaceChunks(documentId: number, chunks: readonly ChunkInput[]): Promise<DocChunk[]>;
  chunksOf(documentId: number): Promise<DocChunk[]>;
  allChunks(): Promise<DocChunk[]>;
  chunksByIds(ids: readonly number[]): Promise<ChunkWithDocument[]>;

  pendingEmbedding(limit: number): Promise<Array<Pick<DocChunk, 'id' | 'heading' | 'content'>>>;
  setEmbedding(chunkId: number, vector: Float32Array, model: string): Promise<void>;
  /** Descarta embeddings gerados por outro modelo (troca de EMBEDDING_MODEL). */
  resetEmbeddingsNotFrom(model: string): Promise<number>;
  /** Os `limit` trechos mais próximos (similaridade de cosseno, 1 = igual) entre os gerados pelo modelo. */
  vectorSearch(query: Float32Array, model: string, limit: number): Promise<Array<{ id: number; score: number }>>;

  /** `tsQuery` já no formato do to_tsquery do Postgres (termos seguros, ex.: "payflow:* | pix:*"). */
  textSearch(tsQuery: string, limit: number): Promise<TextHit[]>;

  /** Substitui, nos trechos informados, só as menções dos métodos informados (as demais ficam). */
  replaceMentions(chunkIds: readonly number[], mentions: readonly ChunkMention[], methods: readonly MentionMethod[]): Promise<void>;
  mentionsOfChunks(chunkIds: readonly number[]): Promise<ChunkMention[]>;
  mentionsOfNode(nodeId: number, limit: number): Promise<NodeMention[]>;

  counts(): Promise<IndexCounts>;

  // Extração de menções por LLM: um documento está pendente se o hash analisado difere do atual.
  nextPendingLlmMentions(): Promise<Pick<DocumentRecord, 'id' | 'hash' | 'title' | 'path'> | null>;
  countPendingLlmMentions(): Promise<number>;
  setLlmMentionsResult(documentId: number, hash: string, error: string | null): Promise<void>;
  /** Marca todos os documentos para nova análise. */
  resetLlmMentions(): Promise<void>;
  lastLlmMentionsError(): Promise<string | null>;
}
