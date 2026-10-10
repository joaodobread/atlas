import { describe, expect, it } from 'vitest';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { CodeScanner, topFolder } from './CodeScanner.ts';

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
    expect(result).toEqual({ filesScanned: 0, filesSkipped: 0, sites: [], folders: [] });
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
