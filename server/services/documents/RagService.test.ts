import { describe, expect, it, vi } from 'vitest';
import type { ILlmProvider, LlmRequest } from '../../infra/llm/ILlmProvider.ts';
import type { ChunkWithDocument, IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { GraphData, GraphNode, SearchHit, SearchResult } from '../../../shared/types.ts';
import type { IGraphService, ISearchService } from '../contracts/index.ts';
import { RagService } from './RagService.ts';

const node = (id: number, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  graph_id: 1,
  parent_id: null,
  name,
  kind: 'service',
  tech: null,
  icon: null,
  description: null,
  created_at: '',
  updated_at: '',
  ...extra,
});

const hit = (chunkId: number, extra: Partial<SearchHit> = {}): SearchHit => ({
  chunkId,
  documentId: 1,
  path: `doc${chunkId}.md`,
  title: 'Doc',
  heading: '',
  startLine: 1,
  endLine: 3,
  snippet: `snippet ${chunkId}`,
  score: 1,
  matchedBy: ['text'],
  mentionedNodeIds: [],
  nodeId: null,
  ...extra,
});

const GRAPH: GraphData = {
  nodes: [
    node(1, 'Plataforma', { kind: 'project' }),
    node(2, 'Pagamentos', { parent_id: 1, tech: 'Node.js', description: 'cobra clientes' }),
    node(3, 'PayFlow', { kind: 'external' }),
    node(4, 'Órfão', { parent_id: 999 }),
  ],
  interfaces: [{ id: 10, node_id: 3, name: 'POST /charge', type: 'http', spec: null, description: null }],
  connections: [
    { id: 1, source_id: 2, target_id: 3, target_interface_id: 10, parent_connection_id: null, protocol: 'http', description: 'cobrança', created_at: '' },
    { id: 3, source_id: 3, target_id: 2, target_interface_id: null, parent_connection_id: null, protocol: 'amqp', description: null, created_at: '' },
    { id: 2, source_id: 4, target_id: 2, target_interface_id: 77, parent_connection_id: null, protocol: null, description: null, created_at: '' },
  ],
  callSites: [],
};

function setup(result: Partial<SearchResult>, llmOverrides: Partial<ILlmProvider> = {}) {
  const search: ISearchService = {
    search: vi.fn<ISearchService['search']>(() =>
      Promise.resolve({ query: '', mode: 'hybrid' as const, hits: [], affectedNodes: [], semanticUnavailable: false, ...result }),
    ),
  };
  const chunks: ChunkWithDocument[] = [
    {
      id: 100,
      document_id: 1,
      ordinal: 0,
      heading: 'Pix',
      content: 'conteúdo completo 100',
      start_line: 1,
      end_line: 3,
      path: 'doc100.md',
      title: 'Doc',
      node_id: null,
    },
  ];
  const documents = { chunksByIds: vi.fn<IDocumentRepository['chunksByIds']>((ids) => Promise.resolve(chunks.filter((c) => ids.includes(c.id)))) };
  const graph: IGraphService = { getGraph: vi.fn<IGraphService['getGraph']>(() => Promise.resolve(GRAPH)) };
  const complete = vi.fn<(req: LlmRequest) => Promise<string>>(() => Promise.resolve('resposta [1]'));
  const llm: ILlmProvider = {
    provider: 'anthropic',
    model: 'claude-x',
    configured: true,
    complete,
    completeJson: () => Promise.reject(new Error('não usado')),
    ...llmOverrides,
  };
  const rag = new RagService(search, documents as Partial<IDocumentRepository> as IDocumentRepository, graph, llm);
  return { rag, search, complete };
}

describe('RagService', () => {
  it('info reflete o provedor', () => {
    const { rag } = setup({});
    expect(rag.info()).toEqual({ configured: true, provider: 'anthropic', model: 'claude-x' });
  });

  it('sem resultados responde sem chamar o LLM', async () => {
    const { rag, complete, search } = setup({}, { model: null });
    const out = await rag.ask({ question: 'o que é X?', limit: 4 });
    expect(search.search).toHaveBeenCalledWith({ q: 'o que é X?', mode: 'hybrid', limit: 4 });
    expect(out).toEqual({
      answer: 'Não encontrei nada relacionado nos documentos indexados.',
      provider: 'anthropic',
      model: '',
      sources: [],
      affectedNodes: [],
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('monta o contexto com os trechos numerados e os fatos do grafo', async () => {
    const hits = [hit(100, { heading: 'Pagamentos > Pix', startLine: 5, endLine: 9 }), hit(200)];
    const affectedNodes = [
      { nodeId: 2, hits: 2 },
      { nodeId: 4, hits: 1 },
      { nodeId: 404, hits: 1 },
    ];
    const { rag, complete } = setup({ hits, affectedNodes });
    const out = await rag.ask({ question: 'Quem chama a PayFlow?', limit: 8 });
    expect(out).toEqual({ answer: 'resposta [1]', provider: 'anthropic', model: 'claude-x', sources: hits, affectedNodes });

    const req = complete.mock.calls[0]![0];
    expect(req.system).toContain('Cite os trechos');
    const prompt = req.messages[0]!.content;
    expect(req.messages[0]!.role).toBe('user');
    expect(prompt).toContain('<trecho n="1" arquivo="doc100.md" linhas="5-9" secao="Pagamentos > Pix">\nconteúdo completo 100\n</trecho>');
    expect(prompt).toContain('<trecho n="2" arquivo="doc200.md" linhas="1-3">\nsnippet 200\n</trecho>');
    expect(prompt).toContain('- Plataforma / Pagamentos (service, Node.js): cobra clientes');
    expect(prompt).toContain('  - Plataforma / Pagamentos → PayFlow [POST /charge] via http — cobrança');
    expect(prompt).toContain('  - PayFlow → Plataforma / Pagamentos via amqp\n');
    expect(prompt).toContain('- ? / Órfão (service)');
    expect(prompt).toContain('  - ? / Órfão → Plataforma / Pagamentos');
    expect(prompt).not.toContain('404');
    expect(prompt.endsWith('</contexto>\n\nPergunta: Quem chama a PayFlow?')).toBe(true);
  });

  it('sem nós afetados não inclui o bloco do grafo e limita a 15 nós', async () => {
    const { rag, complete } = setup({ hits: [hit(100)] });
    await rag.ask({ question: 'pergunta', limit: 8 });
    expect(complete.mock.calls[0]![0].messages[0]!.content).not.toContain('<grafo>');

    const many = Array.from({ length: 20 }, (_, i) => ({ nodeId: i < 15 ? 999 : 3, hits: 1 }));
    const second = setup({ hits: [hit(100)], affectedNodes: many });
    await second.rag.ask({ question: 'pergunta', limit: 8 });
    // Os 15 primeiros não existem e o 16º fica fora do limite: nada a mandar, nem um bloco vazio.
    expect(second.complete.mock.calls[0]![0].messages[0]!.content).not.toContain('<grafo>');
  });
});
