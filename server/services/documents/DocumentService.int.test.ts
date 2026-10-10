import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import { EventBus } from '../../core/events/EventBus.ts';
import { MentionService } from './MentionService.ts';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

describe('DocumentService', () => {
  let k: DocumentsKit;
  let changed: number[][];

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    changed = [];
    k.events.on('documents.changed', (p) => changed.push(p.documentIds));
  });

  it('upsert guarda o original no bucket e cria, mantém ou atualiza o documento', async () => {
    const content = '# Pagamentos\n\nUsa o PayFlow Gateway.';
    const created = await k.documentService.upsert({ path: 'docs/pag.md', content, source: 'upload' });
    expect(created.status).toBe('created');
    const key = `documents/${sha(content)}.md`;
    expect(k.storage.objects.get(`private:${key}`)).toMatchObject({ contentType: 'text/markdown; charset=utf-8' });
    const doc = await k.documents.findById(created.id);
    expect(doc).toMatchObject({ path: 'docs/pag.md', title: 'Pagamentos', source: 'upload', storage_key: key, folder_id: null, node_id: null });
    expect(changed).toEqual([[created.id]]);
    expect(k.indexer.kicks).toBe(1);

    expect(await k.documentService.upsert({ path: 'docs/pag.md', content, source: 'upload' })).toEqual({ id: created.id, status: 'unchanged' });
    expect(k.indexer.kicks).toBe(1);

    // Só o título mudou: também atualiza.
    expect(await k.documentService.upsert({ path: 'docs/pag.md', content, title: 'Outro título', source: 'api' })).toEqual({
      id: created.id,
      status: 'updated',
    });
    expect((await k.documents.findById(created.id))?.title).toBe('Outro título');

    const updated = await k.documentService.upsert({ path: 'docs/pag.md', content: 'novo conteúdo', source: 'api' });
    expect(updated).toEqual({ id: created.id, status: 'updated' });
    expect((await k.documents.findById(created.id))?.title).toBe('pag.md');
    expect(k.indexer.kicks).toBe(3);
  });

  it('usa a extensão do caminho na chave do bucket (ou .md)', async () => {
    await k.documentService.upsert({ path: 'README.markdown', content: 'a', source: 'api' });
    await k.documentService.upsert({ path: 'sem-extensao', content: 'b', source: 'api' });
    expect([...k.storage.objects.keys()].sort()).toEqual([`private:documents/${sha('a')}.markdown`, `private:documents/${sha('b')}.md`].sort());
  });

  it('importMany processa todos em ordem', async () => {
    const out = await k.documentService.importMany({
      documents: [
        { path: 'a.md', content: '# A', source: 'api' },
        { path: 'b.md', content: '# B', source: 'upload' },
        { path: 'a.md', content: '# A', source: 'api' },
      ],
    });
    expect(out.map((o) => o.status)).toEqual(['created', 'created', 'unchanged']);
    expect((await k.documentService.list()).map((d) => d.path)).toEqual(['a.md', 'b.md']);
  });

  it('get devolve conteúdo, trechos e menções; documento inexistente dá 404', async () => {
    const node = await k.nodes.create({ graph_id: 1, name: 'PayFlow Gateway', kind: 'external' });
    const { id } = await k.documentService.upsert({ path: 'p.md', content: '# Pag\nChama o PayFlow Gateway.\n## Outro\nnada', source: 'api' });
    const detail = await k.documentService.get(id);
    expect(detail).toMatchObject({ id, path: 'p.md', title: 'Pag', chunkCount: 2, embeddedCount: 0, mentionCount: 1 });
    expect(detail.content).toContain('PayFlow');
    expect(detail.chunks.map((c) => c.heading)).toEqual(['Pag', 'Pag > Outro']);
    expect(detail.mentions).toEqual([{ chunk_id: detail.chunks[0]!.id, node_id: node.id, matched: 'PayFlow Gateway', method: 'exact', confidence: 1 }]);
    await expect(k.documentService.get(9999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('mentionsOfNode lista os trechos que citam o nó', async () => {
    const node = await k.nodes.create({ graph_id: 1, name: 'Billing Service', kind: 'service' });
    const { id } = await k.documentService.upsert({ path: 'b.md', content: '# Cobrança\nO billing-service gera faturas.', source: 'api' });
    const mentions = await k.documentService.mentionsOfNode(node.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      documentId: id,
      path: 'b.md',
      title: 'Cobrança',
      method: 'fuzzy',
      matched: 'billing-service',
      startLine: 1,
      endLine: 2,
    });
  });

  it('delete remove e avisa; inexistente dá 404', async () => {
    const { id } = await k.documentService.upsert({ path: 'x.md', content: 'x', source: 'api' });
    changed.length = 0;
    await k.documentService.delete(id);
    expect(changed).toEqual([[id]]);
    expect(await k.documents.findById(id)).toBeNull();
    await expect(k.documentService.delete(id)).rejects.toThrow(`Documento ${id} não encontrado`);
  });
});

describe('MentionService', () => {
  let k: DocumentsKit;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('recompute sem ids recalcula todos os trechos e preserva menções do LLM', async () => {
    const { id } = await k.documentService.upsert({ path: 'a.md', content: '# A\nusa o Kafka Cluster', source: 'api' });
    const [chunk] = await k.documents.chunksOf(id);
    expect(await k.documents.mentionsOfChunks([chunk!.id])).toEqual([]);

    const kafka = await k.nodes.create({ graph_id: 1, name: 'Kafka Cluster', kind: 'queue' });
    const other = await k.nodes.create({ graph_id: 1, name: 'Outro Nó', kind: 'service' });
    await k.documents.replaceMentions([chunk!.id], [{ chunk_id: chunk!.id, node_id: other.id, matched: 'x', method: 'llm', confidence: 0.9 }], ['llm']);

    await k.mentions.recompute();
    const found = await k.documents.mentionsOfChunks([chunk!.id]);
    expect(found).toHaveLength(2);
    expect(found.map((m) => [m.node_id, m.method])).toEqual(
      expect.arrayContaining([
        [kafka.id, 'exact'],
        [other.id, 'llm'],
      ]),
    );

    await k.nodes.update(kafka.id, { name: 'Rabbit Broker' });
    await k.mentions.recompute([chunk!.id]);
    expect((await k.documents.mentionsOfChunks([chunk!.id])).map((m) => m.method)).toEqual(['llm']);
  });

  it('graph.changed agenda um recálculo com debounce', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const svc = new MentionService(k.documents, k.nodes, k.interfaces, bus);
    const spy = vi.spyOn(svc, 'recompute').mockResolvedValue(undefined);
    bus.emit('graph.changed');
    bus.emit('graph.changed');
    await vi.advanceTimersByTimeAsync(499);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith();
  });

  it('falha no recálculo agendado só é registrada', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new EventBus();
    const svc = new MentionService(k.documents, k.nodes, k.interfaces, bus);
    vi.spyOn(svc, 'recompute').mockRejectedValue(new Error('boom'));
    bus.emit('graph.changed');
    await vi.advanceTimersByTimeAsync(500);
    expect(error).toHaveBeenCalledWith('[mentions] falha ao recalcular:', expect.objectContaining({ message: 'boom' }));
  });
});
