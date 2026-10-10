import { describe, expect, it } from 'vitest';
import type { GraphNode, RepoFacts, RepoGraphProposal } from '../../../shared/types.ts';
import type { CodeMappingOutput, RepoAnalysisOutput } from '../../../shared/schemas.ts';
import { FakeLlm, makeFacts } from '../../../test/support/githubFakes.ts';
import type { CodeCallSite, CodeScanResult } from './CodeScanner.ts';
import { CodeMapper, RepoAnalyzer, dataStoresOf, type AnalyzerInput } from './RepoAnalyzer.ts';

let nextId = 1;
const node = (name: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id: nextId++,
  graph_id: 1,
  parent_id: null,
  name,
  kind: 'service',
  tech: null,
  icon: null,
  description: null,
  created_at: '',
  updated_at: '',
  ...over,
});

function graphOf(nodes: GraphNode[]): AnalyzerInput['graph'] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path = (n: GraphNode): string => (n.parent_id != null ? `${path(byId.get(n.parent_id)!)} / ${n.name}` : n.name);
  return { nodes, paths: new Map(nodes.map((n) => [n.id, path(n)])) };
}

function input(
  over: {
    facts?: Partial<RepoFacts>;
    readme?: string;
    description?: string | null;
    nodes?: GraphNode[];
    snippets?: Array<{ path: string; content: string }>;
  } = {},
): AnalyzerInput {
  return {
    owner: 'acme',
    name: 'orders-api',
    description: over.description === undefined ? null : over.description,
    collected: { facts: makeFacts(over.facts), snippets: over.snippets ?? [], readme: over.readme ?? '', sourceFiles: [], allCodeFiles: [] },
    graph: graphOf(over.nodes ?? []),
  };
}

const llmOut = (over: Partial<RepoAnalysisOutput> = {}): RepoAnalysisOutput => ({
  purpose: 'Gerencia pedidos',
  stack: 'Node',
  deploy: 'ECS',
  inbound: ['App'],
  outbound: ['Fila'],
  data: ['Postgres'],
  notes: [],
  matchedNode: null,
  resources: [],
  connections: [],
  ...over,
});

describe('RepoAnalyzer — LLM', () => {
  it('usa o LLM: casa o nó existente, cria recursos e conexões, descarta destinos inventados', async () => {
    const plataforma = node('Plataforma', { kind: 'project' });
    const api = node('Orders API', { parent_id: plataforma.id });
    const db = node('Orders DB', { parent_id: plataforma.id, kind: 'database', tech: 'postgres' });
    const dup1 = node('Duplicado');
    const dup2 = node('Duplicado');
    const llm = new FakeLlm(true, [
      llmOut({
        matchedNode: 'Plataforma / Orders API',
        resources: [
          { name: 'orders-queue', kind: 'queue', tech: 'sqs', description: 'Fila de pedidos' },
          { name: 'Orders-Queue', kind: 'queue', tech: '', description: '' },
          { name: 'Orders DB', kind: 'database', tech: '', description: '' },
          { name: 'Cache', kind: 'database', tech: '', description: '' },
        ],
        connections: [
          { direction: 'out', target: 'orders-queue', protocol: 'amqp', description: 'Publica pedidos' },
          { direction: 'out', target: 'ORDERS-QUEUE', protocol: 'amqp', description: 'dup' },
          { direction: 'in', target: 'Plataforma / Orders DB', protocol: 'sql', description: '' },
          { direction: 'out', target: 'Outro / Duplicado', protocol: 'http', description: 'ambíguo' },
          { direction: 'out', target: 'Inventado', protocol: 'http', description: 'x' },
          { direction: 'out', target: 'Sistema X / Orders DB', protocol: 'sql', description: 'por nome' },
        ],
      }),
    ]);
    const res = await new RepoAnalyzer(llm).analyze(input({ nodes: [plataforma, api, db, dup1, dup2], description: 'Pedidos' }));
    expect(res.llmError).toBeNull();
    expect(res.analysis).toEqual({
      purpose: 'Gerencia pedidos',
      stack: 'Node',
      deploy: 'ECS',
      inbound: ['App'],
      outbound: ['Fila'],
      data: ['Postgres'],
      notes: [],
      method: 'llm',
    });
    const keys = res.proposal.nodes.map((n) => n.key);
    expect(keys).toEqual(['group', 'self', 'res:orders-queue', 'res:orders db', 'res:cache', `node:${db.id}`]);
    expect(res.proposal.nodes.find((n) => n.key === 'self')).toMatchObject({ existingId: api.id, name: 'Orders API', parentKey: null });
    expect(res.proposal.nodes.find((n) => n.key === 'res:orders-queue')).toMatchObject({
      existingId: null,
      tech: 'sqs',
      description: 'Fila de pedidos',
      parentKey: 'group',
    });
    expect(res.proposal.nodes.find((n) => n.key === 'res:cache')).toMatchObject({ tech: null, description: null });
    expect(res.proposal.nodes.find((n) => n.key === 'res:orders db')).toMatchObject({ existingId: db.id });
    expect(res.proposal.connections).toEqual([
      { fromKey: 'self', toKey: 'res:orders-queue', protocol: 'amqp', description: 'Publica pedidos' },
      { fromKey: `node:${db.id}`, toKey: 'self', protocol: 'sql', description: null },
      { fromKey: 'self', toKey: `node:${db.id}`, protocol: 'sql', description: 'por nome' },
    ]);
    // Prompt com fatos, catálogo e descrição.
    const prompt = llm.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('Repositório: acme/orders-api — Pedidos');
    expect(prompt).toContain('- Plataforma / Orders DB [database, postgres]');
    expect(prompt).toContain('(sem README)');
    expect(prompt).toContain('(nenhum)');
    expect(llm.specs).toEqual(['repo_analysis']);
  });

  it('casa o próprio repositório pelo nome e poda o grupo quando nada novo é criado', async () => {
    const self = node('orders-api');
    const llm = new FakeLlm(true, [llmOut({ matchedNode: 'não existe' })]);
    const res = await new RepoAnalyzer(llm).analyze(input({ nodes: [self] }), 'full');
    expect(res.proposal.nodes.map((n) => n.key)).toEqual(['self']);
    expect(res.proposal.nodes[0]!.existingId).toBe(self.id);
  });

  it('prompt completo: fatos preenchidos, README e trechos limitados pelo orçamento', async () => {
    const llm = new FakeLlm(true, [llmOut()]);
    await new RepoAnalyzer(llm).analyze(
      input({
        readme: 'Leia-me',
        facts: {
          languages: ['Go'],
          frameworks: ['Gin'],
          runtime: { name: 'go', version: '1.22' },
          deploy: ['Docker'],
          envVars: ['A'],
          resources: [{ type: 'sqs', name: 'q' }],
          hosts: ['api.x.com'],
        },
        snippets: [
          { path: 'a.yml', content: 'a'.repeat(10_000) },
          { path: 'b.yml', content: 'b'.repeat(10_000) },
          { path: 'c.yml', content: 'c'.repeat(10) },
        ],
        nodes: [node('Sem tech')],
      }),
    );
    const prompt = llm.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('- Linguagens: Go');
    expect(prompt).toContain('- Runtime: go 1.22');
    expect(prompt).toContain('- Recursos AWS citados: sqs:q');
    expect(prompt).toContain('### a.yml');
    expect(prompt).toContain('### b.yml');
    expect(prompt).not.toContain('### c.yml');
    expect(prompt.match(/b+/g)!.some((m) => m.length === 8000)).toBe(true);
    expect(prompt).toContain('- Sem tech [service]');
  });

  it('falha do LLM cai na heurística e devolve o erro', async () => {
    const res = await new RepoAnalyzer(new FakeLlm(true, [new Error('timeout')])).analyze(input());
    expect(res.llmError).toBe('timeout');
    expect(res.analysis.method).toBe('heuristic');
    const res2 = await new RepoAnalyzer(new FakeLlm(true, ['falha crua'])).analyze(input());
    expect(res2.llmError).toBe('falha crua');
  });

  it('profundidade fast não chama o LLM', async () => {
    const llm = new FakeLlm(true, [llmOut()]);
    const res = await new RepoAnalyzer(llm).analyze(input(), 'fast');
    expect(llm.requests).toHaveLength(0);
    expect(res.analysis.method).toBe('heuristic');
    expect(res.llmError).toBeNull();
  });
});

describe('RepoAnalyzer — heurística', () => {
  it('propósito pela descrição, recursos AWS viram nós e conexões', async () => {
    const existing = node('Fila SQS orders-queue de pedidos', { kind: 'queue' });
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(
      input({
        description: 'Serviço de pedidos',
        nodes: [existing],
        facts: {
          languages: ['TypeScript', 'Go', 'Shell'],
          frameworks: ['NestJS', 'Prisma', 'Jest'],
          deploy: ['Docker', 'Terraform'],
          envVars: ['A', 'B'],
          hosts: ['api.parceiro.com'],
          resources: [
            { type: 'sqs', name: 'orders-queue' },
            { type: 'sns', name: 'events' },
            { type: 'dynamodb', name: 'users' },
            { type: 's3', name: 'uploads' },
            { type: 'lambda', name: 'worker' },
            { type: 'kinesis', name: 'stream' },
            { type: 'sqs', name: '${self:custom.q}' },
          ],
        },
      }),
    );
    expect(res.analysis).toMatchObject({
      purpose: 'Serviço de pedidos',
      stack: 'TypeScript, Go, NestJS, Prisma, Jest',
      deploy: 'Docker; Terraform',
      method: 'heuristic',
      notes: ['Variáveis de ambiente: A, B'],
    });
    expect(res.analysis.outbound).toContain('HTTP api.parceiro.com');
    expect(res.analysis.outbound).toContain('SQS orders-queue');
    const self = res.proposal.nodes.find((n) => n.key === 'self')!;
    expect(self).toMatchObject({ existingId: null, kind: 'service', tech: 'typescript / nestjs / prisma', parentKey: 'group' });
    expect(self.description).toBe('Serviço de pedidos (repositório acme/orders-api)');
    expect(res.proposal.nodes.find((n) => n.key === 'res:sqs:orders-queue')).toMatchObject({ existingId: existing.id });
    expect(res.proposal.nodes.find((n) => n.key === 'res:sns:events')).toMatchObject({ name: 'SNS events', kind: 'queue', tech: 'sns' });
    expect(res.proposal.nodes.find((n) => n.key === 'res:dynamodb:users')?.kind).toBe('database');
    expect(res.proposal.nodes.find((n) => n.key === 'res:s3:uploads')?.kind).toBe('infra');
    expect(res.proposal.nodes.find((n) => n.key === 'res:lambda:worker')?.kind).toBe('service');
    expect(res.proposal.nodes.some((n) => n.key.includes('kinesis') || n.key.includes('${'))).toBe(false);
    expect(res.proposal.connections.map((c) => [c.toKey, c.protocol])).toEqual([
      ['res:sqs:orders-queue', 'amqp'],
      ['res:sns:events', 'amqp'],
      ['res:dynamodb:users', 'nosql'],
      ['res:s3:uploads', 'file'],
      ['res:lambda:worker', 'function-call'],
    ]);
    expect(res.proposal.nodes[0]!.key).toBe('group');
  });

  it('propósito pelo primeiro parágrafo longo do README; sem nada = "Sem descrição."', async () => {
    const readme = '# Título\n\nCurto.\n\n## Seção\nEste serviço recebe pedidos dos clientes e publica eventos para o faturamento.\n';
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ readme }));
    expect(res.analysis.purpose).toBe('Este serviço recebe pedidos dos clientes e publica eventos para o faturamento.');
    expect(res.analysis.stack).toBe('TypeScript');
    const empty = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ facts: { languages: [], deploy: [] } }));
    expect(empty.analysis).toMatchObject({ purpose: 'Sem descrição.', stack: 'Não identificado', deploy: 'Não identificado', notes: [] });
    expect(empty.proposal.nodes.find((n) => n.key === 'self')?.tech).toBeNull();
  });

  it('tipo do nó próprio: infra e módulo', async () => {
    const infra = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ facts: { appType: 'infra' } }));
    expect(infra.proposal.nodes.find((n) => n.key === 'self')?.kind).toBe('infra');
    const lib = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ facts: { appType: 'library' } }));
    expect(lib.proposal.nodes.find((n) => n.key === 'self')?.kind).toBe('module');
  });

  it('repositório já no grafo pelo nome (sem acento/caixa) e sem recursos: grupo podado', async () => {
    const self = node('Orders-API');
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ nodes: [self] }));
    expect(res.proposal.nodes).toEqual([
      { key: 'self', existingId: self.id, name: 'Orders-API', kind: 'service', tech: null, description: null, parentKey: null },
    ]);
  });
});

describe('CodeMapper', () => {
  const site = (id: number, over: Partial<CodeCallSite> = {}): CodeCallSite => ({
    id,
    kind: 'http',
    file: 'src/payments/client.ts',
    line: id * 10,
    symbol: 'pay',
    snippet: 'await fetch(url)',
    code: null,
    endLine: null,
    resource: null,
    ...over,
  });
  const scan = (sites: CodeCallSite[]): CodeScanResult => ({ filesScanned: 1, filesSkipped: 0, sites, surfaces: [], folders: ['src/payments', 'src/orders'] });
  const baseProposal = (): RepoGraphProposal => ({
    nodes: [
      { key: 'group', existingId: null, name: 'GitHub — acme', kind: 'project', tech: 'github', description: null, parentKey: null },
      { key: 'self', existingId: null, name: 'orders-api', kind: 'service', tech: null, description: null, parentKey: 'group' },
      { key: 'res:payflow', existingId: null, name: 'PayFlow Gateway', kind: 'external', tech: null, description: null, parentKey: 'group' },
    ],
    connections: [{ fromKey: 'self', toKey: 'res:payflow', protocol: 'http', description: 'pagamento' }],
  });

  it('sem chamadas devolve a proposta como está', async () => {
    const p = baseProposal();
    const llm = new FakeLlm(true);
    const res = await new CodeMapper(llm).enrich(input(), p, scan([]));
    expect(res).toEqual({ proposal: p, llmError: null });
    expect(llm.requests).toHaveLength(0);
  });

  it('LLM: mapeia em lotes, cria módulos, liga a nós existentes e guarda os trechos', async () => {
    const plataforma = node('Plataforma', { kind: 'project' });
    const billing = node('Billing', { parent_id: plataforma.id });
    const sites = Array.from({ length: 65 }, (_, i) => site(i + 1));
    const batch1: CodeMappingOutput = {
      surfaces: [],
      modules: [
        { name: 'Pagamentos', path: 'src/payments', description: 'Cobranças' },
        { name: 'Pedidos', path: 'src/orders', description: '' },
      ],
      calls: [
        { site: 1, target: 'PayFlow Gateway', module: 'Pagamentos', protocol: 'http' },
        { site: 2, target: 'Externos / payflow gateway', module: 'pagamentos', protocol: 'http' },
        { site: 3, target: 'Plataforma / Billing', module: 'Pedidos', protocol: 'grpc' },
        { site: 4, target: 'plataforma/billing', module: 'Pedidos', protocol: 'grpc' },
        { site: 5, target: null, module: 'Pedidos', protocol: 'http' },
        { site: 6, target: 'Não existe', module: 'Pedidos', protocol: 'http' },
        { site: 999, target: 'PayFlow Gateway', module: 'Pedidos', protocol: 'http' },
        { site: 7, target: 'PayFlow Gateway', module: null, protocol: 'http' },
        { site: 8, target: 'PayFlow Gateway', module: 'Relatórios', protocol: 'http' },
      ],
    };
    const batch2: CodeMappingOutput = {
      surfaces: [],
      modules: [
        { name: 'PAGAMENTOS', path: 'x', description: 'repetido' },
        { name: 'Sem descrição', path: '', description: '' },
      ],
      calls: [{ site: 61, target: 'PayFlow Gateway', module: 'Sem descrição', protocol: 'http' }],
    };
    const llm = new FakeLlm(true, [batch1, batch2]);
    const res = await new CodeMapper(llm).enrich(input({ nodes: [plataforma, billing] }), baseProposal(), scan(sites));
    expect(res.llmError).toBeNull();
    expect(llm.requests).toHaveLength(2);
    expect(llm.specs).toEqual(['code_mapping', 'code_mapping']);
    expect(llm.requests[0]!.messages[0]!.content).toContain('- PayFlow Gateway [external]');
    expect(llm.requests[0]!.messages[0]!.content).toContain('- Plataforma / Billing [service]');
    expect(llm.requests[0]!.messages[0]!.content).toContain('### site 1 (http) src/payments/client.ts:10 em pay');

    const nodes = res.proposal.nodes;
    expect(nodes.find((n) => n.key === 'mod:pagamentos')).toMatchObject({ name: 'Pagamentos', kind: 'module', description: 'Cobranças', parentKey: 'self' });
    expect(nodes.find((n) => n.key === 'mod:pedidos')).toMatchObject({ description: 'Código em src/orders' });
    expect(nodes.find((n) => n.key === 'mod:relatorios')).toMatchObject({ name: 'Relatórios', description: null });
    expect(nodes.find((n) => n.key === 'mod:sem descricao')).toMatchObject({ description: null });
    expect(nodes.find((n) => n.key === `node:${billing.id}`)).toMatchObject({ existingId: billing.id });
    expect(nodes.filter((n) => n.key === `node:${billing.id}`)).toHaveLength(1);

    const conn = (from: string, to: string) => res.proposal.connections.find((c) => c.fromKey === from && c.toKey === to);
    expect(conn('mod:pagamentos', 'res:payflow')?.callSites).toEqual([
      { file_path: 'src/payments/client.ts', line: 10, symbol: 'pay', snippet: 'await fetch(url)' },
      { file_path: 'src/payments/client.ts', line: 20, symbol: 'pay', snippet: 'await fetch(url)' },
    ]);
    expect(conn('mod:pedidos', `node:${billing.id}`)).toMatchObject({ protocol: 'grpc' });
    expect(conn('mod:pedidos', `node:${billing.id}`)?.callSites).toHaveLength(2);
    expect(conn('self', 'res:payflow')).toMatchObject({ description: 'pagamento', callSites: [expect.objectContaining({ line: 70 })] });
    expect(conn('mod:sem descricao', 'res:payflow')?.callSites).toHaveLength(1);
    expect(res.proposal.connections).toHaveLength(5);
  });

  it('limita os trechos a 20 por conexão', async () => {
    const sites = Array.from({ length: 25 }, (_, i) => site(i + 1));
    const llm = new FakeLlm(true, [{ modules: [], calls: sites.map((s) => ({ site: s.id, target: 'PayFlow Gateway', module: null, protocol: 'http' })) }]);
    const res = await new CodeMapper(llm).enrich(input(), baseProposal(), scan(sites));
    expect(res.proposal.connections.find((c) => c.fromKey === 'self')?.callSites).toHaveLength(20);
  });

  it('falha do LLM cai no mapeamento heurístico', async () => {
    const res = await new CodeMapper(new FakeLlm(true, [new Error('quota')])).enrich(input(), baseProposal(), scan([site(1, { snippet: 'payflow.charge()' })]));
    expect(res.llmError).toBe('quota');
    expect(res.proposal.connections.find((c) => c.fromKey === 'mod:payments')?.toKey).toBe('res:payflow');
    const res2 = await new CodeMapper(new FakeLlm(true, ['texto'])).enrich(input(), baseProposal(), scan([site(1)]));
    expect(res2.llmError).toBe('texto');
  });

  it('heurística sem LLM: módulo pela pasta e destino pelo nome no trecho', async () => {
    const res = await new CodeMapper(new FakeLlm(false)).enrich(
      input(),
      baseProposal(),
      scan([
        site(1, { snippet: 'await PAYFLOW.charge()', kind: 'sdk' }),
        site(2, { snippet: 'await db.query()', kind: 'sql', file: 'src/orders/repo.ts' }),
        site(3, { snippet: 'gateway.call()', kind: 'queue', file: 'main.ts' }),
      ]),
    );
    expect(res.llmError).toBeNull();
    const mod = res.proposal.nodes.find((n) => n.key === 'mod:payments');
    expect(mod).toMatchObject({ name: 'payments', kind: 'module', description: null });
    expect(res.proposal.connections.find((c) => c.fromKey === 'mod:payments')).toMatchObject({ toKey: 'res:payflow', protocol: 'http' });
    expect(res.proposal.connections.find((c) => c.fromKey === 'self' && c.toKey === 'res:payflow')?.callSites).toEqual([
      { file_path: 'main.ts', line: 30, symbol: 'pay', snippet: 'gateway.call()' },
    ]);
    expect(res.proposal.nodes.some((n) => n.key === 'mod:orders')).toBe(false);
  });
});

describe('dataStoresOf', () => {
  it('motor pelo driver; ORM entra junto do banco SQL', () => {
    expect(dataStoresOf(['mysql2', 'typeorm', 'ioredis'])).toEqual([
      { name: 'MySQL', tech: 'mysql', kind: 'database', protocol: 'sql', deps: ['mysql2', 'typeorm'] },
      { name: 'Redis', tech: 'redis', kind: 'database', protocol: 'tcp', deps: ['ioredis'] },
    ]);
    expect(dataStoresOf(['github.com/jackc/pgx/v5', 'mongoose']).map((d) => d.name)).toEqual(['PostgreSQL', 'MongoDB']);
  });

  it('ORM sem driver conhecido vira banco genérico; nada vira vazio', () => {
    expect(dataStoresOf(['@prisma/client'])).toEqual([{ name: 'Banco de dados', tech: 'sql', kind: 'database', protocol: 'sql', deps: ['@prisma/client'] }]);
    expect(dataStoresOf([])).toEqual([]);
  });
});

describe('RepoAnalyzer — heurística de dados e README', () => {
  it('bancos das dependências viram nós ligados ao repositório', async () => {
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ facts: { dataStores: ['mysql2', 'typeorm'] } }));
    expect(res.analysis.data).toEqual(['MySQL']);
    expect(res.proposal.nodes.find((n) => n.key === 'data:mysql')).toMatchObject({
      name: 'MySQL (orders-api)',
      kind: 'database',
      tech: 'mysql',
      parentKey: 'group',
    });
    expect(res.proposal.connections).toContainEqual({ fromKey: 'self', toKey: 'data:mysql', protocol: 'sql', description: 'Detectado pelas dependências' });
  });

  it('banco já existente no grafo é reaproveitado', async () => {
    const db = node('MySQL', { kind: 'database' });
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ nodes: [db], facts: { dataStores: ['mysql2'] } }));
    expect(res.proposal.nodes.find((n) => n.key === 'data:mysql')?.existingId).toBe(db.id);
  });

  it('README: ignora HTML, imagens e o texto padrão de geradores', async () => {
    const readme = [
      '<p align="center"><a href="http://nestjs.com/"><img src="logo.svg" /></a></p>',
      '[circleci-image]: https://img.shields.io/x A progressive Node.js framework for building efficient and scalable server-side applications.',
      'API de gestão de fazendas: animais, baias e pesagens, com [multi-tenant](docs/tenant.md) por fazenda.',
    ].join('\n\n');
    const res = await new RepoAnalyzer(new FakeLlm(false)).analyze(input({ readme }));
    expect(res.analysis.purpose).toBe('API de gestão de fazendas: animais, baias e pesagens, com multi-tenant por fazenda.');
  });
});

describe('CodeMapper — destino pelo tipo da chamada', () => {
  it('chamada SQL sem nome no trecho vai para o único banco SQL; módulo leva o nome da pasta', async () => {
    const proposal: RepoGraphProposal = {
      nodes: [
        { key: 'self', existingId: null, name: 'orders-api', kind: 'service', tech: null, description: null, parentKey: null },
        { key: 'data:mysql', existingId: null, name: 'MySQL (orders-api)', kind: 'database', tech: 'mysql', description: null, parentKey: null },
      ],
      connections: [],
    };
    const site: CodeCallSite = {
      id: 1,
      kind: 'sql',
      file: 'src/animals/animals.service.ts',
      line: 3,
      symbol: 'findOne',
      snippet: 'this.animalsRepository.findOne()',
      code: null,
      endLine: null,
      resource: null,
    };
    const res = await new CodeMapper(new FakeLlm(false)).enrich(input(), proposal, {
      filesScanned: 1,
      filesSkipped: 0,
      sites: [site],
      surfaces: [],
      folders: [],
    });
    expect(res.proposal.nodes.find((n) => n.key === 'mod:animals')).toMatchObject({ name: 'animals', parentKey: 'self' });
    expect(res.proposal.connections).toEqual([
      {
        fromKey: 'mod:animals',
        toKey: 'data:mysql',
        protocol: 'sql',
        description: null,
        callSites: [{ file_path: site.file, line: 3, symbol: 'findOne', snippet: site.snippet }],
      },
    ]);
  });

  it('nome do repo no banco detectado não atrai chamadas de outro tipo', async () => {
    const proposal: RepoGraphProposal = {
      nodes: [
        { key: 'self', existingId: null, name: 'orders-api', kind: 'service', tech: null, description: null, parentKey: null },
        { key: 'data:mysql', existingId: null, name: 'MySQL (orders-api)', kind: 'database', tech: 'mysql', description: null, parentKey: null },
      ],
      connections: [],
    };
    const site: CodeCallSite = {
      id: 1,
      kind: 'http',
      file: 'src/orders/a.ts',
      line: 1,
      symbol: null,
      snippet: 'fetch("/orders")',
      code: null,
      endLine: null,
      resource: null,
    };
    const res = await new CodeMapper(new FakeLlm(false)).enrich(input(), proposal, {
      filesScanned: 1,
      filesSkipped: 0,
      sites: [site],
      surfaces: [],
      folders: [],
    });
    expect(res.proposal.connections).toEqual([]);
  });
});

describe('CodeMapper — análise máxima', () => {
  const proposal = (): RepoGraphProposal => ({
    nodes: [
      { key: 'self', existingId: null, name: 'orders-api', kind: 'service', tech: null, description: null, parentKey: null },
      { key: 'data:postgresql', existingId: null, name: 'PostgreSQL (orders-api)', kind: 'database', tech: 'postgresql', description: null, parentKey: null },
    ],
    connections: [],
  });
  const site = (id: number, o: Partial<CodeCallSite> = {}): CodeCallSite => ({
    id,
    kind: 'sql',
    file: 'src/orders/repo.ts',
    line: id,
    symbol: 'save',
    snippet: 'db.query(x)',
    code: 'async save() {\n  db.query(x)\n}',
    endLine: id + 2,
    resource: 'pedidos',
    ...o,
  });
  const surface = {
    id: 1,
    kind: 'http' as const,
    name: 'POST /pedidos',
    file: 'src/orders/controller.ts',
    line: 5,
    endLine: 9,
    symbol: 'create',
    code: 'create() {}',
  };
  const scanOf = (sites: CodeCallSite[]): CodeScanResult => ({ filesScanned: 2, filesSkipped: 0, sites, surfaces: [surface], folders: ['src/orders'] });

  it('LLM: blocos inteiros em lotes menores, interface e descrição por chamada, módulos das rotas', async () => {
    const sites = Array.from({ length: 16 }, (_, i) => site(i + 1));
    const llm = new FakeLlm(true, [
      {
        modules: [{ name: 'Pedidos', path: 'src/orders', description: 'Pedidos dos clientes' }],
        surfaces: [],
        calls: sites.slice(0, 15).map((x) => ({
          site: x.id,
          target: 'PostgreSQL (orders-api)',
          module: 'Pedidos',
          protocol: 'sql',
          interface: 'pedidos',
          description: 'grava o pedido',
        })),
      },
      {
        modules: [],
        surfaces: [],
        calls: [{ site: 16, target: 'PostgreSQL (orders-api)', module: 'Pedidos', protocol: 'sql', interface: null, description: null }],
      },
      { modules: [], calls: [], surfaces: [{ surface: 1, module: 'Pedidos', description: 'cria um pedido' }] },
    ]);
    const progress: Array<[number, number]> = [];
    const res = await new CodeMapper(llm).enrich(input(), proposal(), scanOf(sites), (d, t) => progress.push([d, t]), true);
    expect(res.llmError).toBeNull();
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[0]!.messages[0]!.content).toContain('### site 1 (sql) src/orders/repo.ts:1-3 em save — recurso: pedidos\nasync save()');
    expect(llm.requests[2]!.messages[0]!.content).toContain('### surface 1 (http) POST /pedidos — src/orders/controller.ts:5-9');
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    const conns = res.proposal.connections;
    // Interface do LLM; sem ela, o recurso lido do código.
    expect(conns.map((c) => [c.fromKey, c.toKey, c.interface, c.description, c.callSites?.length])).toEqual([
      ['mod:pedidos', 'data:postgresql', 'pedidos', 'grava o pedido', 16],
    ]);
    expect(conns[0]!.callSites![0]).toEqual({
      file_path: 'src/orders/repo.ts',
      line: 1,
      symbol: 'save',
      snippet: 'db.query(x)',
      end_line: 3,
      code: 'async save() {\n  db.query(x)\n}',
    });
    expect(res.proposal.nodes.find((n) => n.key === 'mod:pedidos')?.interfaces).toEqual([
      { name: 'POST /pedidos', type: 'http', description: 'cria um pedido', spec: 'src/orders/controller.ts:5-9 (create)' },
    ]);
  });

  it('sem LLM: interface pelo recurso lido do código e módulo das rotas pela pasta (sem repetir)', async () => {
    const scan: CodeScanResult = {
      ...scanOf([site(1), site(2, { resource: 'itens' }), site(3, { resource: null })]),
      surfaces: [
        surface,
        { ...surface, id: 2 },
        { ...surface, id: 3, kind: 'job', name: '0 3 * * *', endLine: null, symbol: null },
        { ...surface, id: 4, file: 'main.ts' },
      ],
    };
    const res = await new CodeMapper(new FakeLlm(false)).enrich(input(), proposal(), scan, undefined, true);
    expect(res.proposal.connections.map((c) => c.interface ?? null)).toEqual(['pedidos', 'itens', null]);
    expect(res.proposal.nodes.find((n) => n.key === 'mod:orders')?.interfaces).toEqual([
      { name: 'POST /pedidos', type: 'http', description: null, spec: 'src/orders/controller.ts:5-9 (create)' },
      { name: '0 3 * * *', type: 'job', description: null, spec: 'src/orders/controller.ts:5' },
    ]);
    // Rota fora de pasta cai no próprio repositório, que já existe na proposta mas não é módulo novo: ganha a interface também.
    expect(res.proposal.nodes.find((n) => n.key === 'self')?.interfaces).toEqual([expect.objectContaining({ name: 'POST /pedidos' })]);
  });

  it('só rotas (sem chamadas) também passa pelo mapeamento; superfície desconhecida e nó existente são ignorados', async () => {
    const existing = proposal();
    existing.nodes[0] = { ...existing.nodes[0]!, existingId: 9 };
    const scan: CodeScanResult = { filesScanned: 1, filesSkipped: 0, sites: [], surfaces: [{ ...surface, file: 'main.ts' }], folders: [] };
    const llm = new FakeLlm(true, [
      {
        modules: [],
        calls: [],
        surfaces: [
          { surface: 1, module: null, description: null },
          { surface: 99, module: 'X', description: null },
        ],
      },
    ]);
    const res = await new CodeMapper(llm).enrich(input(), existing, scan, undefined, true);
    expect(res.proposal.nodes[0]!.interfaces).toBeUndefined();
    expect(res.proposal.nodes.some((n) => n.key === 'mod:x')).toBe(false);
  });
});
