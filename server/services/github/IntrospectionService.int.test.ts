import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgresDatabase } from '../../infra/database/PostgresDatabase.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { FakeGithubClient, FakeLlm } from '../../../test/support/githubFakes.ts';
import { ActivityCollector } from './ActivityCollector.ts';
import type { IntrospectionProgress } from '../../../shared/types.ts';
import { EventBus } from '../../core/events/EventBus.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { Dependency, FreshnessResult, IPackageIntel, RuntimeSupport, VulnerabilityResult } from '../../infra/packages/IPackageIntel.ts';
import type { ISecureSettingsStore } from '../../repositories/contracts/ISecureSettingsStore.ts';
import { PgCallSiteRepository } from '../../repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../../repositories/postgres/PgConnectionRepository.ts';
import { PgGraphRepository } from '../../repositories/postgres/PgGraphRepository.ts';
import { PgInterfaceRepository } from '../../repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../../repositories/postgres/PgNodeRepository.ts';
import { PgRepoIntrospectionRepository } from '../../repositories/postgres/PgRepoIntrospectionRepository.ts';
import { PgRepoMetricsRepository } from '../../repositories/postgres/PgRepoMetricsRepository.ts';
import { CallSiteService } from '../CallSiteService.ts';
import { ConnectionService } from '../ConnectionService.ts';
import { GraphService } from '../GraphService.ts';
import { NodeService } from '../NodeService.ts';
import type { IDocumentService, UpsertDocumentData, UpsertOutcome } from '../contracts/index.ts';
import { CodeScanner } from './CodeScanner.ts';
import { GithubSettingsService } from './GithubSettingsService.ts';
import { IntrospectionService } from './IntrospectionService.ts';
import { ProcessCollector } from './ProcessCollector.ts';
import { QualityScorer } from './QualityScorer.ts';
import { CodeMapper, RepoAnalyzer } from './RepoAnalyzer.ts';
import { RepoCollector } from './RepoCollector.ts';

class MemorySecureStore implements ISecureSettingsStore {
  data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

/** Grava o documento direto na tabela (o RAG completo não é o foco aqui). */
class TableDocumentService implements IDocumentService {
  constructor(private readonly db: PostgresDatabase) {}
  async upsertData(d: UpsertDocumentData): Promise<UpsertOutcome> {
    const id = await this.db.insert(
      `INSERT INTO documents (path, title, source, content, hash) VALUES (?, ?, ?, ?, '') ON CONFLICT (path) DO UPDATE SET content = excluded.content RETURNING id`,
      [d.path, d.title ?? d.path, d.source, d.content],
    );
    return { id, status: 'created' };
  }
  list(): never {
    throw new Error('não usado');
  }
  get(): never {
    throw new Error('não usado');
  }
  upsert(): never {
    throw new Error('não usado');
  }
  importMany(): never {
    throw new Error('não usado');
  }
  delete(): never {
    throw new Error('não usado');
  }
  mentionsOfNode(): never {
    throw new Error('não usado');
  }
}

class FakeIntel implements IPackageIntel {
  fail = false;
  async vulnerabilities(deps: readonly Dependency[]): Promise<VulnerabilityResult> {
    if (this.fail) throw new Error('osv fora');
    return { affected: [{ dependency: `${deps[0]!.name}@${deps[0]!.version}`, ids: ['GHSA-x'] }] };
  }
  async freshness(): Promise<FreshnessResult> {
    if (this.fail) throw new Error('npm fora');
    return { averageLibyears: 0.3, measured: 1, outdated: 0 };
  }
  async runtimeSupport(): Promise<RuntimeSupport | null> {
    if (this.fail) throw new Error('eol fora');
    return { supported: true, eol: null, latest: '22.5.0' };
  }
}

const TOKEN = 'ghp_abcdefghijklmnop';
const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
const repoInfo = (name: string, over: Partial<{ archived: boolean; fork: boolean; pushedAt: string | null; defaultBranch: string }> = {}) => ({
  name,
  description: `Repo ${name}`,
  defaultBranch: 'main',
  language: 'TypeScript',
  archived: false,
  fork: false,
  pushedAt: recent,
  htmlUrl: `https://github.com/acme/${name}`,
  ...over,
});

const FILES = {
  'README.md': '# Orders\n\nServiço que recebe pedidos dos clientes e publica eventos para o faturamento da empresa.\n',
  'package.json': JSON.stringify({ dependencies: { express: '4.19.2', pg: '8.11.0' } }),
  '.nvmrc': '22',
  Dockerfile: 'FROM node:22',
  'src/config/aws.ts': 'export const q = "arn:aws:sqs:us-east-1:123456789012:orders-queue";\nprocess.env.DATABASE_URL',
  'src/payments/payflow.client.ts': ['export async function charge(v: number) {', '  return fetch("https://api.payflow.com/charge");', '}'].join('\n'),
  'src/orders/publisher.ts': [
    'export function publish(m: string) {',
    '',
    '',
    '  return sqs.send(new SendMessageCommand({ QueueUrl: "orders-queue" }));',
    '}',
  ].join('\n'),
};

let db: PostgresDatabase;
let github: FakeGithubClient;
let llm: FakeLlm;
let intel: FakeIntel;
let store: MemorySecureStore;
let settings: GithubSettingsService;
let repos: PgRepoIntrospectionRepository;
let metrics: PgRepoMetricsRepository;
let nodes: PgNodeRepository;
let connections: PgConnectionRepository;
let collector: RepoCollector;
let processCollector: ProcessCollector;
let service: IntrospectionService;

function build() {
  const events = new EventBus();
  repos = new PgRepoIntrospectionRepository(db);
  metrics = new PgRepoMetricsRepository(db);
  nodes = new PgNodeRepository(db);
  connections = new PgConnectionRepository(db);
  const interfaces = new PgInterfaceRepository(db);
  const callSites = new PgCallSiteRepository(db);
  const graphs = new PgGraphRepository(db);
  collector = new RepoCollector(github);
  processCollector = new ProcessCollector(github);
  service = new IntrospectionService(
    repos,
    metrics,
    settings,
    github,
    collector,
    processCollector,
    new ActivityCollector(github),
    new RepoAnalyzer(llm),
    new CodeScanner(github),
    new CodeMapper(llm),
    new QualityScorer(),
    intel,
    new GraphService(nodes, interfaces, connections, callSites),
    new NodeService(nodes, graphs, events),
    new ConnectionService(connections, nodes, interfaces, events),
    new CallSiteService(callSites, connections, events),
    nodes,
    connections,
    new TableDocumentService(db),
    db,
  );
}

async function configure(over: Partial<{ includeArchived: boolean; includeForks: boolean; pushedWithinMonths: number | null }> = {}) {
  await settings.update({ owner: 'acme', token: TOKEN, includeArchived: false, includeForks: false, pushedWithinMonths: 12, ...over });
}

async function waitIdle() {
  await vi.waitFor(
    async () => {
      expect(service.state().running).toBe(false);
      const list = await repos.list('acme');
      expect(list.some((r) => r.status === 'running' || r.status === 'pending')).toBe(false);
    },
    { timeout: 10_000, interval: 20 },
  );
}

async function analyzed(name = 'orders-api', input: { force?: boolean; depth?: 'fast' | 'medium' | 'full' } = {}) {
  await service.run({ repos: [name], force: input.force ?? false, depth: input.depth ?? 'medium' });
  await waitIdle();
  const r = (await repos.findByName('acme', name))!;
  return service.get(r.id);
}

beforeEach(async () => {
  db = await testDatabase();
  await resetDatabase(db);
  github = new FakeGithubClient(FILES);
  github.repos = [repoInfo('orders-api')];
  llm = new FakeLlm(false);
  intel = new FakeIntel();
  store = new MemorySecureStore();
  settings = new GithubSettingsService(store, github);
  build();
});

describe('IntrospectionService — configuração e sincronização', () => {
  it('sem configuração: lista vazia; get inexistente = 404', async () => {
    expect(await service.list()).toEqual([]);
    await expect(service.get(999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.sync()).rejects.toThrow('Configure a organização');
  });

  it('sync aplica os filtros (arquivados, forks, push recente) e remove os que sumiram', async () => {
    await configure();
    github.repos = [
      repoInfo('ativo'),
      repoInfo('arquivado', { archived: true }),
      repoInfo('fork', { fork: true }),
      repoInfo('velho', { pushedAt: '2020-01-01T00:00:00Z' }),
      repoInfo('nunca', { pushedAt: null }),
    ];
    expect((await service.sync()).map((r) => r.name)).toEqual(['ativo']);

    await configure({ includeArchived: true, includeForks: true, pushedWithinMonths: null });
    expect((await service.sync()).map((r) => r.name).sort()).toEqual(['arquivado', 'ativo', 'fork', 'nunca', 'velho']);

    github.repos = [repoInfo('ativo')];
    expect((await service.sync()).map((r) => r.name)).toEqual(['ativo']);
    expect((await service.list()).map((r) => r.name)).toEqual(['ativo']);
  });

  it('sync coleta a atividade (PRs abertos) e calcula a saúde', async () => {
    await configure({ includeArchived: true });
    const old = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const recent = new Date().toISOString();
    github.repos = [repoInfo('ativo'), repoInfo('arquivado', { archived: true })];
    github.openPulls = [
      {
        number: 7,
        author: 'ana',
        authorIsBot: false,
        title: 'Velho',
        body: '',
        createdAt: old,
        updatedAt: old,
        mergedAt: null,
        draft: false,
        url: 'https://gh/7',
      },
      { number: 8, author: 'bot', authorIsBot: true, title: 'Bump', body: '', createdAt: old, updatedAt: old, mergedAt: null, draft: false, url: null },
      { number: 9, author: 'ana', authorIsBot: false, title: 'Novo', body: '', createdAt: recent, updatedAt: recent, mergedAt: null, draft: true, url: null },
    ];
    const list = await service.sync();
    const ativo = list.find((r) => r.name === 'ativo')!;
    expect(ativo.activity).toMatchObject({ openPrs: 3, draftPrs: 1, oldPrs: 1, error: null });
    expect(ativo.activity?.pulls.map((p) => p.number)).toEqual([7]);
    expect(ativo.attention).toEqual({ level: 'attention', reasons: ['PR #7 aberto há 120 dias'] });
    // Arquivado não é consultado nem pede atenção.
    const arquivado = list.find((r) => r.name === 'arquivado')!;
    expect(arquivado.activity).toBeNull();
    expect(arquivado.attention.level).toBe('ok');

    github.openPulls = new Error('403 sem permissão');
    const again = (await service.sync()).find((r) => r.name === 'ativo')!;
    expect(again.activity).toMatchObject({ openPrs: null, error: '403 sem permissão' });
    expect(again.attention.level).toBe('ok');
  });

  it('start volta para pendente o que ficou rodando', async () => {
    await configure();
    await service.sync();
    const [r] = await service.list();
    await repos.setStatus(r!.id, 'running');
    await service.start();
    expect((await service.get(r!.id)).status).toBe('pending');
  });
});

describe('IntrospectionService — análise', () => {
  beforeEach(async () => {
    await configure();
    await service.sync();
  });

  it('analisa: fatos, fontes públicas, processo, nota, documento e proposta', async () => {
    const state = await service.run({ force: false, depth: 'medium' });
    expect(state).toMatchObject({ running: true, current: 'orders-api', queued: 0 });
    await waitIdle();
    const r = (await service.list())[0]!;
    const d = await service.get(r.id);
    expect(d.status).toBe('done');
    expect(d.analysisDepth).toBe('medium');
    expect(d.facts?.runtime).toEqual({ name: 'node', version: '22' });
    expect(d.facts?.intel).toEqual({
      vulnerabilities: [{ dependency: 'express@4.19.2', ids: ['GHSA-x'] }],
      freshness: { averageLibyears: 0.3, measured: 1, outdated: 0 },
      runtimeSupport: { supported: true, eol: null, latest: '22.5.0' },
    });
    expect(d.process?.windowDays).toBe(90);
    expect(d.analysis?.method).toBe('heuristic');
    expect(d.quality?.score).not.toBeNull();
    expect(d.history).toHaveLength(1);
    expect(d.proposal?.nodes.map((n) => n.key)).toEqual(['group', 'self', 'data:postgresql', 'res:sqs:orders-queue']);
    expect(d.documentId).not.toBeNull();
    const doc = await db.get<{ path: string; content: string }>('SELECT path, content FROM documents WHERE id = ?', [d.documentId]);
    expect(doc?.path).toBe('github/acme/orders-api.md');
    expect(doc?.content).toContain('# orders-api (repositório acme/orders-api)');
    expect(service.state()).toEqual({ running: false, queued: 0, current: null, done: 0, failed: 0, progress: [] });
  });

  it('sem dependências nem runtime e com falhas das fontes públicas e do processo', async () => {
    github.files = new Map([['README.md', '# x']]);
    intel.fail = true;
    vi.spyOn(processCollector, 'collect').mockRejectedValueOnce(new Error('api fora'));
    const d = await analyzed();
    expect(d.status).toBe('done');
    expect(d.facts?.intel).toEqual({ vulnerabilities: null, freshness: null, runtimeSupport: null });
    expect(d.process).toBeNull();

    github.files = new Map(Object.entries(FILES));
    const d2 = await analyzed('orders-api', { force: true });
    expect(d2.facts?.intel).toEqual({ vulnerabilities: null, freshness: null, runtimeSupport: null });
  });

  it('reaproveita a análise sem commit novo; força ou profundidade maior reanalisa', async () => {
    const spy = vi.spyOn(collector, 'collect');
    await analyzed();
    expect(spy).toHaveBeenCalledTimes(1);

    const reused = await analyzed();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reused.status).toBe('done');
    expect(reused.history).toHaveLength(2);

    await analyzed('orders-api', { depth: 'fast' });
    expect(spy).toHaveBeenCalledTimes(1);

    await analyzed('orders-api', { force: true });
    expect(spy).toHaveBeenCalledTimes(2);

    await analyzed('orders-api', { depth: 'full' });
    expect(spy).toHaveBeenCalledTimes(3);

    github.sha = 'b'.repeat(40);
    await analyzed();
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('não enfileira duas vezes o mesmo repositório e respeita a lista pedida', async () => {
    github.repos = [repoInfo('orders-api'), repoInfo('billing'), repoInfo('auth', { defaultBranch: 'develop' })];
    await service.sync();
    await service.run({ repos: ['orders-api', 'billing', 'auth'], force: false, depth: 'fast' });
    const state = await service.run({ repos: ['orders-api', 'billing', 'auth'], force: false, depth: 'fast' });
    expect(state.queued).toBe(1);
    expect(state.running).toBe(true);
    await waitIdle();
    expect((await service.list()).every((r) => r.status === 'done')).toBe(true);

    await service.run({ repos: ['nao-existe'], force: false, depth: 'fast' });
    expect(service.state().running).toBe(false);
  });

  it('erro na análise marca o repositório com a mensagem', async () => {
    github.headShaError = new Error('branch sumiu');
    const d = await analyzed();
    expect(d).toMatchObject({ status: 'error', error: 'branch sumiu' });
  });

  it('erro não-Error também vira mensagem', async () => {
    github.headSha = async () => {
      throw 'falhou feio';
    };
    const d = await analyzed();
    expect(d).toMatchObject({ status: 'error', error: 'falhou feio' });
  });

  it('repositório removido durante a fila é ignorado', async () => {
    const r = (await service.list())[0]!;
    const original = repos.findById.bind(repos);
    vi.spyOn(repos, 'findById').mockImplementationOnce(async () => null);
    await service.run({ force: false, depth: 'medium' });
    await vi.waitFor(() => expect(service.state().running).toBe(false));
    expect((await original(r.id))?.status).toBe('pending');
  });

  it('progresso: etapas da análise com contagem de arquivos e lotes do LLM', async () => {
    llm = new FakeLlm(true, [new Error('sem crédito'), { modules: [], calls: [] }]);
    build();
    const seen: IntrospectionProgress[] = [];
    const read = github.file.bind(github);
    vi.spyOn(github, 'file').mockImplementation(async (...args) => {
      seen.push(...service.state().progress);
      return read(...args);
    });
    await analyzed('orders-api', { depth: 'full' });
    const scanning = seen.filter((p) => p.stage === 'scanning');
    expect(seen.map((p) => p.stage)).toContain('collecting');
    expect(scanning.length).toBeGreaterThan(0);
    expect(scanning.at(-1)).toMatchObject({ repo: 'orders-api', depth: 'full', total: expect.any(Number) });
    expect(scanning.at(-1)!.done).toBeLessThanOrEqual(scanning.at(-1)!.total!);
    // Mesma etapa mantém o início da etapa; a análise inteira mantém o início geral.
    expect(new Set(scanning.map((p) => p.stageStartedAt)).size).toBe(1);
    expect(new Set(seen.map((p) => p.startedAt)).size).toBe(1);
    // Ao terminar, o progresso some.
    expect(service.state().progress).toEqual([]);
  });

  it('análise completa: varre o código e liga as chamadas aos destinos com os trechos', async () => {
    const d = await analyzed('orders-api', { depth: 'full' });
    expect(d.analysisDepth).toBe('full');
    expect(d.analysis?.notes.some((n) => n.startsWith('Varredura do código: '))).toBe(true);
    const mod = d.proposal?.nodes.find((n) => n.key === 'mod:orders');
    expect(mod).toMatchObject({ kind: 'module', parentKey: 'self' });
    const conn = d.proposal?.connections.find((c) => c.fromKey === 'mod:orders' && c.toKey === 'res:sqs:orders-queue');
    expect(conn).toBeDefined();
    expect(conn?.callSites?.[0]).toMatchObject({ file_path: 'src/orders/publisher.ts', line: 4, symbol: 'publish' });
  });

  it('falhas do LLM viram observações e cai na heurística', async () => {
    llm = new FakeLlm(true, [new Error('sem crédito'), new Error('sem crédito 2')]);
    build();
    const d = await analyzed('orders-api', { depth: 'full' });
    expect(d.analysis?.notes).toEqual(
      expect.arrayContaining([
        'Análise por LLM falhou (sem crédito); usado o modo heurístico.',
        'Mapeamento das chamadas por LLM falhou (sem crédito 2); usado o modo heurístico.',
      ]),
    );
    // Concluída, mas com aviso visível (campo error com status done).
    expect(d.status).toBe('done');
    expect(d.error).toBe('LLM falhou (sem crédito); análise feita só pela heurística, com menos detalhe.');
  });

  it('nova análise sem falha limpa o aviso', async () => {
    llm = new FakeLlm(true, [new Error('sem crédito')]);
    build();
    expect((await analyzed('orders-api', { depth: 'medium' })).error).toContain('sem crédito');
    llm = new FakeLlm(false);
    build();
    expect((await analyzed('orders-api', { depth: 'medium', force: true })).error).toBeNull();
  });

  it('arquivos fora do limite aparecem na observação da varredura', async () => {
    github.extraTree = [{ path: 'src/huge.ts', type: 'blob', size: 200_000 }];
    const d = await analyzed('orders-api', { depth: 'full' });
    expect(d.analysis?.notes.find((n) => n.startsWith('Varredura'))).toContain('1 arquivo(s) fora do limite');
  });

  it('repositório que já é um nó do grafo é ligado na hora', async () => {
    const nodeId = await db.insert("INSERT INTO nodes (graph_id, name, kind) VALUES (1, 'orders-api', 'service')");
    const d = await analyzed();
    expect(d.nodeId).toBe(nodeId);
    expect(d.proposal?.nodes.find((n) => n.key === 'self')?.existingId).toBe(nodeId);
  });
});

describe('IntrospectionService — aplicar no grafo', () => {
  beforeEach(async () => {
    await configure();
    await service.sync();
  });

  it('sem análise: 404', async () => {
    const r = (await service.list())[0]!;
    await expect(service.apply(r.id, 1)).rejects.toThrow('Este repositório ainda não foi analisado');
  });

  it('cria grupo, nó, módulos, recursos, conexões e trechos; reaplicar não duplica', async () => {
    const d = await analyzed('orders-api', { depth: 'full' });
    const result = await service.apply(d.id, 1);
    expect(result.nodesCreated).toBe(d.proposal!.nodes.length);
    expect(result.connectionsCreated).toBe(d.proposal!.connections.length);
    expect(result.callSitesCreated).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
    const after = await service.get(d.id);
    expect(after.appliedAt).not.toBeNull();
    const self = await nodes.findByParentAndName(1, (await nodes.findByParentAndName(1, null, 'GitHub — acme'))!.id, 'orders-api');
    expect(after.nodeId).toBe(self!.id);
    const sites = await db.all('SELECT * FROM call_sites');
    expect(sites.length).toBe(result.callSitesCreated);

    const again = await service.apply(d.id, 1);
    expect(again).toMatchObject({ nodesCreated: 0, connectionsCreated: 0, callSitesCreated: 0 });
  });

  it('em outro grafo: usa o homônimo de lá ou cria na raiz; nó apagado gera aviso', async () => {
    const existing = await db.insert("INSERT INTO nodes (graph_id, name, kind) VALUES (1, 'orders-api', 'service')");
    const d = await analyzed();
    const graph2 = await db.insert("INSERT INTO graphs (name) VALUES ('Outro')");

    const r1 = await service.apply(d.id, graph2);
    expect(r1.warnings).toEqual([]);
    const copy = (await nodes.findByGraph(graph2)).find((n) => n.name === 'orders-api');
    expect(copy?.parent_id).toBeNull();
    expect((await service.get(d.id)).nodeId).toBe(existing);

    const graph3 = await db.insert("INSERT INTO graphs (name) VALUES ('Terceiro')");
    const homonym = await db.insert("INSERT INTO nodes (graph_id, name, kind) VALUES (?, 'ORDERS-API', 'service')", [graph3]);
    const r2 = await service.apply(d.id, graph3);
    const self3 = (await nodes.findByGraph(graph3)).filter((n) => n.name.toLowerCase() === 'orders-api');
    expect(self3.map((n) => n.id)).toEqual([homonym]);
    // SQS + PostgreSQL (pela dependência pg).
    expect(r2.connectionsCreated).toBe(2);

    await db.run('DELETE FROM nodes WHERE id = ?', [existing]);
    const r3 = await service.apply(d.id, 1);
    expect(r3.warnings).toEqual(['Nó "orders-api" não existe mais; será criado']);
    expect(r3.nodesCreated).toBeGreaterThanOrEqual(1);
  });

  it('proposta com nó existente no mesmo grafo usa o id direto', async () => {
    const existing = await db.insert("INSERT INTO nodes (graph_id, name, kind) VALUES (1, 'orders-api', 'service')");
    const d = await analyzed();
    const res = await service.apply(d.id, 1);
    expect(res.warnings).toEqual([]);
    const conns = await connections.findAll();
    expect(conns.some((c) => c.source_id === existing)).toBe(true);
  });

  it('ignora conexões sem extremidades ou de um nó para ele mesmo', async () => {
    const d = await analyzed();
    await db.run('UPDATE repo_introspections SET proposal_json = ? WHERE id = ?', [
      JSON.stringify({
        nodes: [
          { key: 'self', existingId: null, name: 'solo', kind: 'service', tech: null, description: null, parentKey: null },
          { key: 'orfao', existingId: null, name: 'órfão', kind: 'service', tech: null, description: null, parentKey: 'inexistente' },
        ],
        connections: [
          { fromKey: 'self', toKey: 'self', protocol: 'http', description: null },
          { fromKey: 'self', toKey: 'nada', protocol: 'http', description: null },
        ],
      }),
      d.id,
    ]);
    const res = await service.apply(d.id, 1);
    expect(res).toMatchObject({ nodesCreated: 1, connectionsCreated: 0 });
  });
});

describe('IntrospectionService — refreshQuality', () => {
  beforeEach(async () => {
    await configure();
    await service.sync();
  });

  it('ignora repositório desconhecido ou sem análise', async () => {
    await service.refreshQuality('acme', 'nao-existe');
    await service.refreshQuality('acme', 'orders-api');
    const r = (await service.list())[0]!;
    expect((await service.get(r.id)).history).toHaveLength(0);
  });

  it('recalcula a nota com as métricas novas e atualiza o documento', async () => {
    const d = await analyzed();
    expect(d.quality?.categories.flatMap((c) => c.checks).find((c) => c.id === 'metrics-reported')?.status).toBe('fail');
    await metrics.insert({
      owner: 'acme',
      repo: 'orders-api',
      sha: 'x',
      ref: null,
      runUrl: 'https://ci/run/9',
      reportKeys: [],
      data: { coverage: { lines: 90, branches: 80 }, tests: {}, security: {}, tools: [], mutationScore: null, flakyRate: null, lint: null, warnings: [] },
    });
    await service.refreshQuality('ACME', 'Orders-Api');
    const after = await service.get(d.id);
    expect(after.quality?.categories.flatMap((c) => c.checks).find((c) => c.id === 'metrics-reported')?.status).toBe('pass');
    expect(after.history).toHaveLength(2);
    expect(after.metrics?.runUrl).toBe('https://ci/run/9');
    const doc = await db.get<{ content: string }>('SELECT content FROM documents WHERE path = ?', ['github/acme/orders-api.md']);
    expect(doc?.content).toContain('https://ci/run/9');
  });

  it('sem sha salvo usa vazio', async () => {
    const d = await analyzed();
    await db.run('UPDATE repo_introspections SET analyzed_sha = NULL WHERE id = ?', [d.id]);
    await service.refreshQuality('acme', 'orders-api');
    const doc = await db.get<{ content: string }>('SELECT content FROM documents WHERE path = ?', ['github/acme/orders-api.md']);
    expect(doc?.content).toContain('(commit ).');
  });
});
