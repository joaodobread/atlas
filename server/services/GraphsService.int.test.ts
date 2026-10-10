import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, testDatabase } from '../../test/support/database.ts';
import type { AnalysisDepth } from '../../shared/constants.ts';
import type { ImportResult, QualityReport, RepoGraphProposal } from '../../shared/types.ts';
import { BusinessRuleError, NotFoundError } from '../core/errors/AppError.ts';
import { EventBus } from '../core/events/EventBus.ts';
import type { PostgresDatabase } from '../infra/database/PostgresDatabase.ts';
import type { IntrospectionOutcome } from '../repositories/contracts/IRepoIntrospectionRepository.ts';
import { PgCallSiteRepository } from '../repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../repositories/postgres/PgConnectionRepository.ts';
import { PgGraphRepository } from '../repositories/postgres/PgGraphRepository.ts';
import { PgInterfaceRepository } from '../repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../repositories/postgres/PgNodeRepository.ts';
import { PgRepoIntrospectionRepository } from '../repositories/postgres/PgRepoIntrospectionRepository.ts';
import type { IIntrospectionService } from './contracts/index.ts';
import { GraphService } from './GraphService.ts';
import { GraphsService } from './GraphsService.ts';

const EMPTY_RESULT: ImportResult = {
  nodesCreated: 0,
  nodesUpdated: 0,
  interfacesCreated: 0,
  connectionsCreated: 0,
  connectionsUpdated: 0,
  callSitesCreated: 0,
  warnings: [],
};

let db: PostgresDatabase;
let service: GraphsService;
let graph: GraphService;
let graphRepo: PgGraphRepository;
let nodeRepo: PgNodeRepository;
let ifaceRepo: PgInterfaceRepository;
let connRepo: PgConnectionRepository;
let siteRepo: PgCallSiteRepository;
let repos: PgRepoIntrospectionRepository;
let apply: ReturnType<typeof vi.fn<(id: number, graphId: number) => Promise<ImportResult>>>;
let changed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  db = await testDatabase();
  await resetDatabase(db);
  graphRepo = new PgGraphRepository(db);
  nodeRepo = new PgNodeRepository(db);
  ifaceRepo = new PgInterfaceRepository(db);
  connRepo = new PgConnectionRepository(db);
  siteRepo = new PgCallSiteRepository(db);
  repos = new PgRepoIntrospectionRepository(db);
  graph = new GraphService(nodeRepo, ifaceRepo, connRepo, siteRepo);
  apply = vi.fn<(id: number, graphId: number) => Promise<ImportResult>>(() => Promise.resolve(EMPTY_RESULT));
  const introspection = { apply } as unknown as IIntrospectionService;
  const events = new EventBus();
  changed = vi.fn<() => void>();
  events.on('graph.changed', changed);
  service = new GraphsService(graphRepo, graph, nodeRepo, ifaceRepo, connRepo, siteRepo, repos, introspection, db, events);
});

/** Cria uma linha em repo_introspections pelo repositório real. */
async function addRepo(name: string, opts: { depth?: AnalysisDepth | null; nodeId?: number | null; proposal?: boolean } = {}): Promise<number> {
  await repos.upsertMetadata({
    owner: 'acme',
    name,
    description: null,
    defaultBranch: 'main',
    language: 'TypeScript',
    archived: false,
    fork: false,
    pushedAt: null,
    htmlUrl: null,
  });
  const id = (await repos.findByName('acme', name))!.id;
  if (opts.depth) {
    const proposal: RepoGraphProposal = { nodes: [], connections: [] };
    const outcome = {
      sha: 'abc',
      depth: opts.depth,
      facts: {},
      quality: { version: '1', score: 7, confidence: 1, categories: [] } satisfies QualityReport,
      analysis: {},
      proposal,
      documentId: null,
    } as unknown as IntrospectionOutcome;
    await repos.saveOutcome(id, outcome);
    if (opts.proposal === false) await db.run('UPDATE repo_introspections SET proposal_json = NULL WHERE id = ?', [id]);
  }
  if (opts.nodeId != null) await repos.linkNode(id, opts.nodeId);
  return id;
}

const mk = (graph_id: number, name: string, kind: Parameters<PgNodeRepository['create']>[0]['kind'], parent_id: number | null = null) =>
  nodeRepo.create({ graph_id, parent_id, name, kind, tech: null, icon: null, description: `desc ${name}` });

/**
 * Grafo de origem:
 *   AWS (infra) ⊃ api (service) ⊃ auth, http (module);  AWS ⊃ pg (database)
 *   queue (queue), frontend (project), vendor (external, interface "charge")
 * Conexões: auth→pg, api→vendor[charge], http→vendor[charge] (implementa api→vendor), frontend→http,
 *   queue→api, frontend→vendor (não toca o repositório), pg→queue (entre vizinhos).
 */
async function seedSource(graphId = 1) {
  const aws = await mk(graphId, 'AWS', 'infra');
  const api = await mk(graphId, 'api', 'service', aws.id);
  const auth = await mk(graphId, 'auth', 'module', api.id);
  const http = await mk(graphId, 'http', 'module', api.id);
  const pg = await mk(graphId, 'pg', 'database', aws.id);
  const queue = await mk(graphId, 'queue', 'queue');
  const frontend = await mk(graphId, 'frontend', 'project');
  const vendor = await mk(graphId, 'vendor', 'external');
  const charge = await ifaceRepo.create({ node_id: vendor.id, name: 'charge', type: 'http', spec: null, description: null });
  await ifaceRepo.create({ node_id: frontend.id, name: 'ui', type: null, spec: null, description: null });
  const c = (source_id: number, target_id: number, protocol: string, target_interface_id: number | null = null) =>
    connRepo.create({ source_id, target_id, target_interface_id, protocol, description: null });
  const authPg = await c(auth.id, pg.id, 'sql');
  const apiVendor = await c(api.id, vendor.id, 'http', charge.id);
  const httpVendor = await c(http.id, vendor.id, 'http', charge.id);
  await connRepo.update(httpVendor.id, { parent_connection_id: apiVendor.id });
  await c(frontend.id, http.id, 'http');
  await c(queue.id, api.id, 'amqp');
  await c(frontend.id, vendor.id, 'http');
  await c(pg.id, queue.id, 'tcp');
  await siteRepo.create({ connection_id: httpVendor.id, file_path: 'src/pay.ts', line: 3, symbol: 'pay', snippet: 'x', notes: null });
  await siteRepo.create({ connection_id: authPg.id, file_path: 'src/db.ts', line: null, symbol: null, snippet: null, notes: null });
  return { aws, api, auth, http, pg, queue, frontend, vendor };
}

/** Resumo legível do grafo gerado: caminhos dos nós e "origem -> destino" das conexões. */
async function shape(graphId: number) {
  const g = await graph.getGraph(graphId);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const path = (id: number): string => {
    const n = byId.get(id)!;
    return n.parent_id == null ? n.name : `${path(n.parent_id)}/${n.name}`;
  };
  return {
    nodes: g.nodes.map((n) => path(n.id)).toSorted(),
    connections: g.connections.map((c) => `${path(c.source_id)} -> ${path(c.target_id)}`).toSorted(),
    interfaces: g.interfaces.map((i) => `${path(i.node_id)}#${i.name}`).toSorted(),
    callSites: g.callSites.map((s) => s.file_path).toSorted(),
    raw: g,
  };
}

describe('GraphsService (CRUD)', () => {
  it('lista, cria, lê e atualiza grafos validando nome único', async () => {
    const g = await service.create({ name: 'Novo', description: 'd' });
    expect(g).toMatchObject({ name: 'Novo', description: 'd', nodeCount: 0 });
    expect((await service.create({ name: 'Sem desc' })).description).toBeNull();
    expect((await service.list()).map((x) => x.name)).toEqual(['Principal', 'Novo', 'Sem desc']);
    await expect(service.create({ name: 'Principal' })).rejects.toThrow('Já existe um grafo chamado "Principal"');
    expect(await service.update(g.id, { name: 'Novo', description: 'outra' })).toMatchObject({ name: 'Novo', description: 'outra' });
    expect((await service.update(g.id, { description: null })).description).toBeNull();
    await expect(service.update(g.id, { name: 'Principal' })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(service.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(999)).rejects.toThrow('Grafo 999 não encontrado');
  });

  it('exclui grafo (emitindo graph.changed), mas nunca o único', async () => {
    await expect(service.delete(1)).rejects.toThrow('Não é possível excluir o único grafo');
    const g = await service.create({ name: 'Outro' });
    await service.delete(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await service.list()).map((x) => x.id)).toEqual([g.id]);
    await expect(service.delete(1)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('GraphsService.generateFromRepos', () => {
  it('valida nome, repositórios existentes e profundidade da análise', async () => {
    const shallow = await addRepo('rasa', { depth: 'fast' });
    const none = await addRepo('nunca');
    const medium = await addRepo('media', { depth: 'medium' });
    await expect(service.generateFromRepos({ name: 'Principal', repoIds: [shallow], depth: 'fast' })).rejects.toThrow('Já existe um grafo');
    await expect(service.generateFromRepos({ name: 'G', repoIds: [999], depth: 'fast' })).rejects.toThrow('Repositório 999 não encontrado');
    await expect(service.generateFromRepos({ name: 'G', repoIds: [shallow, none, medium], depth: 'medium' })).rejects.toThrow(
      'Analise com profundidade média antes de gerar: rasa, nunca',
    );
    await expect(service.generateFromRepos({ name: 'G', repoIds: [medium], depth: 'full' })).rejects.toThrow(
      'Analise com profundidade completa antes de gerar: media',
    );
    // Rápida não exige análise.
    await expect(service.generateFromRepos({ name: 'G', repoIds: [none], depth: 'fast' })).resolves.toMatchObject({ name: 'G' });
    expect((await service.list()).length).toBe(2);
  });

  it('rápida: repositório + só vizinhos de infra (bancos, filas, externos), módulos sobem para o repositório, sem trechos', async () => {
    const src = await seedSource();
    const repoId = await addRepo('api', { depth: 'fast', nodeId: src.api.id });
    const g = await service.generateFromRepos({ name: 'Rápida', repoIds: [repoId], depth: 'fast' });
    expect(g).toMatchObject({ name: 'Rápida', description: 'Gerado a partir de: api', nodeCount: 5 });
    expect(changed).toHaveBeenCalledTimes(1);
    // Proposta existe, mas o repositório tem nó e a profundidade é rápida: não aplica.
    expect(apply).not.toHaveBeenCalled();

    const s = await shape(g.id);
    expect(s.nodes).toEqual(['AWS', 'AWS/api', 'AWS/pg', 'queue', 'vendor']);
    expect(s.connections).toEqual(['AWS/api -> AWS/pg', 'AWS/api -> vendor', 'queue -> AWS/api']);
    expect(s.interfaces).toEqual(['vendor#charge']);
    expect(s.callSites).toEqual([]);
    expect(s.raw.nodes.find((n) => n.name === 'pg')).toMatchObject({ kind: 'database', description: 'desc pg' });
    const toVendor = s.raw.connections.find((c) => c.target_interface_id != null)!;
    expect(s.raw.interfaces.find((i) => i.id === toVendor.target_interface_id)?.name).toBe('charge');

    // O grafo de origem não muda.
    expect((await graph.getGraph(1)).nodes).toHaveLength(8);
  });

  // Regressão: na rápida, api→vendor e http→vendor (que implementa a primeira) se fundem numa conexão só,
  // que não pode implementar a si mesma.
  it('rápida: conexão resultante da fusão não implementa a si mesma', async () => {
    const src = await seedSource();
    const repoId = await addRepo('api', { depth: 'fast', nodeId: src.api.id });
    const g = await service.generateFromRepos({ name: 'Rápida', repoIds: [repoId], depth: 'fast' });
    const toVendor = (await graph.getGraph(g.id)).connections.find((c) => c.target_interface_id != null)!;
    expect(toVendor.parent_connection_id).not.toBe(toVendor.id);
  });

  it('média: repositório com módulos e tudo com que se comunica (1 salto), trechos e implements; aplica a proposta', async () => {
    const src = await seedSource();
    const repoId = await addRepo('api', { depth: 'medium', nodeId: src.api.id });
    const g = await service.generateFromRepos({ name: 'Média', description: 'minha', repoIds: [repoId], depth: 'medium' });
    expect(g.description).toBe('minha');
    expect(apply).toHaveBeenCalledWith(repoId, g.id);

    const s = await shape(g.id);
    expect(s.nodes).toEqual(['AWS', 'AWS/api', 'AWS/api/auth', 'AWS/api/http', 'AWS/pg', 'frontend', 'queue', 'vendor']);
    expect(s.connections).toEqual(['AWS/api -> vendor', 'AWS/api/auth -> AWS/pg', 'AWS/api/http -> vendor', 'frontend -> AWS/api/http', 'queue -> AWS/api']);
    expect(s.interfaces).toEqual(['frontend#ui', 'vendor#charge']);
    expect(s.callSites).toEqual(['src/db.ts', 'src/pay.ts']);
    const top = s.raw.connections.find((c) => c.source_id === s.raw.nodes.find((n) => n.name === 'api')!.id)!;
    const low = s.raw.connections.find((c) => c.source_id === s.raw.nodes.find((n) => n.name === 'http')!.id)!;
    expect(low.parent_connection_id).toBe(top.id);
  });

  it('completa exige análise completa e copia como a média', async () => {
    const src = await seedSource();
    const repoId = await addRepo('api', { depth: 'full', nodeId: src.api.id });
    const g = await service.generateFromRepos({ name: 'Completa', repoIds: [repoId], depth: 'full' });
    const s = await shape(g.id);
    expect(s.nodes).toHaveLength(8);
    expect(s.callSites).toEqual(['src/db.ts', 'src/pay.ts']);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('vários repositórios em grafos de origem diferentes: caixas e vizinhos em comum se fundem', async () => {
    const g2 = await graphRepo.create('Origem 2', null);
    const src1 = await seedSource(1);
    const src2 = await seedSource(g2.id);
    const r1 = await addRepo('api', { depth: 'medium', nodeId: src1.api.id });
    const r2 = await addRepo('api2', { depth: 'medium', nodeId: src2.api.id });
    const r3 = await addRepo('front', { depth: 'medium', nodeId: src1.frontend.id, proposal: false });
    const g = await service.generateFromRepos({ name: 'Junto', repoIds: [r1, r2, r3], depth: 'medium' });
    const s = await shape(g.id);
    // Mesmos nomes/caminhos não são duplicados.
    expect(new Set(s.nodes).size).toBe(s.nodes.length);
    expect(s.nodes).toEqual(['AWS', 'AWS/api', 'AWS/api/auth', 'AWS/api/http', 'AWS/pg', 'frontend', 'queue', 'vendor']);
    // frontend -> vendor entra porque o frontend também é um repositório escolhido.
    expect(s.connections).toContain('frontend -> vendor');
    expect(new Set(s.connections).size).toBe(s.connections.length);
    expect(new Set(s.interfaces).size).toBe(s.interfaces.length);
    // Sem proposta (r3) não aplica.
    expect(apply.mock.calls.map((c) => c[0])).toEqual([r1, r2]);
  });

  it('repositório sem nó entra só pela proposta, inclusive na rápida', async () => {
    const r = await addRepo('solto', { depth: 'fast' });
    const semProposta = await addRepo('vazio');
    const g = await service.generateFromRepos({ name: 'Solto', repoIds: [r, semProposta], depth: 'fast' });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(r, g.id);
    expect(g.nodeCount).toBe(0);
  });

  it('falha na aplicação da proposta desfaz o grafo criado', async () => {
    const src = await seedSource();
    const r = await addRepo('api', { depth: 'medium', nodeId: src.api.id });
    apply.mockRejectedValueOnce(new Error('proposta inválida'));
    await expect(service.generateFromRepos({ name: 'Quebrado', repoIds: [r], depth: 'medium' })).rejects.toThrow('proposta inválida');
    expect((await service.list()).map((x) => x.name)).toEqual(['Principal']);
    expect(changed).not.toHaveBeenCalled();
  });
});
