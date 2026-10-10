import type { RepoFacts, WorkflowAudit } from '../../../shared/types.ts';
import type { GithubTreeEntry, IGithubClient } from '../../infra/github/IGithubClient.ts';
import { redactSecrets } from './redactSecrets.ts';

export interface RepoRef {
  owner: string;
  name: string;
  sha: string;
  branch: string;
  token: string;
  description: string | null;
}

export interface CollectedRepo {
  facts: RepoFacts;
  /** Trechos de arquivos (já sem segredos) para o LLM: caminho → conteúdo truncado. */
  snippets: Array<{ path: string; content: string }>;
  readme: string;
  /** Arquivos de código (sem testes), para a varredura da análise completa. */
  sourceFiles: Array<{ path: string; size: number }>;
  /** Análise máxima: todo arquivo de código do repositório (só ficam de fora testes, mocks/fixtures e dependências/builds). */
  allCodeFiles: Array<{ path: string; size: number }>;
}

const MAX_SNIPPET = 6_000;
const MAX_CONFIG_FILES = 25;
const MAX_CONFIG_SIZE = 60_000;
const MAX_WORKFLOWS = 15;
const BINARY = /\.(exe|dll|so|dylib|jar|war|ear|class|pyc|pyo|msi|deb|rpm|whl|o|a|apk|ipa)$/i;
const DATA_STORE_DEPS =
  /^(pg|postgres|mysql2?|mariadb|mongodb|mongoose|redis|ioredis|iovalkey|@valkey\/[\w-]+|@prisma\/client|prisma|typeorm|drizzle-orm|knex|sequelize|better-sqlite3|cassandra-driver|@aws-sdk\/client-dynamodb|github\.com\/(jackc\/pgx|lib\/pq|go-sql-driver\/mysql|redis\/go-redis|valkey-io\/[\w-]+|go-gorm\/gorm|jmoiron\/sqlx|go-jet\/jet|mongodb\/mongo-go-driver|aws\/aws-sdk-go-v2\/service\/dynamodb)(\/.*)?|gorm\.io\/[\w/]+)$/;
const HARNESS_DEPS = /testcontainers/;
/** Extensões de código lidas pela análise máxima. */
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|go|java|kt|kts|scala|groovy|py|rb|cs|php|rs|swift|dart|ex|exs)$/;
/** Frameworks de servidor: o repositório é um serviço, mesmo sem Dockerfile. */
const SERVER_FRAMEWORKS = [
  'NestJS',
  'Express',
  'Fastify',
  'Koa',
  'Hono',
  'Spring Boot',
  'Django',
  'FastAPI',
  'Flask',
  'Gin',
  'Echo',
  'Fiber',
  'Rails',
  'Laravel',
];

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$|_test\.py$|Test\.(java|kt)$/;
const E2E = /(^|\/)(e2e|cypress|playwright)(\/|\.config)|playwright\.config|cypress\.config|detox/;
const CONFIG_SOURCE = /(^|\/)(config|configs|env|settings|constants|infra|adapters|clients|providers)(\/|\.)[^/]*\.(ts|js|mjs|go|kt|java|py|ya?ml)$/i;

/** Lê a árvore e alguns arquivos-chave do repositório e extrai fatos sem LLM. */
export class RepoCollector {
  constructor(private readonly github: IGithubClient) {}

  async collect(ref: RepoRef): Promise<CollectedRepo> {
    const tree = (await this.github.tree(ref.owner, ref.name, ref.sha, ref.token)).filter(
      (e) => !/(^|\/)(node_modules|vendor|dist|build|\.git)\//.test(e.path),
    );
    const blobs = tree.filter((e) => e.type === 'blob');
    const paths = new Set(blobs.map((b) => b.path));
    const read = (path: string) => this.github.file(ref.owner, ref.name, ref.sha, path, ref.token).catch(() => null);

    const readmePath = blobs.find((b) => /^readme(\.md|\.rst|\.txt)?$/i.test(b.path))?.path;
    const keyFiles = [
      'package.json',
      'go.mod',
      'build.gradle.kts',
      'build.gradle',
      'pom.xml',
      'requirements.txt',
      'pyproject.toml',
      'Gemfile',
      'oni.yaml',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yaml',
      '.nvmrc',
      '.node-version',
      'app.json',
      'serverless.yml',
      'serverless.ts',
      'serverless-dnx.yml',
      'serverless-db.yml',
      'bitbucket-pipelines.yml',
      'CLAUDE.md',
      'AGENTS.md',
      '.env.example',
      '.env.sample',
    ].filter((p) => paths.has(p));
    const workflows = blobs.filter((b) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(b.path)).map((b) => b.path);
    const configSources = blobs
      .filter((b) => CONFIG_SOURCE.test(b.path) && b.size < MAX_CONFIG_SIZE && !TEST_FILE.test(b.path))
      .slice(0, MAX_CONFIG_FILES)
      .map((b) => b.path);

    const contents = new Map<string, string>();
    await Promise.all(
      [...(readmePath ? [readmePath] : []), ...keyFiles, ...workflows.slice(0, MAX_WORKFLOWS), ...configSources].map(async (p) => {
        const text = await read(p);
        if (text != null) contents.set(p, p.startsWith('.env') ? envNamesOnly(text) : text);
      }),
    );
    const lock = paths.has('package-lock.json') ? await read('package-lock.json') : null;
    const [details, rules] = await Promise.all([
      this.github.repoDetails(ref.owner, ref.name, ref.token).catch(() => null),
      this.github.branchRules(ref.owner, ref.name, ref.branch, ref.token).catch(() => null),
    ]);
    const goSum = paths.has('go.mod');

    const pkg = parseJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: { node?: string };
      scripts?: Record<string, string>;
    }>(contents.get('package.json'));
    const goMod = contents.get('go.mod') ?? '';
    const allText = [...contents.entries()]
      .filter(([p]) => p !== readmePath)
      .map(([, t]) => t)
      .join('\n');

    const facts: RepoFacts = {
      languages: languagesOf(blobs),
      manifests: keyFiles.filter((p) => /package\.json|go\.mod|gradle|pom\.xml|requirements|pyproject|Gemfile/.test(p)),
      frameworks: frameworksOf(pkg, goMod, contents),
      runtime: runtimeOf(pkg, goMod, contents),
      deploy: deployOf(paths, contents, workflows),
      workflows: workflows.map((w) => w.replace('.github/workflows/', '')),
      envVars: envVarsOf(allText),
      resources: resourcesOf(allText),
      hosts: hostsOf(allText),
      testFiles: blobs.filter((b) => TEST_FILE.test(b.path)).length,
      e2e: blobs.some((b) => E2E.test(b.path)) || /playwright|cypress|detox/.test(JSON.stringify(pkg?.devDependencies ?? {})),
      lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'go.sum', 'Gemfile.lock', 'poetry.lock', 'gradle.lockfile'].filter((p) =>
        paths.has(p),
      ),
      updateAutomation:
        ['renovate.json', '.github/renovate.json', 'renovate.json5', '.github/dependabot.yml', '.github/dependabot.yaml'].find((p) => paths.has(p)) ?? null,
      lintConfig: blobs
        .map((b) => b.path)
        .filter((p) =>
          /^(\.eslintrc(\.\w+)?|eslint\.config\.\w+|biome\.json|oxlint\.json|\.golangci\.ya?ml|staticcheck\.conf|\.prettierrc(\.\w+)?|detekt\.yml|ruff\.toml)$/.test(
            p,
          ),
        ),
      hasCodeowners: ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'].some((p) => paths.has(p)),
      readmeChars: readmePath ? (contents.get(readmePath)?.length ?? 0) : 0,
      hasChangelog: paths.has('CHANGELOG.md'),
      committedEnvFiles: blobs.map((b) => b.path).filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|template|dist)$/.test(p)),
      dependencies: [...npmDeps(pkg, lock), ...(goSum ? goDeps(goMod) : [])],
      appType: 'unknown',
      intel: { vulnerabilities: null, freshness: null, runtimeSupport: null },
      workflowAudit: auditWorkflows(
        workflows.slice(0, MAX_WORKFLOWS).map((w) => ({ path: w, text: contents.get(w) ?? '' })),
        ref.owner,
        workflows.length,
      ),
      binaryFiles: blobs
        .map((b) => b.path)
        .filter((p) => BINARY.test(p))
        .slice(0, 20),
      docFiles: {
        security: ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md'].some((p) => paths.has(p)),
        agents: ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'].some((p) => paths.has(p)),
        envExample: ['.env.example', '.env.sample', '.env.template'].some((p) => paths.has(p)),
        contributing: ['CONTRIBUTING.md', '.github/CONTRIBUTING.md'].some((p) => paths.has(p)),
      },
      dataStores: [],
      realDependencyHarness: null,
      github: { topics: details?.topics ?? null, secretScanning: details?.secretScanning ?? null, branchRules: rules },
    };
    const depNames = [...Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }), ...goModules(goMod)];
    facts.dataStores = [...new Set(depNames.filter((d) => DATA_STORE_DEPS.test(d)))];
    facts.realDependencyHarness = depNames.some((d) => HARNESS_DEPS.test(d))
      ? 'testcontainers'
      : blobs.some((b) => /(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(b.path))
        ? 'docker compose'
        : workflows.some((w) => /^\s{2,}services:\s*$/m.test(contents.get(w) ?? ''))
          ? 'services no CI'
          : null;
    facts.appType = appTypeOf(facts, pkg, paths);

    const snippetOrder = [...keyFiles, ...configSources, ...workflows.slice(0, 3)];
    return {
      facts,
      readme: redactSecrets((readmePath ? contents.get(readmePath) : '') ?? '').slice(0, MAX_SNIPPET * 2),
      sourceFiles: blobs
        .filter(
          (b) =>
            /\.(ts|tsx|js|mjs|cjs|go|java|kt|py|rb|cs|php)$/.test(b.path) &&
            !TEST_FILE.test(b.path) &&
            !/\.d\.ts$|(^|\/)(migrations?|seeds?|scripts|docs|examples?|fixtures|mocks?|__mocks__|generated|old)\//.test(b.path),
        )
        .map((b) => ({ path: b.path, size: b.size })),
      allCodeFiles: blobs
        .filter(
          (b) =>
            CODE_FILE.test(b.path) &&
            !TEST_FILE.test(b.path) &&
            !/\.d\.ts$|(^|\/)(fixtures?|mocks?|__mocks__|node_modules|vendor|dist|build|\.next|target)\//.test(b.path),
        )
        .map((b) => ({ path: b.path, size: b.size })),
      snippets: snippetOrder.filter((p) => contents.has(p)).map((p) => ({ path: p, content: redactSecrets(contents.get(p)!).slice(0, MAX_SNIPPET) })),
    };
  }
}

/** De um .env.example, só os nomes (valores podem ser reais). */
const envNamesOnly = (text: string) =>
  text
    .split('\n')
    .map((l) => /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(l)?.[1])
    .filter(Boolean)
    .map((n) => `${n}=`)
    .join('\n');

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  py: 'Python',
  rb: 'Ruby',
  swift: 'Swift',
  m: 'Objective-C',
  tf: 'Terraform',
  cs: 'C#',
  php: 'PHP',
  rs: 'Rust',
  sql: 'SQL',
  sh: 'Shell',
};

function languagesOf(blobs: GithubTreeEntry[]): string[] {
  const bytes = new Map<string, number>();
  for (const b of blobs) {
    const lang = EXT_LANG[b.path.split('.').pop() ?? ''];
    if (lang) bytes.set(lang, (bytes.get(lang) ?? 0) + b.size);
  }
  return [...bytes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => l);
}

const FRAMEWORKS: Array<[RegExp, string]> = [
  [/^@nestjs\/core$/, 'NestJS'],
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^react-native$/, 'React Native'],
  [/^next$/, 'Next.js'],
  [/^react$/, 'React'],
  [/^vite$/, 'Vite'],
  [/^vue$/, 'Vue'],
  [/^@angular\/core$/, 'Angular'],
  [/^typeorm$/, 'TypeORM'],
  [/^prisma$|^@prisma\/client$/, 'Prisma'],
  [/^bullmq$/, 'BullMQ'],
  [/^socket\.io$/, 'Socket.IO'],
  [/^serverless$/, 'Serverless'],
  [/^@aws-sdk\/client-sqs$|^aws-sdk$/, 'AWS SDK'],
  [/^@opentelemetry\/sdk-node$/, 'OpenTelemetry'],
  [/^jest$/, 'Jest'],
  [/^vitest$/, 'Vitest'],
  [/^@playwright\/test$/, 'Playwright'],
  [/^cypress$/, 'Cypress'],
];

function frameworksOf(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null,
  goMod: string,
  contents: Map<string, string>,
): string[] {
  const out = new Set<string>();
  for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })) for (const [re, label] of FRAMEWORKS) if (re.test(name)) out.add(label);
  const goFw: Array<[string, string]> = [
    ['gin-gonic/gin', 'Gin'],
    ['labstack/echo', 'Echo'],
    ['gofiber/fiber', 'Fiber'],
    ['go-chi/chi', 'Chi'],
    ['go-jet/jet', 'Jet'],
    ['pressly/goose', 'goose'],
    ['aws/aws-sdk-go', 'AWS SDK'],
    ['gorilla/websocket', 'Gorilla WebSocket'],
    ['valkey-io', 'Valkey'],
    ['redis/go-redis', 'Redis'],
    ['jackc/pgx', 'pgx'],
  ];
  for (const [mod, label] of goFw) if (goMod.includes(mod)) out.add(label);
  const gradle = (contents.get('build.gradle.kts') ?? '') + (contents.get('build.gradle') ?? '') + (contents.get('pom.xml') ?? '');
  if (/spring-boot/.test(gradle)) out.add('Spring Boot');
  if (/spring-cloud-aws|io\.awspring/.test(gradle)) out.add('Spring Cloud AWS');
  return [...out];
}

function runtimeOf(pkg: { engines?: { node?: string } } | null, goMod: string, contents: Map<string, string>): RepoFacts['runtime'] {
  const go = /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(goMod)?.[1];
  if (go) return { name: 'go', version: go };
  const nvmrc = (contents.get('.nvmrc') ?? contents.get('.node-version') ?? '').trim().replace(/^v/, '');
  const dockerNode = /FROM\s+(?:[\w./-]*\/)?node:(\d+(?:\.\d+)*)/i.exec(contents.get('Dockerfile') ?? '')?.[1];
  const engines = /(\d+)(?:\.\d+)*/.exec(pkg?.engines?.node ?? '')?.[0];
  const node = /^\d/.test(nvmrc) ? nvmrc : (dockerNode ?? engines);
  if (node) return { name: 'node', version: node };
  const java =
    /FROM\s+[\w./-]*(?:jdk|jre|temurin|corretto)[\w.-]*:(\d+)/i.exec(contents.get('Dockerfile') ?? '')?.[1] ??
    /JavaLanguageVersion\.of\((\d+)\)|jvmToolchain\((\d+)\)/
      .exec(contents.get('build.gradle.kts') ?? '')
      ?.slice(1)
      .find(Boolean);
  if (java) return { name: 'java', version: java };
  const py = /FROM\s+python:(\d+\.\d+)/i.exec(contents.get('Dockerfile') ?? '')?.[1];
  if (py) return { name: 'python', version: py };
  return null;
}

function deployOf(paths: Set<string>, contents: Map<string, string>, workflows: string[]): string[] {
  const out: string[] = [];
  const oni = contents.get('oni.yaml');
  if (oni) {
    const cluster = /cluster(?:_name)?:\s*["']?([\w.-]+)/i.exec(oni)?.[1];
    const type = /\b(deploy-static|worker|service)\b/.exec(oni)?.[1];
    out.push(`ECS via oni${type ? ` (${type})` : ''}${cluster ? ` — cluster ${cluster}` : ''}`);
  }
  for (const f of ['serverless.yml', 'serverless.ts', 'serverless-dnx.yml']) if (paths.has(f)) out.push(`Serverless Framework (${f})`);
  if (paths.has('Dockerfile')) out.push('Docker');
  if ([...paths].some((p) => p.endsWith('.tf'))) out.push('Terraform');
  if ([...paths].some((p) => /Pulumi\.ya?ml$/.test(p))) out.push('Pulumi');
  if (paths.has('app.json') && [...paths].some((p) => p.startsWith('android/') || p.startsWith('ios/'))) out.push('App mobile (Android/iOS)');
  const wf = workflows.map((w) => contents.get(w) ?? '').join('\n');
  if (/aws s3 sync/.test(wf)) out.push('Site estático em S3 (aws s3 sync)');
  if (paths.has('bitbucket-pipelines.yml')) out.push('Bitbucket Pipelines');
  return out;
}

function envVarsOf(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g,
    /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
    /env(?:conf)?:"([A-Z][A-Z0-9_]{2,})/g,
    /\$\{env:([A-Z][A-Z0-9_]{2,})/g,
    /System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g,
    /^\s*([A-Z][A-Z0-9_]{2,})=$/gm,
    /configService\.get(?:<[^>]+>)?\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) names.add(m[1]!);
  return [...names].sort().slice(0, 200);
}

function resourcesOf(text: string): RepoFacts['resources'] {
  const out = new Map<string, { type: string; name: string }>();
  const add = (type: string, name: string) => out.set(`${type}:${name}`, { type, name });
  for (const m of text.matchAll(/arn:aws:(sqs|sns|lambda|dynamodb|s3):[\w-]*:[\d*]*:([\w.:/${}-]+)/g)) {
    const name = m[2]!.replace(/^(function:|table\/)/, '').split(/[/:]/)[0]!;
    if (!name.startsWith('${')) add(m[1]!, name);
  }
  for (const m of text.matchAll(/https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d+\/([\w.-]+)/g)) add('sqs', m[1]!);
  for (const m of text.matchAll(/\b(QueueName|TopicName|TableName|BucketName|FunctionName)\s*:\s*["']?([\w.${}:-]+)/g)) {
    const type = { QueueName: 'sqs', TopicName: 'sns', TableName: 'dynamodb', BucketName: 's3', FunctionName: 'lambda' }[m[1]!]!;
    add(type, m[2]!);
  }
  return [...out.values()].slice(0, 60);
}

const IGNORED_HOSTS =
  /(^|\.)(github\.com|githubusercontent\.com|npmjs\.(org|com)|yarnpkg\.com|golang\.org|google\.com|w3\.org|schema\.org|example\.(com|test)|localhost|apache\.org|json-schema\.org|docker\.(io|com)|amazonaws\.com|sonarcloud\.io|shields\.io)$/;

function hostsOf(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?/gi)) {
    const h = m[1]!.toLowerCase();
    if (!IGNORED_HOSTS.test(h)) hosts.add(h);
  }
  return [...hosts].sort().slice(0, 40);
}

function npmDeps(pkg: { dependencies?: Record<string, string> } | null, lockText: string | null): RepoFacts['dependencies'] {
  const direct = Object.entries(pkg?.dependencies ?? {});
  if (!direct.length) return [];
  const lock = parseJson<{ packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> }>(lockText ?? undefined);
  return direct.flatMap(([name, range]) => {
    const resolved = lock?.packages?.[`node_modules/${name}`]?.version ?? lock?.dependencies?.[name]?.version ?? /\d+\.\d+\.\d+[\w.-]*/.exec(range)?.[0];
    return resolved ? [{ name, version: resolved, ecosystem: 'npm' as const }] : [];
  });
}

/** Todos os módulos do go.mod (diretos e indiretos), só os nomes. */
const goModules = (goMod: string) => [...goMod.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[a-z]{2,}\/[\w./-]+)\s+v/gm)].map((m) => m[1]!);

const SAST = /\b(codeql|semgrep|sonar(?:qube|cloud)?|snyk|trivy|bandit|gosec|checkmarx|veracode|horusec|rainforest)\b/gi;
const SECRET_SCAN = /\b(gitleaks|trufflehog|detect-secrets|secretlint|ggshield)\b/gi;

/** Auditoria estática dos workflows (sem executar nada). */
function auditWorkflows(files: Array<{ path: string; text: string }>, owner: string, total: number): WorkflowAudit {
  const audit: WorkflowAudit = {
    files: total,
    dangerousTriggers: [],
    writeAll: [],
    missingPermissions: [],
    unpinnedActions: [],
    sastTools: [],
    secretScanTools: [],
    sendsMetrics: false,
  };
  const sast = new Set<string>();
  const secrets = new Set<string>();
  const unpinned = new Set<string>();
  for (const { path, text } of files) {
    const name = path.replace('.github/workflows/', '');
    if (/pull_request_target/.test(text) && /ref:\s*\$\{\{\s*github\.(event\.pull_request\.head\.(sha|ref)|head_ref)/.test(text))
      audit.dangerousTriggers.push(name);
    if (/permissions:\s*write-all/.test(text)) audit.writeAll.push(name);
    const topLevel = /^permissions:/m.test(text);
    // Só o bloco `jobs:` (os gatilhos de `on:` também ficam com 2 espaços e não são jobs).
    const jobsBlock = /^jobs:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(text)?.[1] ?? '';
    const jobs = (jobsBlock.match(/^ {2}[\w-]+:\s*$/gm) ?? []).length;
    const jobPerms = (jobsBlock.match(/^ {4}permissions:/gm) ?? []).length;
    if (!topLevel && (jobs === 0 || jobPerms < jobs)) audit.missingPermissions.push(name);
    for (const m of text.matchAll(/uses:\s*["']?([^\s"'#]+)/g)) {
      const ref = m[1]!;
      if (ref.startsWith('./')) continue;
      if (ref.startsWith('docker://')) {
        if (!/@sha256:[0-9a-f]{64}$/.test(ref)) unpinned.add(ref);
        continue;
      }
      const [action, version] = ref.split('@');
      if (!action || action.split('/')[0]!.toLowerCase() === owner.toLowerCase()) continue;
      if (!version || !/^[0-9a-f]{40}$/.test(version)) unpinned.add(ref);
    }
    for (const m of text.matchAll(SAST)) sast.add(m[1]!.toLowerCase());
    for (const m of text.matchAll(SECRET_SCAN)) secrets.add(m[1]!.toLowerCase());
    if (/integrations\/github-action|\/api\/metrics/.test(text)) audit.sendsMetrics = true;
  }
  audit.unpinnedActions = [...unpinned].slice(0, 20);
  audit.sastTools = [...sast];
  audit.secretScanTools = [...secrets];
  return audit;
}

function goDeps(goMod: string): RepoFacts['dependencies'] {
  const out: RepoFacts['dependencies'] = [];
  const block = /require\s*\(([\s\S]*?)\)/g;
  for (const m of goMod.matchAll(block)) {
    for (const line of m[1]!.split('\n')) {
      const dep = /^\s*([\w./-]+)\s+(v[\w.+-]+)(\s*\/\/\s*indirect)?/.exec(line);
      if (dep && !dep[3]) out.push({ name: dep[1]!, version: dep[2]!, ecosystem: 'Go' });
    }
  }
  for (const m of goMod.matchAll(/^require\s+([\w./-]+)\s+(v[\w.+-]+)\s*$/gm)) out.push({ name: m[1]!, version: m[2]!, ecosystem: 'Go' });
  return out;
}

function appTypeOf(f: RepoFacts, pkg: { dependencies?: Record<string, string> } | null, paths: Set<string>): RepoFacts['appType'] {
  if (
    f.frameworks.includes('React Native') ||
    (paths.has('build.gradle') && [...paths].some((p) => p.endsWith('AndroidManifest.xml')) && !paths.has('Dockerfile'))
  )
    return 'mobile';
  if (f.languages[0] === 'Terraform' || f.deploy.includes('Pulumi')) return 'infra';
  if (f.frameworks.some((x) => ['React', 'Vue', 'Angular', 'Next.js', 'Vite'].includes(x)) && !f.frameworks.includes('NestJS')) return 'frontend';
  if (f.deploy.some((d) => /ECS|Serverless|Docker/.test(d))) return 'service';
  if (f.frameworks.some((x) => SERVER_FRAMEWORKS.includes(x))) return 'service';
  if (pkg && !paths.has('Dockerfile') && (paths.has('index.d.ts') || paths.has('tsconfig.build.json'))) return 'library';
  if (!f.languages.length) return 'docs';
  return 'unknown';
}
