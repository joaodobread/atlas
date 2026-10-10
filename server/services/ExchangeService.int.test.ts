import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, testDatabase } from '../../test/support/database.ts';
import { exchangeDocumentSchema, type ExchangeDocumentInput } from '../../shared/schemas.ts';
import { EventBus } from '../core/events/EventBus.ts';
import { PgCallSiteRepository } from '../repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../repositories/postgres/PgConnectionRepository.ts';
import { PgGraphRepository } from '../repositories/postgres/PgGraphRepository.ts';
import { PgInterfaceRepository } from '../repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../repositories/postgres/PgNodeRepository.ts';
import { ExchangeService } from './ExchangeService.ts';
import { GraphService } from './GraphService.ts';

let exchange: ExchangeService;
let graph: GraphService;
let nodeRepo: PgNodeRepository;
let connRepo: PgConnectionRepository;
let ifaceRepo: PgInterfaceRepository;
let siteRepo: PgCallSiteRepository;
let graphRepo: PgGraphRepository;
let changed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  const db = await testDatabase();
  await resetDatabase(db);
  nodeRepo = new PgNodeRepository(db);
  ifaceRepo = new PgInterfaceRepository(db);
  connRepo = new PgConnectionRepository(db);
  siteRepo = new PgCallSiteRepository(db);
  graphRepo = new PgGraphRepository(db);
  graph = new GraphService(nodeRepo, ifaceRepo, connRepo, siteRepo);
  const events = new EventBus();
  changed = vi.fn<() => void>();
  events.on('graph.changed', changed);
  exchange = new ExchangeService(db, graph, nodeRepo, ifaceRepo, connRepo, siteRepo, events);
});

const doc = (input: ExchangeDocumentInput) => exchangeDocumentSchema.parse(input);

const sample = (): ExchangeDocumentInput => ({
  nodes: [
    // Filho antes do pai: o import resolve em ondas.
    { ref: 'shop/orders', name: 'orders', parent: 'shop', tech: 'node', interfaces: [{ name: 'POST /orders', type: 'http' }] },
    { ref: 'shop', name: 'shop', kind: 'service', icon: 'lu:store', description: 'loja' },
    { ref: 'db', name: 'db', kind: 'database' },
    { ref: 'pay', name: 'pay', interfaces: [{ name: 'charge', spec: 'POST /charge', description: 'cobra' }] },
  ],
  connections: [
    { ref: 'top', from: 'shop', to: 'pay', interface: 'charge', protocol: 'http' },
    {
      ref: 'low',
      from: 'shop/orders',
      to: 'pay',
      interface: 'charge',
      implements: 'top',
      callSites: [{ file_path: 'src/orders.ts', line: 12, symbol: 'charge()', snippet: 'pay.charge()', notes: 'n' }, { file_path: 'src/x.ts' }],
    },
    { from: 'shop/orders', to: 'db', interface: 'orders table', protocol: 'sql', description: 'grava' },
  ],
});

describe('ExchangeService.importDocument', () => {
  it('cria nós, interfaces, conexões, locais e o vínculo implements; emite graph.changed', async () => {
    const r = await exchange.importDocument(doc(sample()), 1);
    expect(r).toEqual({
      nodesCreated: 4,
      nodesUpdated: 0,
      interfacesCreated: 3, // POST /orders, charge, "orders table" (criada pela conexão)
      connectionsCreated: 3,
      connectionsUpdated: 0,
      callSitesCreated: 2,
      warnings: [],
    });
    expect(changed).toHaveBeenCalledTimes(1);

    const g = await graph.getGraph(1);
    const byName = new Map(g.nodes.map((n) => [n.name, n]));
    expect(byName.get('shop')).toMatchObject({ kind: 'service', icon: 'lu:store', description: 'loja', parent_id: null });
    expect(byName.get('orders')).toMatchObject({ kind: 'module', tech: 'node', parent_id: byName.get('shop')!.id });
    expect(byName.get('pay')?.kind).toBe('project');
    const tableIface = g.interfaces.find((i) => i.name === 'orders table');
    expect(tableIface).toMatchObject({ node_id: byName.get('db')!.id, type: 'sql' });

    const top = g.connections.find((c) => c.source_id === byName.get('shop')!.id)!;
    const low = g.connections.find((c) => c.source_id === byName.get('orders')!.id && c.target_id === byName.get('pay')!.id)!;
    expect(low.parent_connection_id).toBe(top.id);
    expect(top.parent_connection_id).toBeNull();
    expect(g.callSites.filter((s) => s.connection_id === low.id).map((s) => [s.file_path, s.line])).toEqual(
      expect.arrayContaining([
        ['src/orders.ts', 12],
        ['src/x.ts', null],
      ]),
    );
  });

  it('merge é idempotente: reimportar atualiza sem duplicar', async () => {
    await exchange.importDocument(doc(sample()), 1);
    const again = sample();
    const [orders, , , pay] = again.nodes ?? [];
    if (!orders || !pay) throw new Error('amostra inválida');
    orders.tech = 'deno';
    pay.interfaces = [{ name: 'charge', type: 'grpc' }];
    const r = await exchange.importDocument(doc(again), 1);
    expect(r).toEqual({
      nodesCreated: 0,
      nodesUpdated: 4,
      interfacesCreated: 0,
      connectionsCreated: 0,
      connectionsUpdated: 3,
      callSitesCreated: 0,
      warnings: [],
    });
    const g = await graph.getGraph(1);
    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.find((n) => n.name === 'orders')?.tech).toBe('deno');
    expect(g.interfaces.find((i) => i.name === 'charge')?.type).toBe('grpc');
    expect(g.callSites).toHaveLength(2);
  });

  it('resolve caminhos de nós já existentes ("A/B") quando o ref não está no documento', async () => {
    await exchange.importDocument(doc(sample()), 1);
    const r = await exchange.importDocument(
      doc({
        nodes: [{ ref: 'novo', name: 'worker', parent: 'shop/orders' }],
        connections: [{ from: 'novo', to: 'shop/orders', interface: 'POST /orders' }],
      }),
      1,
    );
    expect(r).toMatchObject({ nodesCreated: 1, connectionsCreated: 1, interfacesCreated: 0, warnings: [] });
    const worker = (await graph.getGraph(1)).nodes.find((n) => n.name === 'worker');
    expect(worker?.kind).toBe('module');
  });

  it('gera avisos: pai inexistente, nó da conexão inexistente, auto-referência e implements não resolvido', async () => {
    const r = await exchange.importDocument(
      doc({
        nodes: [
          { ref: 'a', name: 'a' },
          { ref: 'b', name: 'b' },
          { ref: 'orfao', name: 'orfao', parent: 'nao/existe' },
        ],
        connections: [
          { ref: 'self', from: 'a', to: 'a' },
          { from: 'a', to: 'fantasma' },
          { from: 'nada', to: 'b' },
          { ref: 'x', from: 'a', to: 'b', implements: 'zzz' },
          { ref: 'y', from: 'b', to: 'a', implements: 'y' },
        ],
      }),
      1,
    );
    expect(r.nodesCreated).toBe(2);
    expect(r.connectionsCreated).toBe(2);
    expect(r.warnings).toEqual([
      'Pai "nao/existe" não encontrado para orfao',
      'Conexão ignorada (auto-referência): a',
      'Conexão ignorada, nó não encontrado: a -> fantasma',
      'Conexão ignorada, nó não encontrado: nada -> b',
      'implements "zzz" não encontrado',
      'implements "y" não encontrado',
    ]);
  });

  // Regressão: o import não pode gravar ciclos de "implements" (o ConnectionService também os proíbe).
  it('implements mútuo (x↔y) não deve gravar um ciclo', async () => {
    const r = await exchange.importDocument(
      doc({
        nodes: [
          { ref: 'a', name: 'a' },
          { ref: 'b', name: 'b' },
        ],
        connections: [
          { ref: 'x', from: 'a', to: 'b', implements: 'y' },
          { ref: 'y', from: 'b', to: 'a', implements: 'x' },
        ],
      }),
      1,
    );
    const conns = (await graph.getGraph(1)).connections;
    const cyclic = conns.every((c) => c.parent_connection_id != null);
    expect(cyclic || r.warnings.length === 0).toBe(false);
  });

  it('replace apaga só o grafo alvo antes de importar', async () => {
    const g2 = await graphRepo.create('Outro', null);
    await exchange.importDocument(doc(sample()), 1);
    await exchange.importDocument(doc({ nodes: [{ ref: 'z', name: 'z' }] }), g2.id);
    const r = await exchange.importDocument(doc({ mode: 'replace', nodes: [{ ref: 'só', name: 'só' }] }), 1);
    expect(r.nodesCreated).toBe(1);
    expect((await graph.getGraph(1)).nodes.map((n) => n.name)).toEqual(['só']);
    expect((await graph.getGraph(g2.id)).nodes.map((n) => n.name)).toEqual(['z']);
    expect((await graph.getGraph(1)).connections).toEqual([]);
  });

  it('falha no meio desfaz a transação inteira e não emite evento', async () => {
    const bad = doc({ nodes: [{ ref: 'a', name: 'a' }], connections: [] });
    // Força erro: grafo inexistente viola a FK ao criar o nó.
    await expect(exchange.importDocument(bad, 999)).rejects.toThrow(/foreign key/i);
    expect(changed).not.toHaveBeenCalled();
    expect((await graph.getGraph()).nodes).toEqual([]);
  });
});

describe('ExchangeService.exportDocument', () => {
  it('exporta com caminhos como ref, ordenado por profundidade, com interfaces, implements e locais', async () => {
    await exchange.importDocument(doc(sample()), 1);
    const out = await exchange.exportDocument(1);
    expect(out.mode).toBe('merge');
    expect(out.nodes.map((n) => n.ref)).toEqual(['db', 'pay', 'shop', 'shop/orders']);
    const orders = out.nodes.find((n) => n.ref === 'shop/orders')!;
    expect(orders).toMatchObject({ name: 'orders', parent: 'shop', tech: 'node', icon: undefined, kind: 'module' });
    expect(orders.interfaces).toEqual([{ name: 'POST /orders', type: 'http', spec: undefined, description: undefined }]);
    expect(out.nodes.find((n) => n.ref === 'shop')?.parent).toBeNull();

    const top = out.connections.find((c) => c.from === 'shop')!;
    const low = out.connections.find((c) => c.from === 'shop/orders' && c.to === 'pay')!;
    const sql = out.connections.find((c) => c.to === 'db')!;
    expect(top).toMatchObject({ to: 'pay', interface: 'charge', protocol: 'http', implements: undefined, callSites: [] });
    expect(low.implements).toBe(top.ref);
    expect(low.callSites).toEqual(
      expect.arrayContaining([
        { file_path: 'src/orders.ts', line: 12, symbol: 'charge()', snippet: 'pay.charge()', notes: 'n' },
        { file_path: 'src/x.ts', line: undefined, symbol: undefined, snippet: undefined, notes: undefined },
      ]),
    );
    expect(sql).toMatchObject({ interface: 'orders table', description: 'grava' });
  });

  it('conexão sem interface exporta interface undefined; o export reimportado num grafo vazio reproduz o original', async () => {
    await exchange.importDocument(
      doc({
        nodes: [
          { ref: 'a', name: 'a' },
          { ref: 'b', name: 'b' },
        ],
        connections: [{ from: 'a', to: 'b' }],
      }),
      1,
    );
    expect((await exchange.exportDocument(1)).connections[0]?.interface).toBeUndefined();

    await exchange.importDocument(doc(sample()), 1);
    const g2 = await graphRepo.create('Cópia', null);
    const exported = await exchange.exportDocument(1);
    const r = await exchange.importDocument(exchangeDocumentSchema.parse(JSON.parse(JSON.stringify(exported))), g2.id);
    expect(r.warnings).toEqual([]);
    const copy = await exchange.exportDocument(g2.id);
    const strip = (d: typeof exported) => ({
      nodes: d.nodes,
      connections: d.connections.map((c) => ({ ...c, ref: undefined, implements: c.implements ? 'x' : undefined })),
    });
    expect(JSON.parse(JSON.stringify(strip(copy)))).toEqual(JSON.parse(JSON.stringify(strip(exported))));
  });

  it('grafo vazio exporta listas vazias', async () => {
    expect(await exchange.exportDocument(1)).toEqual({ mode: 'merge', nodes: [], connections: [] });
  });
});
