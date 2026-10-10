import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, testDatabase } from '../../test/support/database.ts';
import { BusinessRuleError, NotFoundError, ValidationError } from '../core/errors/AppError.ts';
import { EventBus } from '../core/events/EventBus.ts';
import { PgCallSiteRepository } from '../repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../repositories/postgres/PgConnectionRepository.ts';
import { PgGraphRepository } from '../repositories/postgres/PgGraphRepository.ts';
import { PgInterfaceRepository } from '../repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../repositories/postgres/PgNodeRepository.ts';
import { CallSiteService } from './CallSiteService.ts';
import { ConnectionService } from './ConnectionService.ts';
import { GraphService } from './GraphService.ts';
import { InterfaceService } from './InterfaceService.ts';
import { NodeService } from './NodeService.ts';

let nodes: NodeService;
let interfaces: InterfaceService;
let connections: ConnectionService;
let callSites: CallSiteService;
let graph: GraphService;
let graphRepo: PgGraphRepository;
let changed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  const db = await testDatabase();
  await resetDatabase(db);
  const nodeRepo = new PgNodeRepository(db);
  const ifaceRepo = new PgInterfaceRepository(db);
  const connRepo = new PgConnectionRepository(db);
  const siteRepo = new PgCallSiteRepository(db);
  graphRepo = new PgGraphRepository(db);
  const events = new EventBus();
  changed = vi.fn<() => void>();
  events.on('graph.changed', changed);
  nodes = new NodeService(nodeRepo, graphRepo, events);
  interfaces = new InterfaceService(ifaceRepo, nodeRepo, events);
  connections = new ConnectionService(connRepo, nodeRepo, ifaceRepo, events);
  callSites = new CallSiteService(siteRepo, connRepo, events);
  graph = new GraphService(nodeRepo, ifaceRepo, connRepo, siteRepo);
});

const root = (name: string, graph_id = 1) => nodes.create({ name, graph_id, parent_id: null, kind: 'project', icon: null });
const child = (name: string, parent_id: number) => nodes.create({ name, parent_id, kind: 'module', icon: null });
const conn = (source_id: number, target_id: number, extra: { target_interface_id?: number | null; parent_connection_id?: number | null } = {}) =>
  connections.create({
    source_id,
    target_id,
    target_interface_id: extra.target_interface_id ?? null,
    parent_connection_id: extra.parent_connection_id ?? null,
  });

describe('NodeService', () => {
  it('cria raiz no grafo informado e filho no grafo do pai, emitindo graph.changed', async () => {
    const g2 = await graphRepo.create('Outro', null);
    const api = await root('API', g2.id);
    const mod = await nodes.create({ name: 'Auth', parent_id: api.id, graph_id: 1, kind: 'module', icon: null });
    expect(api.graph_id).toBe(g2.id);
    expect(mod.graph_id).toBe(g2.id); // herda do pai, ignora graph_id
    expect(changed).toHaveBeenCalledTimes(2);
    expect(await nodes.get(mod.id)).toMatchObject({ name: 'Auth', parent_id: api.id });
    expect((await nodes.list()).map((n) => n.name)).toEqual(['API', 'Auth']);
  });

  it('create valida pai, grafo obrigatório e grafo existente', async () => {
    await expect(child('X', 999)).rejects.toThrow('Nó pai 999 não existe');
    await expect(nodes.create({ name: 'X', parent_id: null, kind: 'project', icon: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(root('X', 999)).rejects.toThrow('Grafo 999 não existe');
    expect(changed).not.toHaveBeenCalled();
  });

  it('get de nó inexistente lança NotFound', async () => {
    await expect(nodes.get(42)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update move o nó, renomeia e emite evento', async () => {
    const a = await root('A');
    const b = await root('B');
    const m = await child('M', a.id);
    const moved = await nodes.update(m.id, { parent_id: b.id, name: 'M2' });
    expect(moved).toMatchObject({ parent_id: b.id, name: 'M2' });
    const renamed = await nodes.update(a.id, { description: 'raiz' });
    expect(renamed.description).toBe('raiz');
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it('update recusa inexistente, pai inexistente, pai em outro grafo e ciclos', async () => {
    const g2 = await graphRepo.create('Outro', null);
    const a = await root('A');
    const m = await child('M', a.id);
    const sub = await child('S', m.id);
    const other = await root('O', g2.id);
    changed.mockClear();
    await expect(nodes.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(nodes.update(m.id, { parent_id: 999 })).rejects.toThrow('Nó pai 999 não existe');
    await expect(nodes.update(m.id, { parent_id: other.id })).rejects.toThrow('O nó pai precisa estar no mesmo grafo');
    await expect(nodes.update(a.id, { parent_id: a.id })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(nodes.update(a.id, { parent_id: sub.id })).rejects.toThrow('Um nó não pode ser movido para dentro de si mesmo');
    expect(changed).not.toHaveBeenCalled();
  });

  it('delete remove (em cascata) e lança NotFound se não existir', async () => {
    const a = await root('A');
    await child('M', a.id);
    await nodes.delete(a.id);
    expect(await nodes.list()).toEqual([]);
    await expect(nodes.delete(a.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('InterfaceService', () => {
  it('CRUD completo com eventos', async () => {
    const a = await root('A');
    changed.mockClear();
    const i = await interfaces.create({ node_id: a.id, name: 'GET /x', type: 'http' });
    expect(i).toMatchObject({ node_id: a.id, name: 'GET /x', type: 'http' });
    expect(await interfaces.get(i.id)).toEqual(i);
    expect(await interfaces.list()).toHaveLength(1);
    const u = await interfaces.update(i.id, { description: 'lista' });
    expect(u.description).toBe('lista');
    await interfaces.delete(i.id);
    expect(changed).toHaveBeenCalledTimes(3);
    await expect(interfaces.get(i.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(interfaces.update(i.id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(interfaces.delete(i.id)).rejects.toThrow(`Interface ${i.id} não encontrada`);
  });

  it('create exige nó existente', async () => {
    await expect(interfaces.create({ node_id: 77, name: 'x' })).rejects.toThrow('Nó 77 não existe');
  });
});

describe('ConnectionService', () => {
  it('cria, lê, lista, atualiza e remove com eventos', async () => {
    const a = await root('A');
    const b = await root('B');
    const i = await interfaces.create({ node_id: b.id, name: 'API' });
    changed.mockClear();
    const c = await conn(a.id, b.id, { target_interface_id: i.id });
    expect(c).toMatchObject({ source_id: a.id, target_id: b.id, target_interface_id: i.id });
    expect(await connections.get(c.id)).toEqual(c);
    expect(await connections.list()).toHaveLength(1);
    const u = await connections.update(c.id, { protocol: 'http', target_interface_id: null });
    expect(u).toMatchObject({ protocol: 'http', target_interface_id: null });
    await connections.delete(c.id);
    expect(changed).toHaveBeenCalledTimes(3);
    await expect(connections.get(c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(connections.delete(c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(connections.update(c.id, {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('valida origem/destino existentes, distintos e no mesmo grafo', async () => {
    const g2 = await graphRepo.create('Outro', null);
    const a = await root('A');
    const b = await root('B');
    const o = await root('O', g2.id);
    await expect(conn(999, b.id)).rejects.toThrow('Origem 999 não existe');
    await expect(conn(a.id, 999)).rejects.toThrow('Destino 999 não existe');
    await expect(conn(a.id, a.id)).rejects.toThrow('Origem e destino não podem ser o mesmo nó');
    await expect(conn(a.id, o.id)).rejects.toThrow('Origem e destino precisam estar no mesmo grafo');
    const c = await conn(a.id, b.id);
    await expect(connections.update(c.id, { target_id: a.id })).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('valida a interface do destino', async () => {
    const a = await root('A');
    const b = await root('B');
    const ia = await interfaces.create({ node_id: a.id, name: 'da origem' });
    await expect(conn(a.id, b.id, { target_interface_id: 999 })).rejects.toThrow('Interface 999 não existe');
    await expect(conn(a.id, b.id, { target_interface_id: ia.id })).rejects.toThrow('A interface escolhida não pertence ao destino');
  });

  it('cadeia de "implementa": pai inexistente e ciclos são recusados', async () => {
    const a = await root('A');
    const b = await root('B');
    const m = await child('M', a.id);
    const n = await child('N', b.id);
    const top = await conn(a.id, b.id);
    const low = await conn(m.id, n.id, { parent_connection_id: top.id });
    expect(low.parent_connection_id).toBe(top.id);
    await expect(conn(m.id, b.id, { parent_connection_id: 999 })).rejects.toThrow('Conexão pai 999 não existe');
    await expect(connections.update(top.id, { parent_connection_id: low.id })).rejects.toThrow('A cadeia de conexões implementadas forma um ciclo');
    await expect(connections.update(top.id, { parent_connection_id: top.id })).rejects.toBeInstanceOf(BusinessRuleError);
    // Mantém o pai atual quando não informado.
    const kept = await connections.update(low.id, { description: 'x' });
    expect(kept.parent_connection_id).toBe(top.id);
  });

  it('detecta ciclo pré-existente na cadeia (seen)', async () => {
    const db = await testDatabase();
    const a = await root('A');
    const b = await root('B');
    const c1 = await conn(a.id, b.id);
    const c2 = await conn(b.id, a.id, { parent_connection_id: c1.id });
    // Ciclo gravado direto no banco (não passaria pelo service).
    await db.run('UPDATE connections SET parent_connection_id = ? WHERE id = ?', [c2.id, c1.id]);
    const x = await child('X', a.id);
    await expect(conn(x.id, b.id, { parent_connection_id: c2.id })).rejects.toThrow('forma um ciclo');
  });
});

describe('CallSiteService', () => {
  it('CRUD completo com eventos e validação da conexão', async () => {
    const a = await root('A');
    const b = await root('B');
    const c = await conn(a.id, b.id);
    changed.mockClear();
    await expect(callSites.create({ connection_id: 999, file_path: 'x.ts', line: null })).rejects.toThrow('Conexão 999 não existe');
    const s = await callSites.create({ connection_id: c.id, file_path: 'src/a.ts', line: 10, symbol: 'call' });
    expect(s).toMatchObject({ connection_id: c.id, file_path: 'src/a.ts', line: 10 });
    expect(await callSites.get(s.id)).toEqual(s);
    expect(await callSites.list()).toHaveLength(1);
    expect((await callSites.update(s.id, { line: 11 })).line).toBe(11);
    await callSites.delete(s.id);
    expect(changed).toHaveBeenCalledTimes(3);
    await expect(callSites.get(s.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(callSites.update(s.id, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(callSites.delete(s.id)).rejects.toThrow(`Local de chamada ${s.id} não encontrado`);
  });
});

describe('GraphService', () => {
  it('sem id devolve tudo; com id filtra pelo grafo', async () => {
    const g2 = await graphRepo.create('Outro', null);
    const a = await root('A');
    const b = await root('B');
    const ib = await interfaces.create({ node_id: b.id, name: 'API' });
    const c = await conn(a.id, b.id, { target_interface_id: ib.id });
    await callSites.create({ connection_id: c.id, file_path: 'a.ts', line: null });
    const x = await root('X', g2.id);
    const y = await root('Y', g2.id);
    await interfaces.create({ node_id: y.id, name: 'Y-API' });
    const cxy = await conn(x.id, y.id);
    await callSites.create({ connection_id: cxy.id, file_path: 'x.ts', line: 1 });

    const all = await graph.getGraph();
    expect(all.nodes).toHaveLength(4);
    expect(all.interfaces).toHaveLength(2);
    expect(all.connections).toHaveLength(2);
    expect(all.callSites).toHaveLength(2);

    const one = await graph.getGraph(1);
    expect(one.nodes.map((n) => n.name)).toEqual(['A', 'B']);
    expect(one.interfaces.map((i) => i.name)).toEqual(['API']);
    expect(one.connections.map((k) => k.id)).toEqual([c.id]);
    expect(one.callSites.map((s) => s.file_path)).toEqual(['a.ts']);

    expect(await graph.getGraph(999)).toEqual({ nodes: [], interfaces: [], connections: [], callSites: [] });
  });
});
