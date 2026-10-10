import { beforeEach, describe, expect, it } from 'vitest';
import { HashEmbeddingProvider } from '../../../test/support/HashEmbeddingProvider.ts';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { PgDocumentRepository } from '../../repositories/postgres/PgDocumentRepository.ts';
import type { ChunkWithDocument, TextHit } from '../../repositories/contracts/IDocumentRepository.ts';
import { SearchService, toTsQuery } from './SearchService.ts';

describe('toTsQuery', () => {
  it('gera termos com prefixo combinados por OR, sem stopwords, repetições ou termos curtos', () => {
    expect(toTsQuery('Qual é o fluxo do PIX no Gateway?')).toBe('fluxo:* | pix:* | gateway:*');
    expect(toTsQuery("x; DROP TABLE users--' pix pix")).toBe('drop:* | table:* | users:* | pix:*');
    expect(toTsQuery('Ação ＡＢＣ')).toBe('ação:* | abc:*');
  });
  it('vazio quando só há stopwords ou símbolos', () => {
    expect(toTsQuery('o que é isso?')).toBe('');
    expect(toTsQuery('!!! ??')).toBe('');
  });
  it('limita a 16 termos', () => {
    const q = Array.from({ length: 20 }, (_, i) => `termo${i}`).join(' ');
    expect(toTsQuery(q).split(' | ')).toHaveLength(16);
  });
});

describe('SearchService', () => {
  let k: DocumentsKit;
  let provider: HashEmbeddingProvider;
  let search: SearchService;
  let gatewayId: number;
  let pixDocId: number;

  /** Indexa todos os trechos pendentes com o provedor de teste. */
  const embedAll = async () => {
    for (const c of await k.documents.pendingEmbedding(1000)) {
      const [v] = await provider.embed([c.heading ? `${c.heading}\n${c.content}` : c.content], 'passage');
      await k.documents.setEmbedding(c.id, v!, provider.model);
    }
  };

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    provider = new HashEmbeddingProvider('hash-test', 64);
    search = new SearchService(k.documents, provider);
    gatewayId = (await k.nodes.create({ graph_id: 1, name: 'PayFlow Gateway', kind: 'external' })).id;
    pixDocId = (
      await k.documentService.upsertData({
        path: 'pix.md',
        content: '# Pix\nPix pagamento instantâneo pelo PayFlow Gateway',
        source: 'api',
        folderId: null,
      })
    ).id;
    await k.documentService.upsertData({
      path: 'frota.md',
      content: `# Frota\n${'Veículos rastreados por telemetria em tempo real. '.repeat(10)}`,
      source: 'api',
      folderId: null,
    });
    await embedAll();
  });

  it('busca textual devolve trecho marcado, nós mencionados e nós afetados', async () => {
    const r = await search.search({ q: 'pagamento payflow', mode: 'text', limit: 5 });
    expect(r).toMatchObject({ query: 'pagamento payflow', mode: 'text', semanticUnavailable: false });
    expect(provider.calls.filter((c) => c.kind === 'query')).toEqual([]);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({
      documentId: pixDocId,
      path: 'pix.md',
      title: 'Pix',
      heading: 'Pix',
      startLine: 1,
      endLine: 2,
      matchedBy: ['text'],
      mentionedNodeIds: [gatewayId],
      nodeId: null,
    });
    expect(r.hits[0]!.snippet).toContain('[[');
    expect(r.hits[0]!.score).toBeCloseTo(1 / 61);
    expect(r.affectedNodes).toEqual([{ nodeId: gatewayId, hits: 1 }]);
  });

  it('ordena os nós afetados pelo número de resultados', async () => {
    const hub = await k.nodes.create({ graph_id: 1, name: 'Telemetria Hub', kind: 'service' });
    await k.documentService.upsertData({ path: 'ambos.md', content: 'Pix liquidado via PayFlow Gateway e Telemetria Hub', source: 'api', folderId: null });
    const r = await search.search({ q: 'pix', mode: 'text', limit: 5 });
    expect(r.hits).toHaveLength(2);
    expect(r.affectedNodes).toEqual([
      { nodeId: gatewayId, hits: 2 },
      { nodeId: hub.id, hits: 1 },
    ]);
  });

  it('consulta só com stopwords não faz busca textual', async () => {
    const r = await search.search({ q: 'o que é', mode: 'text', limit: 5 });
    expect(r.hits).toEqual([]);
    expect(r.affectedNodes).toEqual([]);
  });

  it('busca semântica usa pgvector, corta resultados distantes e resume o trecho', async () => {
    const r = await search.search({ q: 'veículos rastreados telemetria tempo real', mode: 'semantic', limit: 5 });
    expect(provider.calls.at(-1)).toEqual({ texts: ['veículos rastreados telemetria tempo real'], kind: 'query' });
    expect(r.hits.map((h) => h.path)).toEqual(['frota.md']);
    expect(r.hits[0]!.matchedBy).toEqual(['semantic']);
    expect(r.hits[0]!.snippet.endsWith('…')).toBe(true);
    expect(r.hits[0]!.snippet.length).toBe(261);
    expect(r.hits[0]!.mentionedNodeIds).toEqual([]);
  });

  it('busca semântica com trecho curto devolve o conteúdo inteiro como resumo', async () => {
    const r = await search.search({ q: 'pix pix pix pagamento instantâneo pelo payflow gateway', mode: 'semantic', limit: 5 });
    expect(r.hits.map((h) => h.snippet)).toEqual(['# Pix Pix pagamento instantâneo pelo PayFlow Gateway']);
  });

  it('busca semântica sem vetores do modelo atual não devolve nada', async () => {
    const other = new SearchService(k.documents, new HashEmbeddingProvider('outro-modelo', 64));
    const r = await other.search({ q: 'pix', mode: 'semantic', limit: 5 });
    expect(r).toMatchObject({ hits: [], semanticUnavailable: false });
  });

  it('busca semântica sem nada parecido não devolve nada', async () => {
    const r = await search.search({ q: 'kubernetes', mode: 'semantic', limit: 5 });
    expect(r.hits).toEqual([]);
  });

  it('híbrida funde texto e semântica (RRF) e soma os scores', async () => {
    const r = await search.search({ q: 'pix pagamento instantâneo pelo PayFlow Gateway', mode: 'hybrid', limit: 5 });
    const pix = r.hits.find((h) => h.path === 'pix.md')!;
    expect(pix.matchedBy.sort()).toEqual(['semantic', 'text']);
    expect(pix.score).toBeCloseTo(2 / 61);
    expect(r.hits[0]!.path).toBe('pix.md');
  });

  it('marca semanticUnavailable quando o embedding falha e segue só com texto', async () => {
    provider.failWith = new Error('modelo carregando');
    const r = await search.search({ q: 'pix', mode: 'hybrid', limit: 5 });
    expect(r.semanticUnavailable).toBe(true);
    expect(r.hits.map((h) => h.matchedBy)).toEqual([['text']]);
  });

  it('respeita o limite', async () => {
    const r = await search.search({ q: 'pix frota', mode: 'text', limit: 1 });
    expect(r.hits).toHaveLength(1);
  });

  it('documentos do modelo do grafo trazem o nó', async () => {
    await k.documentService.upsertData({
      path: 'graph/node/1',
      title: 'PayFlow Gateway',
      content: 'PayFlow Gateway é um externo',
      source: 'graph',
      folderId: null,
      nodeId: gatewayId,
    });
    const r = await search.search({ q: 'externo', mode: 'text', limit: 5 });
    expect(r.hits[0]!.nodeId).toBe(gatewayId);
  });

  it('falha na busca textual é tratada como sem resultados', async () => {
    class BrokenText extends PgDocumentRepository {
      override textSearch(): Promise<TextHit[]> {
        return Promise.reject(new Error('tsquery inválida'));
      }
    }
    const r = await new SearchService(new BrokenText(k.db), provider).search({ q: 'pix', mode: 'text', limit: 5 });
    expect(r.hits).toEqual([]);
  });

  it('ignora resultados cujo trecho sumiu entre a busca e a leitura', async () => {
    class Vanishing extends PgDocumentRepository {
      override chunksByIds(): Promise<ChunkWithDocument[]> {
        return Promise.resolve([]);
      }
    }
    const r = await new SearchService(new Vanishing(k.db), provider).search({ q: 'pix', mode: 'text', limit: 5 });
    expect(r.hits).toEqual([]);
  });
});
