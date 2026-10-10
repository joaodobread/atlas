import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { IGraphRepository } from '../../repositories/contracts/IGraphRepository.ts';
import type { IGraphService } from '../contracts/index.ts';
import { GraphKnowledgeSync } from './GraphKnowledgeSync.ts';

describe('GraphKnowledgeSync', () => {
  let k: DocumentsKit;
  let sync: GraphKnowledgeSync;

  const content = async (nodeId: number) => (await k.documents.findByPath(`graph/node/${nodeId}`))?.content ?? null;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    sync = new GraphKnowledgeSync(k.graph, k.graphs, k.documents, k.documentService, k.events);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cria um documento por nó descrevendo estrutura, interfaces, conexões e código', async () => {
    const plat = await k.nodes.create({ graph_id: 1, name: 'Plataforma', kind: 'project', description: 'Sistema principal' });
    const api = await k.nodes.create({ graph_id: 1, name: 'API', kind: 'service', parent_id: plat.id, tech: 'Node.js' });
    const fila = await k.nodes.create({ graph_id: 1, name: 'Eventos', kind: 'queue' });
    const infra = await k.nodes.create({ graph_id: 1, name: 'Cluster', kind: 'infra' });
    const db = await k.nodes.create({ graph_id: 1, name: 'Banco', kind: 'database', tech: 'Postgres' });
    const tbl = await k.interfaces.create({ node_id: db.id, name: 'users', type: 'table', spec: 'users', description: 'cadastro' });
    await k.interfaces.create({ node_id: db.id, name: 'orders', spec: 'CREATE TABLE orders' });
    const top = await k.connections.create({ source_id: plat.id, target_id: db.id, protocol: 'sql' });
    const conn = await k.connections.create({
      source_id: api.id,
      target_id: db.id,
      target_interface_id: tbl.id,
      parent_connection_id: top.id,
      protocol: 'sql',
      description: 'lê usuários',
    });
    await k.connections.create({ source_id: api.id, target_id: fila.id });
    for (let i = 1; i <= 7; i++)
      await k.callSites.create({ connection_id: conn.id, file_path: `src/repo${i}.ts`, line: i === 2 ? null : i, symbol: i === 1 ? 'findUser' : null });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await sync.sync()).toEqual({ created: 5, updated: 0, removed: 0 });

    const apiDoc = await k.documents.findByPath(`graph/node/${api.id}`);
    expect(apiDoc).toMatchObject({ title: 'Plataforma / API', source: 'graph', node_id: api.id });
    const text = (await content(api.id))!;
    expect(text).toContain('# Plataforma / API');
    expect(text).toContain('API é um serviço (Node.js). Grafo: Principal.');
    expect(text).toContain('## Estrutura\n- Faz parte de: Plataforma');
    expect(text).toContain('## API chama (saídas)');
    expect(text).toContain('- → Banco [users] via sql — lê usuários (implementa Plataforma → Banco)');
    expect(text).toContain('  - código: src/repo1.ts:1 (findUser)');
    expect(text).toContain('  - código: src/repo2.ts\n');
    expect(text).toContain('src/repo6.ts:6');
    expect(text).not.toContain('src/repo7.ts');
    expect(text).toContain('- → Eventos');

    expect(await content(plat.id)).toContain('Sistema principal');
    expect(await content(plat.id)).toContain('- Contém: API (serviço)');
    expect(await content(fila.id)).toContain('Eventos é uma fila / mensageria.');
    expect(await content(infra.id)).toContain('Cluster é uma infra.');
    const dbText = (await content(db.id))!;
    expect(dbText).toContain('## Interfaces expostas\n- orders: CREATE TABLE orders\n- users (table) — cadastro');
    expect(dbText).toContain('## Banco é chamado por (entradas)\n- ← Plataforma via sql\n- ← Plataforma / API [users]');

    // Rodar de novo sem mudanças não reescreve nada (e não loga).
    log.mockClear();
    expect(await sync.sync()).toEqual({ created: 0, updated: 0, removed: 0 });

    await k.nodes.update(fila.id, { name: 'Eventos v2' });
    expect(await sync.sync()).toEqual({ created: 0, updated: 2, removed: 0 });
  });

  it('remove documentos do modelo órfãos', async () => {
    const n = await k.nodes.create({ graph_id: 1, name: 'Solo', kind: 'service' });
    await sync.sync();
    const orphan = await k.documents.insert({
      path: 'graph/node/antigo',
      title: 'x',
      source: 'graph',
      folder_id: null,
      node_id: null,
      content: 'x',
      hash: 'h',
    });
    expect(await sync.sync()).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(await k.documents.findById(orphan)).toBeNull();
    expect(await content(n.id)).not.toBeNull();
  });

  it('usa "?" para grafos e nós desconhecidos', async () => {
    const a = await k.nodes.create({ graph_id: 1, name: 'A', kind: 'service' });
    const graphs = { list: () => Promise.resolve([]) } as Partial<IGraphRepository> as IGraphRepository;
    const graph: IGraphService = {
      getGraph: async () => {
        const g = await k.graph.getGraph();
        return {
          ...g,
          connections: [
            {
              id: 99,
              source_id: a.id,
              target_id: 4242,
              target_interface_id: 555,
              parent_connection_id: 777,
              protocol: null,
              description: null,
              created_at: '',
            },
          ],
        };
      },
    };
    await new GraphKnowledgeSync(graph, graphs, k.documents, k.documentService, k.events).sync();
    const text = (await content(a.id))!;
    expect(text).toContain('Grafo: ?.');
    expect(text).toContain('- → ?');
    expect(text).not.toContain('implementa');
  });

  it('start indexa na hora e reindexa com debounce quando o grafo muda', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await k.nodes.create({ graph_id: 1, name: 'X', kind: 'service' });
    await sync.start();
    expect(log).toHaveBeenCalledWith('[graph-sync] modelo indexado: +1 ~0 -0');

    const spy = vi.spyOn(sync, 'sync').mockResolvedValue({ created: 0, updated: 0, removed: 0 });
    k.events.emit('graph.changed');
    k.events.emit('graph.changed');
    await vi.advanceTimersByTimeAsync(1499);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falha ao sincronizar é só registrada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(sync, 'sync').mockRejectedValue(new Error('db fora'));
    await sync.start();
    expect(error).toHaveBeenCalledWith('[graph-sync] falha ao indexar o modelo do grafo:', expect.objectContaining({ message: 'db fora' }));
  });
});
