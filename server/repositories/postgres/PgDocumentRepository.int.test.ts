import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { ChunkMention } from '../../../shared/types.ts';
import type { ChunkInput, NewDocument } from '../contracts/IDocumentRepository.ts';
import { PgDocumentRepository } from './PgDocumentRepository.ts';
import { PgNodeRepository } from './PgNodeRepository.ts';
import { PgWatchedFolderRepository } from './PgWatchedFolderRepository.ts';

const doc = (over: Partial<NewDocument> = {}): NewDocument => ({
  path: 'docs/a.md',
  title: 'A',
  source: 'upload',
  folder_id: null,
  node_id: null,
  content: '# A',
  hash: 'h1',
  ...over,
});

const chunk = (ordinal: number, content: string, heading = ''): ChunkInput => ({
  ordinal,
  heading,
  content,
  start_line: ordinal * 10,
  end_line: ordinal * 10 + 5,
});

const vec = (...v: number[]) => new Float32Array(v);

describe('PgDocumentRepository', () => {
  let repo: PgDocumentRepository;
  let nodes: PgNodeRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgDocumentRepository(db);
    nodes = new PgNodeRepository(db);
  });

  describe('documentos', () => {
    it('insert/findById/findByPath; storage_key opcional vira null', async () => {
      const id = await repo.insert(doc());
      const d = await repo.findById(id);
      expect(d).toMatchObject({ id, path: 'docs/a.md', title: 'A', source: 'upload', storage_key: null, hash: 'h1' });
      expect((await repo.findByPath('docs/a.md'))?.id).toBe(id);
      expect(await repo.findByPath('x')).toBeNull();
      expect(await repo.findById(999)).toBeNull();
      const id2 = await repo.insert(doc({ path: 'b.md', storage_key: 'uploads/b.md' }));
      expect((await repo.findById(id2))?.storage_key).toBe('uploads/b.md');
    });

    it('update troca os campos e preserva storage_key quando não informado', async () => {
      const id = await repo.insert(doc({ storage_key: 'k1' }));
      const before = (await repo.findById(id))!;
      await new Promise((r) => setTimeout(r, 5));
      await repo.update(id, { title: 'B', content: 'novo', hash: 'h2', folder_id: null, node_id: null, source: 'api' });
      const after = (await repo.findById(id))!;
      expect(after).toMatchObject({ title: 'B', content: 'novo', hash: 'h2', source: 'api', storage_key: 'k1' });
      expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
      await repo.update(id, { title: 'B', content: 'novo', hash: 'h2', folder_id: null, node_id: null, source: 'api', storage_key: 'k2' });
      expect((await repo.findById(id))?.storage_key).toBe('k2');
    });

    it('listByFolder, listGraphDocuments e delete', async () => {
      const folder = await new PgWatchedFolderRepository(await testDatabase()).insert('/docs');
      const n = await nodes.create({ graph_id: 1, name: 'API', kind: 'service' });
      const a = await repo.insert(doc({ path: '/docs/a.md', source: 'folder', folder_id: folder.id }));
      const g = await repo.insert(doc({ path: 'graph/api', source: 'graph', node_id: n.id }));
      await repo.insert(doc({ path: 'solto.md' }));
      expect(await repo.listByFolder(folder.id)).toEqual([{ id: a, path: '/docs/a.md' }]);
      expect(await repo.listGraphDocuments()).toEqual([{ id: g, node_id: n.id, path: 'graph/api' }]);
      expect(await repo.delete(a)).toBe(true);
      expect(await repo.delete(a)).toBe(false);
    });

    it('listSummaries ignora documentos do grafo, ordena por caminho e conta trechos/embeddings/menções', async () => {
      const n1 = await nodes.create({ graph_id: 1, name: 'A', kind: 'project' });
      const n2 = await nodes.create({ graph_id: 1, name: 'B', kind: 'project' });
      const b = await repo.insert(doc({ path: 'B.md' }));
      await repo.insert(doc({ path: 'a.md' }));
      await repo.insert(doc({ path: 'graph/x', source: 'graph', node_id: n1.id }));
      const [c1, c2] = await repo.replaceChunks(b, [chunk(0, 'um'), chunk(1, 'dois')]);
      await repo.setEmbedding(c1.id, vec(1, 0), 'm');
      await repo.replaceMentions(
        [],
        [
          { chunk_id: c1.id, node_id: n1.id, matched: 'A', method: 'exact', confidence: 1 },
          { chunk_id: c2.id, node_id: n1.id, matched: 'A', method: 'fuzzy', confidence: 0.8 },
          { chunk_id: c2.id, node_id: n2.id, matched: 'B', method: 'exact', confidence: 1 },
        ],
        [],
      );
      const list = await repo.listSummaries();
      expect(list.map((d) => d.path)).toEqual(['a.md', 'B.md']);
      expect(list[1]).toMatchObject({ id: b, chunkCount: 2, embeddedCount: 1, mentionCount: 2 });
      expect(list[0]).toMatchObject({ chunkCount: 0, embeddedCount: 0, mentionCount: 0 });
    });
  });

  describe('trechos', () => {
    it('replaceChunks substitui os anteriores e devolve em ordem', async () => {
      const id = await repo.insert(doc());
      await repo.replaceChunks(id, [chunk(0, 'velho')]);
      const out = await repo.replaceChunks(id, [chunk(1, 'segundo', 'H2'), chunk(0, 'primeiro', 'H1')]);
      expect(out.map((c) => c.content)).toEqual(['primeiro', 'segundo']);
      expect(out[0]).toEqual({ id: expect.any(Number), document_id: id, ordinal: 0, heading: 'H1', content: 'primeiro', start_line: 0, end_line: 5 });
      expect(await repo.chunksOf(id)).toEqual(out);
    });

    it('replaceChunks com lista vazia só apaga; com mais de 200 insere em lotes', async () => {
      const id = await repo.insert(doc());
      expect(await repo.replaceChunks(id, [chunk(0, 'x')])).toHaveLength(1);
      expect(await repo.replaceChunks(id, [])).toEqual([]);
      const many = Array.from({ length: 450 }, (_, i) => chunk(i, `t${i}`));
      const out = await repo.replaceChunks(id, many);
      expect(out).toHaveLength(450);
      expect(out[449].content).toBe('t449');
      expect(await repo.allChunks()).toHaveLength(450);
    });

    it('replaceChunks é atômico: erro no meio mantém os trechos antigos', async () => {
      const id = await repo.insert(doc());
      await repo.replaceChunks(id, [chunk(0, 'antigo')]);
      await expect(repo.replaceChunks(id, [chunk(0, 'novo'), { ...chunk(1, 'x'), content: null as never }])).rejects.toThrow(/null value in column "content"/);
      expect((await repo.chunksOf(id)).map((c) => c.content)).toEqual(['antigo']);
    });

    it('chunksByIds junta os dados do documento; lista vazia não consulta', async () => {
      const n = await nodes.create({ graph_id: 1, name: 'N', kind: 'project' });
      const id = await repo.insert(doc({ title: 'Título', node_id: n.id }));
      const [c] = await repo.replaceChunks(id, [chunk(0, 'x')]);
      expect(await repo.chunksByIds([c.id, 9999])).toEqual([{ ...c, path: 'docs/a.md', title: 'Título', node_id: n.id }]);
      expect(await repo.chunksByIds([])).toEqual([]);
    });
  });

  describe('embeddings e busca vetorial', () => {
    it('pendingEmbedding respeita limite e ordem; setEmbedding remove da fila', async () => {
      const id = await repo.insert(doc());
      const cs = await repo.replaceChunks(id, [chunk(0, 'a', 'h'), chunk(1, 'b'), chunk(2, 'c')]);
      expect(await repo.pendingEmbedding(2)).toEqual([
        { id: cs[0].id, heading: 'h', content: 'a' },
        { id: cs[1].id, heading: '', content: 'b' },
      ]);
      await repo.setEmbedding(cs[0].id, vec(1, 0, 0), 'm1');
      expect((await repo.pendingEmbedding(10)).map((c) => c.id)).toEqual([cs[1].id, cs[2].id]);
    });

    it('vectorSearch ordena por similaridade de cosseno e filtra por modelo e dimensão', async () => {
      const id = await repo.insert(doc());
      const [a, b, c, d] = await repo.replaceChunks(id, [chunk(0, 'a'), chunk(1, 'b'), chunk(2, 'c'), chunk(3, 'd')]);
      await repo.setEmbedding(a.id, vec(1, 0), 'm1');
      await repo.setEmbedding(b.id, vec(0.7, 0.7), 'm1');
      await repo.setEmbedding(c.id, vec(1, 0), 'm2');
      await repo.setEmbedding(d.id, vec(1, 0, 0), 'm1');
      const hits = await repo.vectorSearch(vec(1, 0), 'm1', 10);
      expect(hits.map((h) => h.id)).toEqual([a.id, b.id]);
      expect(hits[0].score).toBeCloseTo(1, 5);
      expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 3);
      expect(await repo.vectorSearch(vec(1, 0), 'm1', 1)).toHaveLength(1);
      expect(await repo.vectorSearch(vec(1, 0), 'outro', 10)).toEqual([]);
    });

    it('resetEmbeddingsNotFrom descarta só os de outro modelo e devolve quantos', async () => {
      const id = await repo.insert(doc());
      const [a, b, c] = await repo.replaceChunks(id, [chunk(0, 'a'), chunk(1, 'b'), chunk(2, 'c')]);
      await repo.setEmbedding(a.id, vec(1, 0), 'novo');
      await repo.setEmbedding(b.id, vec(1, 0), 'velho');
      expect(await repo.resetEmbeddingsNotFrom('novo')).toBe(1);
      expect((await repo.pendingEmbedding(10)).map((x) => x.id)).toEqual([b.id, c.id]);
      expect(await repo.resetEmbeddingsNotFrom('novo')).toBe(0);
    });

    it('counts separa documentos comuns/do grafo e trechos com/sem embedding', async () => {
      const n = await nodes.create({ graph_id: 1, name: 'N', kind: 'project' });
      const id = await repo.insert(doc());
      await repo.insert(doc({ path: 'g', source: 'graph', node_id: n.id }));
      const [a] = await repo.replaceChunks(id, [chunk(0, 'a'), chunk(1, 'b')]);
      await repo.setEmbedding(a.id, vec(1), 'm');
      expect(await repo.counts()).toEqual({ documents: 1, graphDocuments: 1, chunks: 2, embedded: 1, pending: 1 });
    });
  });

  describe('busca textual', () => {
    it('acha sem acentos, prioriza o título do trecho e destaca o termo', async () => {
      const id = await repo.insert(doc());
      const [body, head] = await repo.replaceChunks(id, [
        chunk(0, 'O serviço chama a integração de pagamento todos os dias para conciliar.'),
        chunk(1, 'Detalhes gerais do fluxo.', 'Integração'),
        chunk(2, 'Nada relacionado aqui.'),
      ]);
      const hits = await repo.textSearch('integracao:*', 10);
      expect(hits.map((h) => h.chunkId)).toEqual([head.id, body.id]);
      expect(hits[0].rank).toBeGreaterThan(hits[1].rank);
      // O destaque também ignora acentos: buscar "integracao" marca "Integração" no texto original.
      expect(hits.find((h) => /\[\[[^\]]*ntegra/i.test(h.snippet))).toBeDefined();
      expect((await repo.textSearch('pagamento', 10))[0].snippet).toContain('[[pagamento]]');
      expect(await repo.textSearch('integracao:*', 1)).toHaveLength(1);
      expect(await repo.textSearch('inexistente', 10)).toEqual([]);
    });
  });

  describe('menções', () => {
    let n1: number;
    let n2: number;
    let c1: number;
    let c2: number;
    let docId: number;

    beforeEach(async () => {
      n1 = (await nodes.create({ graph_id: 1, name: 'API', kind: 'service' })).id;
      n2 = (await nodes.create({ graph_id: 1, name: 'DB', kind: 'database' })).id;
      docId = await repo.insert(doc({ title: 'Doc' }));
      const cs = await repo.replaceChunks(docId, [chunk(0, 'API fala com DB', 'Intro'), chunk(1, 'x'.repeat(400))]);
      c1 = cs[0].id;
      c2 = cs[1].id;
    });

    const m = (chunk_id: number, node_id: number, method: ChunkMention['method'], confidence: number, matched = 'API'): ChunkMention => ({
      chunk_id,
      node_id,
      matched,
      method,
      confidence,
    });

    it('replaceMentions troca só os métodos informados e faz upsert em conflito', async () => {
      await repo.replaceMentions([c1], [m(c1, n1, 'exact', 1), m(c1, n2, 'llm', 0.6, 'DB')], ['exact', 'llm']);
      // Recalcula só "exact": a menção "llm" fica.
      await repo.replaceMentions([c1], [m(c1, n2, 'exact', 1, 'DB')], ['exact']);
      expect(await repo.mentionsOfChunks([c1])).toEqual([
        { chunk_id: c1, node_id: n2, matched: 'DB', method: 'exact', confidence: 1 },
        { chunk_id: c1, node_id: n2, matched: 'DB', method: 'llm', confidence: expect.closeTo(0.6, 5) },
      ]);
      // Conflito na mesma chave (sem apagar antes): atualiza matched/confidence.
      await repo.replaceMentions([], [m(c1, n2, 'llm', 0.9, 'Banco')], []);
      const llm = (await repo.mentionsOfChunks([c1])).find((x) => x.method === 'llm')!;
      expect(llm).toMatchObject({ matched: 'Banco', confidence: expect.closeTo(0.9, 5) });
    });

    it('replaceMentions com chunks mas sem métodos não apaga nada; insere em lotes de 500', async () => {
      await repo.replaceMentions([c1], [m(c1, n1, 'exact', 1)], ['exact']);
      await repo.replaceMentions([c1], [], []);
      expect(await repo.mentionsOfChunks([c1])).toHaveLength(1);

      const extraNodes: number[] = [];
      for (let i = 0; i < 260; i++) extraNodes.push((await nodes.create({ graph_id: 1, name: `n${i}`, kind: 'project' })).id);
      const many = extraNodes.flatMap((n) => [m(c1, n, 'fuzzy', 0.5), m(c2, n, 'fuzzy', 0.5)]);
      await repo.replaceMentions([c1, c2], many, ['fuzzy']);
      expect(await repo.mentionsOfChunks([c1, c2])).toHaveLength(many.length + 1);
    });

    it('mentionsOfChunks ordena por confiança; lista vazia devolve []', async () => {
      await repo.replaceMentions([], [m(c1, n1, 'fuzzy', 0.4), m(c1, n2, 'exact', 1, 'DB')], []);
      expect((await repo.mentionsOfChunks([c1])).map((x) => x.confidence)).toEqual([1, expect.closeTo(0.4, 5)]);
      expect(await repo.mentionsOfChunks([])).toEqual([]);
    });

    it('mentionsOfNode: uma linha por trecho (a de maior confiança), trecho resumido, ordenado e limitado', async () => {
      const other = await repo.insert(doc({ path: 'a-primeiro.md', title: 'Outro' }));
      const [o1] = await repo.replaceChunks(other, [chunk(0, 'API aqui')]);
      await repo.replaceMentions(
        [],
        [m(c1, n1, 'fuzzy', 0.5, 'Api'), m(c1, n1, 'exact', 1), m(c2, n1, 'llm', 0.7), m(o1.id, n1, 'exact', 1), m(c1, n2, 'exact', 1, 'DB')],
        [],
      );
      const rows = await repo.mentionsOfNode(n1, 10);
      expect(rows.map((r) => [r.path, r.chunkId])).toEqual([
        ['a-primeiro.md', o1.id],
        ['docs/a.md', c1],
        ['docs/a.md', c2],
      ]);
      expect(rows[1]).toEqual({
        chunkId: c1,
        documentId: docId,
        path: 'docs/a.md',
        title: 'Doc',
        heading: 'Intro',
        startLine: 0,
        endLine: 5,
        matched: 'API',
        method: 'exact',
        confidence: 1,
        excerpt: 'API fala com DB',
      });
      expect(rows[2].excerpt).toHaveLength(280);
      expect(await repo.mentionsOfNode(n1, 1)).toHaveLength(1);
      expect(await repo.mentionsOfNode(9999, 10)).toEqual([]);
    });
  });

  describe('menções por LLM', () => {
    it('fila de pendentes ignora documentos do grafo e já analisados; pega o mais recente', async () => {
      const n = await nodes.create({ graph_id: 1, name: 'N', kind: 'project' });
      const db = await testDatabase();
      const old = await repo.insert(doc({ path: 'old.md', hash: 'ho' }));
      await db.run("UPDATE documents SET updated_at = now() - interval '1 hour' WHERE id = ?", [old]);
      const recent = await repo.insert(doc({ path: 'new.md', hash: 'hn', title: 'Novo' }));
      await repo.insert(doc({ path: 'graph', source: 'graph', node_id: n.id }));

      expect(await repo.countPendingLlmMentions()).toBe(2);
      expect(await repo.nextPendingLlmMentions()).toEqual({ id: recent, hash: 'hn', title: 'Novo', path: 'new.md' });

      await repo.setLlmMentionsResult(recent, 'hn', null);
      expect(await repo.countPendingLlmMentions()).toBe(1);
      expect((await repo.nextPendingLlmMentions())?.id).toBe(old);

      // Hash analisado diferente do atual (documento mudou) -> volta a ficar pendente.
      await repo.setLlmMentionsResult(old, 'outro-hash', null);
      expect((await repo.nextPendingLlmMentions())?.id).toBe(old);
      await repo.setLlmMentionsResult(old, 'ho', null);
      expect(await repo.nextPendingLlmMentions()).toBeNull();
      expect(await repo.countPendingLlmMentions()).toBe(0);

      await repo.resetLlmMentions();
      expect(await repo.countPendingLlmMentions()).toBe(2);
    });

    it('lastLlmMentionsError devolve o erro do documento atualizado mais recentemente', async () => {
      const db = await testDatabase();
      expect(await repo.lastLlmMentionsError()).toBeNull();
      const a = await repo.insert(doc({ path: 'a' }));
      const b = await repo.insert(doc({ path: 'b' }));
      await repo.setLlmMentionsResult(a, 'h1', 'erro A');
      await repo.setLlmMentionsResult(b, 'h1', 'erro B');
      await db.run("UPDATE documents SET updated_at = now() - interval '1 hour' WHERE id = ?", [b]);
      expect(await repo.lastLlmMentionsError()).toBe('erro A');
      await repo.resetLlmMentions();
      expect(await repo.lastLlmMentionsError()).toBeNull();
    });
  });
});
