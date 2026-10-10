import { describe, expect, it } from 'vitest';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { CodeScanner, enclosingBlock, findSurfaces, resourceOf, SCAN_MAX, topFolder } from './CodeScanner.ts';

const spaced = (lines: string[]) => lines.flatMap((l) => [l, '', '']).join('\n');

async function scan(files: Record<string, string>, list?: Array<{ path: string; size: number }>, setup: (g: FakeGithubClient) => void = () => {}) {
  const g = new FakeGithubClient(files);
  setup(g);
  const all = list ?? Object.entries(files).map(([path, text]) => ({ path, size: text.length }));
  return { result: await new CodeScanner(g).scan('acme', 'api', 'sha', 'tok', all), github: g };
}

describe('CodeScanner', () => {
  it('classifica cada tipo de chamada', async () => {
    const text = spaced([
      'await sqs.send(new SendMessageCommand({}));',
      'await redis.get("k");',
      'await s3.send(new PutObjectCommand({}));',
      'await client.send(new QueryCommand({}));',
      'const rows = await db.query("SELECT 1");',
      'const res = await fetch(url);',
      'const stripe = new Stripe(key);',
      'const nada = 1 + 1;',
    ]);
    const { result } = await scan({ 'src/a.ts': text });
    expect(result.sites.map((s) => s.kind)).toEqual(['queue', 'cache', 'storage', 'nosql', 'sql', 'http']);
    expect(result.sites.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.sites[0]).toMatchObject({ file: 'src/a.ts', line: 1 });
  });

  it('detecta chamadas de repositório de ORM (TypeORM/Nest) e do DataSource', async () => {
    const text = spaced([
      'const a = await this.animalsRepository.findOne({ where: { id } });',
      'await this.usersRepo.save(user);',
      'await this.dataSource.manager.transaction(fn);',
      'await dataSource.query("x");',
      'const repo = new AnimalsRepository();',
    ]);
    const { result } = await scan({ 'src/animals/animals.service.ts': text });
    expect(result.sites.map((s) => s.kind)).toEqual(['sql', 'sql', 'sql', 'sql']);
  });

  it('detecta SDKs', async () => {
    const { result } = await scan({ 'src/a.ts': 'const c = new Anthropic();' });
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]!.kind).toBe('sdk');
  });

  it('ignora comentários, imports e declarações', async () => {
    const text = spaced([
      '// await fetch(url)',
      '# requests.get(url)',
      ' * fetch(x)',
      '/* fetch(x) */',
      "import { fetch } from 'x';",
      'from requests import get',
      "require('axios')",
      'package fetch',
      'export async function fetch(url) {',
      'func Query(db *sql.DB) error {',
      'def fetch(url):',
      '  public void query(String q) {',
      '  private async execute(): Promise<void> {',
    ]);
    const { result } = await scan({ 'src/a.ts': text });
    expect(result.sites).toEqual([]);
  });

  it('associa o símbolo (função/método) mais recente', async () => {
    const text = [
      'export async function loadUser(id: string) {',
      '  return fetch(`/users/${id}`);',
      '}',
      '',
      '',
      'class Repo {',
      '  async save(entity: User): Promise<void> {',
      '    await this.repo.query("INSERT INTO users VALUES (1)");',
      '  }',
      '  if (x) {',
      '  }',
      '',
      '',
      '    await axios.get(url);',
      '}',
      'func (r *Repo) Find(ctx context.Context) {',
      '\tdb.QueryContext(ctx, "x")',
      '}',
      'def handler(event):',
      '    requests.post(url)',
      '',
      '',
      '  public String call(String x) {',
      '    restTemplate.getForObject(url, String.class); HttpClient',
    ].join('\n');
    const { result } = await scan({ 'src/a.ts': text });
    expect(result.sites.map((s) => [s.kind, s.symbol])).toEqual([
      ['http', 'loadUser'],
      ['sql', 'save'],
      ['http', 'save'],
      ['sql', 'Find'],
      ['http', 'handler'],
      ['http', 'call'],
    ]);
  });

  it('não repete a mesma chamada em linhas seguidas e limita 6 por arquivo', async () => {
    const consecutive = 'fetch(a)\nfetch(b)\nfetch(c)\nfetch(d)';
    expect((await scan({ 'a.ts': consecutive })).result.sites.map((s) => s.line)).toEqual([1, 4]);
    const many = spaced(Array.from({ length: 10 }, (_, i) => `fetch(${i})`));
    expect((await scan({ 'a.ts': many })).result.sites).toHaveLength(6);
  });

  it('o trecho tem contexto e segredos redigidos', async () => {
    const text = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const API_KEY = "abcdef12345";', 'await fetch(url);', 'x', 'y', 'z', 'w'].join('\n');
    const { result } = await scan({ 'a.ts': text });
    const snippet = result.sites[0]!.snippet;
    expect(snippet.split('\n')).toHaveLength(7);
    expect(snippet).toContain('API_KEY = "[redigido]"');
    expect(snippet).not.toContain('const a = 1;');
  });

  it('pula arquivos vazios, grandes ou ilegíveis e prioriza caminhos de integração', async () => {
    const { result, github } = await scan(
      { 'src/zz.ts': 'fetch(a)', 'src/payments/client.ts': 'fetch(b)', 'src/broken.ts': 'fetch(c)' },
      [
        { path: 'src/zz.ts', size: 10 },
        { path: 'src/payments/client.ts', size: 10 },
        { path: 'src/broken.ts', size: 10 },
        { path: 'src/empty.ts', size: 0 },
        { path: 'src/huge.ts', size: 120_001 },
        { path: 'src/missing.ts', size: 10 },
      ],
      (g) => g.failFiles.add('src/broken.ts'),
    );
    expect(github.fileReads[0]).toBe('src/payments/client.ts');
    expect(github.fileReads).not.toContain('src/empty.ts');
    expect(github.fileReads).not.toContain('src/huge.ts');
    expect(result.filesScanned).toBe(4);
    expect(result.filesSkipped).toBe(2);
    expect(result.sites.map((s) => s.file).sort()).toEqual(['src/payments/client.ts', 'src/zz.ts']);
    expect(result.folders.sort()).toEqual(['src', 'src/payments']);
  });

  it('lista vazia', async () => {
    const { result } = await scan({}, []);
    expect(result).toEqual({ filesScanned: 0, filesSkipped: 0, sites: [], surfaces: [], folders: [] });
  });

  it('respeita os limites de arquivos (300) e de chamadas (250)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 320; i++) files[`m${i}/f.ts`] = spaced(['fetch(1)']);
    const { result } = await scan(files);
    expect(result.sites.length).toBeLessThanOrEqual(250);
    expect(result.sites.length).toBeGreaterThan(200);
    expect(result.sites.at(-1)!.id).toBe(result.sites.length);
    expect(result.filesScanned).toBeLessThanOrEqual(300);
    expect(result.filesSkipped).toBe(320 - result.filesScanned);
    expect(result.folders).toHaveLength(40);
  });
});

describe('CodeScanner — análise máxima', () => {
  const max = (files: Record<string, string>) => {
    const g = new FakeGithubClient(files);
    const progress: Array<[number, number]> = [];
    const all = Object.entries(files).map(([path, text]) => ({ path, size: text.length }));
    return new CodeScanner(g).scan('acme', 'api', 'sha', 'tok', all, (d, t) => progress.push([d, t]), SCAN_MAX).then((r) => ({ r, progress }));
  };

  it('guarda o bloco inteiro da função, onde termina e o recurso usado; informa o progresso', async () => {
    const service = [
      'export class AnimalsService {',
      '  async findOne(id: number) {',
      '    const a = await this.animalsRepository.findOne({ where: { id } });',
      '    if (!a) throw new Error("x");',
      '    return a;',
      '  }',
      '}',
    ].join('\n');
    const { r, progress } = await max({ 'src/animals/animals.service.ts': service });
    expect(r.sites).toEqual([
      expect.objectContaining({ kind: 'sql', line: 3, symbol: 'findOne', endLine: 6, resource: 'animals', code: service.split('\n').slice(1, 6).join('\n') }),
    ]);
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // Completa (padrão) não guarda bloco nem recurso.
    const { result } = await scan({ 'src/animals/animals.service.ts': service });
    expect(result.sites[0]).toMatchObject({ code: null, endLine: null, resource: null });
  });

  it('acha rotas, consumidores e jobs com o código do handler', async () => {
    const nest = [
      "@Controller('pedidos')",
      'export class PedidosController {',
      "  @Get(':id')",
      '  find(@Param() p) {',
      '    return this.s.find(p.id);',
      '  }',
      '  @Post()',
      '  create(@Body() b) {',
      '    return this.s.create(b);',
      '  }',
      '}',
    ].join('\n');
    const { r } = await max({ 'src/pedidos/pedidos.controller.ts': nest });
    expect(r.surfaces.map((x) => [x.kind, x.name, x.line, x.endLine, x.symbol])).toEqual([
      ['http', 'GET /pedidos/:id', 3, 6, 'find'],
      ['http', 'POST /pedidos', 7, 10, 'create'],
    ]);
    expect(r.surfaces[0]!.code).toContain('return this.s.find(p.id);');
    expect(r.surfaces.map((x) => x.id)).toEqual([1, 2]);
  });

  it.each([
    ["router.post('/cobrancas', handler)", 'http', 'POST /cobrancas'],
    ['  @GetMapping("/clientes/{id}")', 'http', 'GET /clientes/{id}'],
    ['r.DELETE("/v1/itens/:id", h)', 'http', 'DELETE /v1/itens/:id'],
    ['mux.HandleFunc("/health", h)', 'http', 'ANY /health'],
    ["@router.get('/usuarios')", 'http', 'GET /usuarios'],
    ["@app.route('/legado')", 'http', 'ANY /legado'],
    ["@SqsMessageHandler('pedidos-criados', false)", 'consumer', 'pedidos-criados'],
    ["@EventPattern('pagamento.aprovado')", 'consumer', 'pagamento.aprovado'],
    ['@KafkaListener(topics = "telemetria")', 'consumer', 'telemetria'],
    ['@RabbitListener(queues = "emails")', 'consumer', 'emails'],
    ["await consumer.subscribe({ topic: 'eventos' })", 'consumer', 'eventos'],
    ["channel.consume('notificacoes', fn)", 'consumer', 'notificacoes'],
    ["new Worker('relatorios', fn)", 'consumer', 'relatorios'],
    ["@Cron('0 3 * * *')", 'job', '0 3 * * *'],
    ["cron.schedule('*/5 * * * *', fn)", 'job', '*/5 * * * *'],
    ['@Scheduled(fixedRate = 5000)', 'job', 'fixedRate = 5000'],
  ])('%s → %s %s', (line, kind, name) => {
    expect(findSurfaces('src/x.ts', line)).toEqual([expect.objectContaining({ kind, name, line: 1 })]);
  });

  it('prefixo de classe do Spring e handler Python pela indentação', () => {
    const spring = ['@RequestMapping("/api")', 'public class C {', '  @PostMapping("/itens")', '  public R add() {', '    return r;', '  }', '}'].join('\n');
    expect(findSurfaces('C.java', spring).map((x) => x.name)).toEqual(['POST /api/itens']);
    const py = ["@app.get('/saude')", 'def saude():', '    return {"ok": True}', '', 'x = 1'].join('\n');
    expect(findSurfaces('app.py', py)[0]).toMatchObject({ name: 'GET /saude', endLine: 3, symbol: 'saude' });
    // Sem chave nem indentação: janela curta.
    expect(findSurfaces('x.ts', "app.get('/a', h)")[0]).toMatchObject({ endLine: 1 });
  });

  it('bloco: janela sem declaração, chamada fora da função e função grande demais', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `l${i}`);
    expect(enclosingBlock('a.ts', lines, 50, null)).toEqual({ start: 40, end: 60 });
    // Declaração sem chave: cai na janela.
    expect(enclosingBlock('a.ts', lines, 50, 10)).toEqual({ start: 40, end: 60 });
    const big = ['function f() {', ...Array.from({ length: 300 }, () => 'x();'), '}'];
    expect(enclosingBlock('a.ts', big, 200, 0)).toEqual({ start: 160, end: 240 });
    const small = ['function f() {', 'x();', '}', 'y();'];
    expect(enclosingBlock('a.ts', small, 3, 0)).toEqual({ start: 0, end: 3 });
    expect(enclosingBlock('a.py', ['def f():', 'x = 1'], 1, 0)).toEqual({ start: 0, end: 1 });
    expect(enclosingBlock('a.py', ['def f():', 'y()', 'z()'], 2, 0)).toEqual({ start: 0, end: 2 });
  });

  it.each([
    ['sql', 'SELECT * FROM pedidos WHERE id = $1', 'pedidos'],
    ['sql', 'INSERT INTO "clientes" (a) VALUES (1)', 'clientes'],
    ['sql', 'UPDATE estoque SET qtd = 1', 'estoque'],
    ['sql', 'const r = getRepository(Pedido)', 'Pedido'],
    ['sql', 'await prisma.usuario.findMany()', 'usuario'],
    ['sql', 'await this.animalsRepository.save(a)', 'animals'],
    ['sql', 'db.query(sql)', null],
    ['http', "await axios.post('https://api.pagamentos.exemplo/cobrancas', b)", 'POST /cobrancas'],
    ['http', "fetch('/api/itens', { method: 'PUT' })", 'PUT /api/itens'],
    ['http', "fetch('https://exemplo.com')", 'GET /'],
    ['http', 'fetch(url)', null],
    ['queue', "new SendMessageCommand({ QueueUrl: 'pedidos', MessageBody: b })", 'pedidos'],
    ['queue', "channel.sendToQueue('emails', buf)", 'emails'],
    ['queue', "await fila.add('relatorio-mensal', dados)", 'relatorio-mensal'],
    ['storage', "new PutObjectCommand({ Bucket: 'imagens', Key: k })", 'imagens'],
    ['cache', "redis.get('k')", null],
  ] as const)('recurso %s: %s', (kind, text, expected) => {
    expect(resourceOf(kind, text)).toBe(expected);
  });
});

describe('topFolder', () => {
  it.each([
    ['src/payments/payflow.client.ts', 'src/payments'],
    ['internal/infra/sqs/x.go', 'internal/infra'],
    ['handlers/user.go', 'handlers'],
    ['main.go', null],
    ['src/index.ts', 'src'],
    ['apps/web/main.ts', 'apps/web'],
  ])('%s → %s', (path, expected) => {
    expect(topFolder(path)).toBe(expected);
  });
});
