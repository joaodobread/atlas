import type { ChunkMention, DocChunk, DocumentSummary, MentionMethod, NodeMention } from '../../../shared/types.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type {
  ChunkInput,
  ChunkWithDocument,
  DocumentRecord,
  IDocumentRepository,
  IndexCounts,
  NewDocument,
  TextHit,
} from '../contracts/IDocumentRepository.ts';

const CHUNK_COLUMNS = 'id, document_id, ordinal, heading, content, start_line, end_line';
/** Vetor no formato texto do pgvector: "[0.1,0.2,…]". */
const toVector = (v: Float32Array) => `[${Array.from(v).join(',')}]`;

export class PgDocumentRepository implements IDocumentRepository {
  constructor(private readonly db: IDatabase) {}

  listSummaries(): Promise<DocumentSummary[]> {
    return this.db.all<DocumentSummary>(`
      SELECT d.id, d.path, d.title, d.source, d.folder_id, d.updated_at,
        (SELECT COUNT(*) FROM doc_chunks c WHERE c.document_id = d.id)::int AS "chunkCount",
        (SELECT COUNT(*) FROM doc_chunks c WHERE c.document_id = d.id AND c.embedding IS NOT NULL)::int AS "embeddedCount",
        (SELECT COUNT(DISTINCT m.node_id) FROM chunk_mentions m JOIN doc_chunks c ON c.id = m.chunk_id WHERE c.document_id = d.id)::int AS "mentionCount"
      FROM documents d WHERE d.source <> 'graph' ORDER BY lower(d.path)`);
  }

  findById(id: number): Promise<DocumentRecord | null> {
    return this.db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);
  }

  findByPath(path: string): Promise<DocumentRecord | null> {
    return this.db.get<DocumentRecord>('SELECT * FROM documents WHERE path = ?', [path]);
  }

  listByFolder(folderId: number): Promise<Array<Pick<DocumentRecord, 'id' | 'path'>>> {
    return this.db.all('SELECT id, path FROM documents WHERE folder_id = ?', [folderId]);
  }

  insert(doc: NewDocument): Promise<number> {
    return this.db.insert('INSERT INTO documents (path, title, source, folder_id, node_id, content, hash, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      doc.path,
      doc.title,
      doc.source,
      doc.folder_id,
      doc.node_id,
      doc.content,
      doc.hash,
      doc.storage_key ?? null,
    ]);
  }

  async update(
    id: number,
    doc: Pick<DocumentRecord, 'title' | 'content' | 'hash' | 'folder_id' | 'node_id' | 'source'> & { storage_key?: string | null },
  ): Promise<void> {
    await this.db.run(
      `UPDATE documents SET title = ?, content = ?, hash = ?, folder_id = ?, node_id = ?, source = ?,
         storage_key = COALESCE(?, storage_key), updated_at = now() WHERE id = ?`,
      [doc.title, doc.content, doc.hash, doc.folder_id, doc.node_id, doc.source, doc.storage_key ?? null, id],
    );
  }

  listGraphDocuments(): Promise<Array<Pick<DocumentRecord, 'id' | 'node_id' | 'path'>>> {
    return this.db.all(`SELECT id, node_id, path FROM documents WHERE source = 'graph'`);
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM documents WHERE id = ?', [id])).changes > 0;
  }

  replaceChunks(documentId: number, chunks: readonly ChunkInput[]): Promise<DocChunk[]> {
    return this.db.transaction(async () => {
      await this.db.run('DELETE FROM doc_chunks WHERE document_id = ?', [documentId]);
      // Um INSERT por lote (bem mais rápido que um por trecho).
      for (let i = 0; i < chunks.length; i += 200) {
        const batch = chunks.slice(i, i + 200);
        await this.db.run(
          `INSERT INTO doc_chunks (document_id, ordinal, heading, content, start_line, end_line) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
          batch.flatMap((c) => [documentId, c.ordinal, c.heading, c.content, c.start_line, c.end_line]),
        );
      }
      return this.chunksOf(documentId);
    });
  }

  chunksOf(documentId: number): Promise<DocChunk[]> {
    return this.db.all<DocChunk>(`SELECT ${CHUNK_COLUMNS} FROM doc_chunks WHERE document_id = ? ORDER BY ordinal`, [documentId]);
  }

  allChunks(): Promise<DocChunk[]> {
    return this.db.all<DocChunk>(`SELECT ${CHUNK_COLUMNS} FROM doc_chunks`);
  }

  async chunksByIds(ids: readonly number[]): Promise<ChunkWithDocument[]> {
    if (!ids.length) return [];
    return this.db.all<ChunkWithDocument>(
      `SELECT c.id, c.document_id, c.ordinal, c.heading, c.content, c.start_line, c.end_line, d.path, d.title, d.node_id
       FROM doc_chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ANY(?::int[])`,
      [[...ids]],
    );
  }

  pendingEmbedding(limit: number): Promise<Array<Pick<DocChunk, 'id' | 'heading' | 'content'>>> {
    return this.db.all('SELECT id, heading, content FROM doc_chunks WHERE embedding IS NULL ORDER BY id LIMIT ?', [limit]);
  }

  async setEmbedding(chunkId: number, vector: Float32Array, model: string): Promise<void> {
    await this.db.run('UPDATE doc_chunks SET embedding = ?::vector, embedding_model = ? WHERE id = ?', [toVector(vector), model, chunkId]);
  }

  async resetEmbeddingsNotFrom(model: string): Promise<number> {
    return (
      await this.db.run('UPDATE doc_chunks SET embedding = NULL, embedding_model = NULL WHERE embedding IS NOT NULL AND embedding_model IS DISTINCT FROM ?', [
        model,
      ])
    ).changes;
  }

  vectorSearch(query: Float32Array, model: string, limit: number): Promise<Array<{ id: number; score: number }>> {
    // <=> = distância de cosseno; similaridade = 1 − distância. Só vetores do mesmo modelo (e mesma dimensão).
    return this.db.all(
      `SELECT id, 1 - (embedding <=> ?::vector) AS score FROM doc_chunks
       WHERE embedding_model = ? AND embedding IS NOT NULL AND vector_dims(embedding) = ?
       ORDER BY embedding <=> ?::vector LIMIT ?`,
      [toVector(query), model, query.length, toVector(query), limit],
    );
  }

  textSearch(tsQuery: string, limit: number): Promise<TextHit[]> {
    return this.db.all<TextHit>(
      `WITH q AS (SELECT to_tsquery('simple', immutable_unaccent(?)) AS query, to_tsquery('cg_simple_unaccent', ?) AS headline)
       SELECT c.id AS "chunkId", ts_rank(c.tsv, q.query) AS rank,
              ts_headline('cg_simple_unaccent', c.content, q.headline, 'StartSel=[[, StopSel=]], MaxWords=28, MinWords=12, MaxFragments=1') AS snippet
       FROM doc_chunks c, q WHERE c.tsv @@ q.query ORDER BY rank DESC LIMIT ?`,
      [tsQuery, tsQuery, limit],
    );
  }

  replaceMentions(chunkIds: readonly number[], mentions: readonly ChunkMention[], methods: readonly MentionMethod[]): Promise<void> {
    return this.db.transaction(async () => {
      if (chunkIds.length && methods.length) {
        await this.db.run('DELETE FROM chunk_mentions WHERE chunk_id = ANY(?::int[]) AND method = ANY(?::text[])', [[...chunkIds], [...methods]]);
      }
      for (let i = 0; i < mentions.length; i += 500) {
        const batch = mentions.slice(i, i + 500);
        await this.db.run(
          `INSERT INTO chunk_mentions (chunk_id, node_id, matched, method, confidence) VALUES ${batch.map(() => '(?, ?, ?, ?, ?)').join(', ')}
           ON CONFLICT (chunk_id, node_id, method) DO UPDATE SET matched = excluded.matched, confidence = excluded.confidence`,
          batch.flatMap((m) => [m.chunk_id, m.node_id, m.matched, m.method, m.confidence]),
        );
      }
    });
  }

  async mentionsOfChunks(chunkIds: readonly number[]): Promise<ChunkMention[]> {
    if (!chunkIds.length) return [];
    return this.db.all<ChunkMention>(
      'SELECT chunk_id, node_id, matched, method, confidence FROM chunk_mentions WHERE chunk_id = ANY(?::int[]) ORDER BY confidence DESC',
      [[...chunkIds]],
    );
  }

  mentionsOfNode(nodeId: number, limit: number): Promise<NodeMention[]> {
    // Uma linha por trecho (a menção de maior confiança), ordenadas por documento e posição.
    return this.db.all<NodeMention>(
      `SELECT "chunkId", "documentId", path, title, heading, "startLine", "endLine", matched, method, confidence, excerpt FROM (
         SELECT DISTINCT ON (c.id) c.id AS "chunkId", d.id AS "documentId", d.path, d.title, c.heading,
                c.start_line AS "startLine", c.end_line AS "endLine", m.matched, m.method, m.confidence,
                substr(c.content, 1, 280) AS excerpt, c.ordinal
         FROM chunk_mentions m
         JOIN doc_chunks c ON c.id = m.chunk_id
         JOIN documents d ON d.id = c.document_id
         WHERE m.node_id = ?
         ORDER BY c.id, m.confidence DESC
       ) t ORDER BY path, ordinal LIMIT ?`,
      [nodeId, limit],
    );
  }

  nextPendingLlmMentions(): Promise<Pick<DocumentRecord, 'id' | 'hash' | 'title' | 'path'> | null> {
    // Documentos do modelo do grafo não precisam do LLM: as menções vêm da própria estrutura.
    return this.db.get(
      "SELECT id, hash, title, path FROM documents WHERE source <> 'graph' AND llm_mentions_hash IS DISTINCT FROM hash ORDER BY updated_at DESC LIMIT 1",
    );
  }

  async countPendingLlmMentions(): Promise<number> {
    return (await this.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM documents WHERE source <> 'graph' AND llm_mentions_hash IS DISTINCT FROM hash"))!
      .n;
  }

  async setLlmMentionsResult(documentId: number, hash: string, error: string | null): Promise<void> {
    await this.db.run('UPDATE documents SET llm_mentions_hash = ?, llm_mentions_error = ? WHERE id = ?', [hash, error, documentId]);
  }

  async resetLlmMentions(): Promise<void> {
    await this.db.run('UPDATE documents SET llm_mentions_hash = NULL, llm_mentions_error = NULL');
  }

  async lastLlmMentionsError(): Promise<string | null> {
    return (
      (await this.db.get<{ e: string }>('SELECT llm_mentions_error AS e FROM documents WHERE llm_mentions_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1'))
        ?.e ?? null
    );
  }

  async counts(): Promise<IndexCounts> {
    return (await this.db.get<IndexCounts>(`
      SELECT (SELECT COUNT(*) FROM documents WHERE source <> 'graph')::int AS documents,
             (SELECT COUNT(*) FROM documents WHERE source = 'graph')::int AS "graphDocuments",
             (SELECT COUNT(*) FROM doc_chunks)::int AS chunks,
             (SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NOT NULL)::int AS embedded,
             (SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NULL)::int AS pending`))!;
  }
}
