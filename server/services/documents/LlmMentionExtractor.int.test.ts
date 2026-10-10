import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { ILlmProvider, JsonOutputSpec, LlmRequest } from '../../infra/llm/ILlmProvider.ts';
import type { ILlmSettingsService } from '../contracts/index.ts';
import { LlmMentionExtractor } from './LlmMentionExtractor.ts';

/** LLM falso: devolve respostas programadas (passando pelo parse do schema, como os provedores reais). */
class FakeLlm implements ILlmProvider {
  readonly provider = 'openai-compatible' as const;
  readonly model = 'fake';
  readonly configured = true;
  readonly requests: LlmRequest[] = [];
  responses: unknown[] = [];
  fallback: unknown = { mentions: [] };
  failWith: unknown = null;

  complete(): Promise<string> {
    return Promise.reject(new Error('não usado'));
  }

  async completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    this.requests.push(request);
    if (this.failWith != null) throw this.failWith;
    const next = this.responses.length ? this.responses.shift() : this.fallback;
    return spec.parse(typeof next === 'function' ? (next as (r: LlmRequest) => unknown)(request) : next);
  }
}

describe('LlmMentionExtractor', () => {
  let k: DocumentsKit;
  let llm: FakeLlm;
  let enabled: boolean;
  let extractor: LlmMentionExtractor;
  const settings = { mentionsEnabled: () => enabled } as Partial<ILlmSettingsService> as ILlmSettingsService;

  const settle = () => vi.waitFor(async () => expect((await extractor.status()).state).not.toBe('running'), { timeout: 5000 });
  const addDoc = (path: string, content: string) => k.documentService.upsertData({ path, content, source: 'api', folderId: null });

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    llm = new FakeLlm();
    enabled = true;
    extractor = new LlmMentionExtractor(k.documents, k.nodes, k.interfaces, llm, settings, k.events);
  });
  afterEach(async () => {
    enabled = false;
    await settle();
    vi.restoreAllMocks();
  });

  it('desligado: não processa e informa "disabled"', async () => {
    enabled = false;
    await addDoc('a.md', '# A\ntexto');
    extractor.kick();
    expect(await extractor.status()).toEqual({ enabled: false, pendingDocuments: 0, state: 'disabled', error: null });
    expect(llm.requests).toEqual([]);
  });

  it('analisa documentos alterados e grava menções válidas (deduplicadas) com method llm', async () => {
    enabled = false;
    const plat = await k.nodes.create({ graph_id: 1, name: 'Plataforma', kind: 'project' });
    const api = await k.nodes.create({ graph_id: 1, name: 'Node API', kind: 'service', parent_id: plat.id, tech: 'Node.js' });
    const rabbit = await k.nodes.create({ graph_id: 1, name: 'RabbitMQ', kind: 'queue' });
    await k.interfaces.create({ node_id: rabbit.id, name: 'orders.created' });
    await k.interfaces.create({ node_id: rabbit.id, name: 'orders.paid' });
    const { id } = await addDoc('a.md', '# Doc\nA NodAPI publica no Rabbit.\n## Outro\nnada aqui');
    const chunks = await k.documents.chunksOf(id);
    expect(await extractor.status()).toMatchObject({ enabled: false, state: 'disabled' });

    llm.responses.push({
      mentions: [
        { chunk: 1, node_id: api.id, text: 'NodAPI', confidence: 0.7 },
        { chunk: 1, node_id: api.id, text: 'NodAPI ', confidence: 0.9 },
        { chunk: 1, node_id: api.id, text: 'x', confidence: 0.8 },
        { chunk: 1, node_id: rabbit.id, text: '   ', confidence: 7 },
        { chunk: 2, node_id: plat.id, text: 'baixa', confidence: 0.5 },
        { chunk: 3, node_id: plat.id, text: 'trecho inexistente', confidence: 1 },
        { chunk: 2, node_id: 999_999, text: 'nó inexistente', confidence: 1 },
      ],
    });
    enabled = true;
    expect((await extractor.status()).pendingDocuments).toBe(1);
    k.events.emit('documents.changed', { documentIds: [id] });
    await settle();

    expect(llm.requests).toHaveLength(1);
    const req = llm.requests[0]!;
    expect(req.maxTokens).toBe(8000);
    expect(req.system).toContain('catálogo');
    const prompt = req.messages[0]!.content;
    expect(prompt).toContain(`${api.id} | Plataforma / Node API | service | Node.js`);
    expect(prompt).toContain(`${rabbit.id} | RabbitMQ | queue | interfaces: orders.created, orders.paid`);
    expect(prompt).toContain(`${plat.id} | Plataforma | project`);
    expect(prompt).toContain('<documento titulo="Doc">\n<trecho n="1" secao="Doc">\n# Doc\nA NodAPI publica no Rabbit.\n</trecho>');
    expect(prompt).toContain('<trecho n="2" secao="Doc > Outro">');

    const llmMentions = (await k.documents.mentionsOfChunks(chunks.map((c) => c.id))).filter((m) => m.method === 'llm');
    expect(
      llmMentions.map(({ chunk_id, node_id, matched, confidence }) => ({ chunk_id, node_id, matched, confidence })).sort((a, b) => a.node_id - b.node_id),
    ).toEqual(
      [
        { chunk_id: chunks[0]!.id, node_id: api.id, matched: 'NodAPI', confidence: 0.9 },
        { chunk_id: chunks[0]!.id, node_id: rabbit.id, matched: '?', confidence: 1 },
      ].sort((a, b) => a.node_id - b.node_id),
    );
    expect(await extractor.status()).toEqual({ enabled: true, pendingDocuments: 0, state: 'idle', error: null });

    // Sem mudanças, nada é reanalisado; reprocessAll marca tudo de novo.
    extractor.kick();
    await settle();
    expect(llm.requests).toHaveLength(1);
    await extractor.reprocessAll();
    await settle();
    expect(llm.requests).toHaveLength(2);
    expect((await k.documents.mentionsOfChunks(chunks.map((c) => c.id))).filter((m) => m.method === 'llm')).toEqual([]);
  });

  it('trecho sem cabeçalho e documentos do modelo do grafo', async () => {
    enabled = false;
    const n = await k.nodes.create({ graph_id: 1, name: 'Solo', kind: 'service' });
    await k.documentService.upsertData({ path: 'graph/node/x', content: 'Solo', source: 'graph', folderId: null, nodeId: n.id });
    await addDoc('plain.md', 'texto sem título');
    enabled = true;
    extractor.kick();
    await settle();
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]!.messages[0]!.content).toContain('<documento titulo="plain.md">\n<trecho n="1">\ntexto sem título\n</trecho>');
  });

  it('documento sem trechos não chama o LLM', async () => {
    enabled = false;
    const { id } = await addDoc('vazio.md', '');
    enabled = true;
    extractor.kick();
    await settle();
    expect(llm.requests).toEqual([]);
    expect(await k.documents.countPendingLlmMentions()).toBe(0);
    expect(await k.documents.chunksOf(id)).toEqual([]);
  });

  it('divide documentos grandes em vários pedidos', async () => {
    enabled = false;
    const n = await k.nodes.create({ graph_id: 1, name: 'Alvo', kind: 'service' });
    const big = (c: string) => c.repeat(13_000);
    const { id } = await addDoc('big.md', `# A\n${big('a')}\n# B\n${big('b')}\n# C\nc`);
    const chunks = await k.documents.chunksOf(id);
    expect(chunks).toHaveLength(3);
    llm.responses.push({ mentions: [] }, { mentions: [{ chunk: 2, node_id: n.id, text: 'c', confidence: 0.99 }] });
    enabled = true;
    extractor.kick();
    await settle();
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]!.messages[0]!.content).toContain('<trecho n="1" secao="B">');
    const m = await k.documents.mentionsOfChunks([chunks[2]!.id]);
    expect(m).toMatchObject([{ node_id: n.id, method: 'llm', confidence: 0.99 }]);
  });

  it('erro do LLM é registrado no documento e no status; llm.changed limpa e tenta de novo', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    enabled = false;
    await addDoc('a.md', '# A\ntexto');
    llm.failWith = new Error('401 chave inválida');
    enabled = true;
    extractor.kick();
    await settle();
    expect(await extractor.status()).toEqual({ enabled: true, pendingDocuments: 0, state: 'error', error: '401 chave inválida' });
    expect(error).toHaveBeenCalledWith('[llm-mentions] a.md:', '401 chave inválida');
    expect(await k.documents.lastLlmMentionsError()).toBe('401 chave inválida');

    // Resposta fora do schema também é erro.
    llm.failWith = null;
    llm.responses.push({ mentions: [{ chunk: 'um' }] });
    await extractor.reprocessAll();
    await settle();
    expect((await extractor.status()).state).toBe('error');

    llm.failWith = 'falha em texto';
    await extractor.reprocessAll();
    await settle();
    expect((await extractor.status()).error).toBe('falha em texto');

    llm.failWith = null;
    await k.documents.resetLlmMentions();
    k.events.emit('llm.changed');
    await settle();
    expect(await extractor.status()).toEqual({ enabled: true, pendingDocuments: 0, state: 'idle', error: null });
  });

  it('para no meio se a extração for desligada', async () => {
    enabled = false;
    await addDoc('a.md', '# A\nx');
    await addDoc('b.md', '# B\ny');
    let calls = 0;
    const flag = { get: () => enabled };
    const toggling = {
      mentionsEnabled: () => {
        calls++;
        // kick (1) e primeira volta (2) ligados; depois desliga.
        return calls <= 2 && flag.get();
      },
    } as Partial<ILlmSettingsService> as ILlmSettingsService;
    const ex = new LlmMentionExtractor(k.documents, k.nodes, k.interfaces, llm, toggling, k.events);
    enabled = true;
    ex.kick();
    await vi.waitFor(() => expect(llm.requests).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(llm.requests).toHaveLength(1);
    expect(await k.documents.countPendingLlmMentions()).toBe(1);
  });
});
