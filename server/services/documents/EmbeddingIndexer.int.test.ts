import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HashEmbeddingProvider } from '../../../test/support/HashEmbeddingProvider.ts';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { EmbeddingIndexer } from './EmbeddingIndexer.ts';

describe('EmbeddingIndexer', () => {
  let k: DocumentsKit;
  let provider: HashEmbeddingProvider;
  let indexer: EmbeddingIndexer;
  let embedded: number[][];

  const idle = () => vi.waitFor(async () => expect((await indexer.status()).embeddingState).not.toBe('indexing'), { timeout: 5000 });

  /** Documento com `n` seções (um trecho cada). */
  const addDoc = (path: string, n: number) =>
    k.documentService.upsertData({
      path,
      content: Array.from({ length: n }, (_, i) => `# Seção ${i}\nconteúdo ${i}`).join('\n'),
      source: 'api',
      folderId: null,
    });

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    provider = new HashEmbeddingProvider('hash-v1', 16);
    indexer = new EmbeddingIndexer(k.documents, provider, k.events);
    embedded = [];
    k.events.on('chunks.embedded', (p) => embedded.push(p.chunkIds));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('indexa os trechos pendentes em lotes de 16 e fica ocioso', async () => {
    await addDoc('a.md', 20);
    await addDoc('b.md', 1);
    expect((await indexer.status()).pending).toBe(21);
    indexer.kick();
    indexer.kick(); // já rodando: ignorado
    await idle();
    const s = await indexer.status();
    expect(s).toMatchObject({ documents: 2, chunks: 21, embedded: 21, pending: 0, embeddingModel: 'hash-v1', embeddingState: 'idle', embeddingError: null });
    expect(embedded.map((b) => b.length)).toEqual([16, 5]);
    expect(provider.calls.map((c) => c.kind)).toEqual(['passage', 'passage']);
    expect(provider.calls[0]!.texts[0]).toBe('Seção 0\n# Seção 0\nconteúdo 0');
  });

  it('trecho sem cabeçalho é enviado só com o conteúdo', async () => {
    await k.documentService.upsertData({ path: 'p.md', content: 'sem título', source: 'api', folderId: null });
    indexer.kick();
    await idle();
    expect(provider.calls[0]!.texts).toEqual(['sem título']);
  });

  it('descarta embeddings de outro modelo uma única vez', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await addDoc('a.md', 3);
    const old = new EmbeddingIndexer(k.documents, new HashEmbeddingProvider('hash-v0', 16), k.events);
    old.kick();
    await vi.waitFor(async () => expect((await old.status()).embedded).toBe(3));

    const reset = vi.spyOn(k.documents, 'resetEmbeddingsNotFrom');
    indexer.kick();
    await idle();
    await vi.waitFor(async () => expect((await indexer.status()).embedded).toBe(3));
    expect(log).toHaveBeenCalledWith('[embeddings] 3 trechos serão reindexados com hash-v1');
    expect(await k.documents.vectorSearch(provider.vector('conteúdo 0'), 'hash-v1', 5)).toHaveLength(3);
    expect(await k.documents.vectorSearch(provider.vector('conteúdo 0'), 'hash-v0', 5)).toHaveLength(0);

    await addDoc('b.md', 1);
    indexer.kick();
    await idle();
    await vi.waitFor(async () => expect((await indexer.status()).pending).toBe(0));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('registra a falha do provedor no status e limpa ao tentar de novo', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await addDoc('a.md', 2);
    provider.failWith = new Error('modelo indisponível');
    indexer.kick();
    await vi.waitFor(async () => expect((await indexer.status()).embeddingState).toBe('error'));
    expect(await indexer.status()).toMatchObject({ embeddingError: 'modelo indisponível', pending: 2 });
    expect(error).toHaveBeenCalledWith('[embeddings] falha ao indexar:', 'modelo indisponível');

    provider.failWith = 'falha em texto';
    indexer.kick();
    await vi.waitFor(async () => expect((await indexer.status()).embeddingError).toBe('falha em texto'));

    provider.failWith = null;
    indexer.kick();
    await vi.waitFor(async () => expect(await indexer.status()).toMatchObject({ embeddingState: 'idle', embeddingError: null, pending: 0 }));
  });

  it('status reflete o carregamento do modelo e o último erro do provedor', async () => {
    provider.state = 'loading';
    expect((await indexer.status()).embeddingState).toBe('loading-model');
    provider.state = 'error';
    provider.lastError = 'download falhou';
    expect(await indexer.status()).toMatchObject({ embeddingState: 'idle', embeddingError: 'download falhou' });
  });

  it('status mostra "indexing" enquanto processa', async () => {
    await addDoc('a.md', 1);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = provider.embed.bind(provider);
    vi.spyOn(provider, 'embed').mockImplementation(async (texts, kind) => {
      await gate;
      return original(texts, kind);
    });
    indexer.kick();
    expect((await indexer.status()).embeddingState).toBe('indexing');
    release();
    await idle();
    expect((await indexer.status()).embedded).toBe(1);
  });
});
