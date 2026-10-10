import { describe, expect, it } from 'vitest';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { RepoCollector, type RepoRef } from './RepoCollector.ts';

const REF: RepoRef = { owner: 'acme', name: 'api', sha: 'abc', branch: 'main', token: 'tok', description: null };

async function collect(files: Record<string, string>, setup: (g: FakeGithubClient) => void = () => {}) {
  const g = new FakeGithubClient(files);
  setup(g);
  return { result: await new RepoCollector(g).collect(REF), github: g };
}

const pkg = (p: Record<string, unknown>) => JSON.stringify(p);

describe('RepoCollector — linguagens e manifestos', () => {
  it('ordena linguagens por bytes, limita a 5 e ignora node_modules/dist/vendor', async () => {
    const { result } = await collect({}, (g) => {
      g.extraTree = [
        { path: 'a.ts', type: 'blob', size: 500 },
        { path: 'b.tsx', type: 'blob', size: 600 },
        { path: 'c.go', type: 'blob', size: 900 },
        { path: 'd.py', type: 'blob', size: 100 },
        { path: 'e.rb', type: 'blob', size: 90 },
        { path: 'f.sh', type: 'blob', size: 80 },
        { path: 'g.sql', type: 'blob', size: 70 },
        { path: 'h.unknownext', type: 'blob', size: 99999 },
        { path: 'Makefile', type: 'blob', size: 99999 },
        { path: 'node_modules/x/index.js', type: 'blob', size: 999999 },
        { path: 'dist/out.js', type: 'blob', size: 999999 },
        { path: 'vendor/lib.go', type: 'blob', size: 999999 },
      ];
    });
    expect(result.facts.languages).toEqual(['TypeScript', 'Go', 'Python', 'Ruby', 'Shell']);
  });

  it('lista manifestos encontrados', async () => {
    const { result } = await collect({ 'package.json': '{}', 'go.mod': 'module x\n', 'pom.xml': '<x/>', 'requirements.txt': 'x', Dockerfile: 'FROM x' });
    expect(result.facts.manifests).toEqual(['package.json', 'go.mod', 'pom.xml', 'requirements.txt']);
  });
});

describe('RepoCollector — frameworks', () => {
  it('detecta frameworks do npm (dependencies e devDependencies)', async () => {
    const { result } = await collect({
      'package.json': pkg({
        dependencies: { '@nestjs/core': '1', express: '1', fastify: '1', '@prisma/client': '1', bullmq: '1', 'aws-sdk': '2', '@opentelemetry/sdk-node': '1' },
        devDependencies: { jest: '1', vitest: '1', '@playwright/test': '1', cypress: '1', 'socket.io': '1', serverless: '3' },
      }),
    });
    expect(result.facts.frameworks).toEqual(
      expect.arrayContaining([
        'NestJS',
        'Express',
        'Fastify',
        'Prisma',
        'BullMQ',
        'AWS SDK',
        'OpenTelemetry',
        'Jest',
        'Vitest',
        'Playwright',
        'Cypress',
        'Socket.IO',
        'Serverless',
      ]),
    );
  });

  it('detecta frameworks do Go pelo go.mod', async () => {
    const goMod = `module x\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/jackc/pgx/v5 v5.5.0\n\tgithub.com/valkey-io/valkey-go v1.0.0\n\tgithub.com/aws/aws-sdk-go-v2 v1.0.0\n)\n`;
    const { result } = await collect({ 'go.mod': goMod });
    expect(result.facts.frameworks).toEqual(expect.arrayContaining(['Gin', 'pgx', 'Valkey', 'AWS SDK']));
  });

  it('detecta Spring Boot e Spring Cloud AWS pelo gradle/pom', async () => {
    const { result } = await collect({
      'build.gradle.kts': 'plugins { id("org.springframework.boot") }\nimplementation("org.springframework.boot:spring-boot-starter-web")',
      'pom.xml': '<groupId>io.awspring.cloud</groupId>',
    });
    expect(result.facts.frameworks).toEqual(['Spring Boot', 'Spring Cloud AWS']);
  });
});

describe('RepoCollector — runtime', () => {
  it('Go pelo go.mod tem prioridade', async () => {
    const { result } = await collect({ 'go.mod': 'module x\n\ngo 1.21.5\n', '.nvmrc': '20' });
    expect(result.facts.runtime).toEqual({ name: 'go', version: '1.21.5' });
  });

  it('Node pelo .nvmrc (sem o "v")', async () => {
    const { result } = await collect({ '.nvmrc': 'v22.3.0\n', Dockerfile: 'FROM node:18' });
    expect(result.facts.runtime).toEqual({ name: 'node', version: '22.3.0' });
  });

  it('Node pelo .node-version', async () => {
    const { result } = await collect({ '.node-version': '20.11.1' });
    expect(result.facts.runtime).toEqual({ name: 'node', version: '20.11.1' });
  });

  it('Node pelo Dockerfile quando o .nvmrc não é numérico', async () => {
    const { result } = await collect({ '.nvmrc': 'lts/*', Dockerfile: 'FROM public.ecr.aws/docker/library/node:20.10-alpine AS build' });
    expect(result.facts.runtime).toEqual({ name: 'node', version: '20.10' });
  });

  it('Node pelo engines do package.json', async () => {
    const { result } = await collect({ 'package.json': pkg({ engines: { node: '>=18.17.0' } }) });
    expect(result.facts.runtime).toEqual({ name: 'node', version: '18.17.0' });
  });

  it('Java pelo Dockerfile', async () => {
    const { result } = await collect({ Dockerfile: 'FROM eclipse-temurin:21-jre' });
    expect(result.facts.runtime).toEqual({ name: 'java', version: '21' });
  });

  it('Java pelo toolchain do gradle (JavaLanguageVersion e jvmToolchain)', async () => {
    expect((await collect({ 'build.gradle.kts': 'java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }' })).result.facts.runtime).toEqual({
      name: 'java',
      version: '17',
    });
    expect((await collect({ 'build.gradle.kts': 'kotlin { jvmToolchain(21) }' })).result.facts.runtime).toEqual({ name: 'java', version: '21' });
  });

  it('Python pelo Dockerfile', async () => {
    const { result } = await collect({ Dockerfile: 'FROM python:3.12-slim' });
    expect(result.facts.runtime).toEqual({ name: 'python', version: '3.12' });
  });

  it('null quando não identifica', async () => {
    const { result } = await collect({ Dockerfile: 'FROM alpine:3' });
    expect(result.facts.runtime).toBeNull();
  });
});

describe('RepoCollector — deploy', () => {
  it('detecta oni (tipo e cluster), serverless, Docker, Terraform, s3 sync e Bitbucket', async () => {
    const { result } = await collect({
      'oni.yaml': 'kind: worker\ncluster_name: "prod-cluster"\n',
      'serverless.yml': 'service: x',
      'serverless.ts': 'export default {}',
      'serverless-dnx.yml': 'x: 1',
      Dockerfile: 'FROM alpine',
      'infra/main.tf': 'resource {}',
      'bitbucket-pipelines.yml': 'pipelines: {}',
      '.github/workflows/site.yml': 'permissions: read-all\njobs:\n  deploy:\n    steps:\n      - run: aws s3 sync ./dist s3://site\n',
    });
    expect(result.facts.deploy).toEqual([
      'ECS via oni (worker) — cluster prod-cluster',
      'Serverless Framework (serverless.yml)',
      'Serverless Framework (serverless.ts)',
      'Serverless Framework (serverless-dnx.yml)',
      'Docker',
      'Terraform',
      'Site estático em S3 (aws s3 sync)',
      'Bitbucket Pipelines',
    ]);
  });

  it('oni sem tipo nem cluster, Pulumi e app mobile', async () => {
    const { result } = await collect({ 'oni.yaml': 'name: x', 'Pulumi.yaml': 'name: x', 'app.json': '{}', 'android/build.gradle': 'x' });
    expect(result.facts.deploy).toEqual(['ECS via oni', 'Pulumi', 'App mobile (Android/iOS)']);
  });

  it('app.json sem android/ios não é mobile', async () => {
    const { result } = await collect({ 'app.json': '{}' });
    expect(result.facts.deploy).toEqual([]);
  });
});

describe('RepoCollector — configuração', () => {
  const config = [
    "const a = process.env.DATABASE_URL; const b = process.env['API_KEY'];",
    'cfg := os.Getenv("GO_VAR"); os.LookupEnv( "GO_OTHER")',
    'type C struct { X string `env:"STRUCT_VAR"` }',
    'Y string `envconf:"ENVCONF_VAR"`',
    'url: ${env:SLS_VAR}',
    'String j = System.getenv("JAVA_VAR");',
    'this.configService.get<string>(\'NEST_VAR\'); configService.get("NEST_OTHER")',
    'process.env.ab',
    'arn:aws:sqs:us-east-1:123456789012:orders-queue',
    'arn:aws:lambda:us-east-1:123456789012:function:processor',
    'arn:aws:dynamodb:us-east-1:123456789012:table/users/index/x',
    'arn:aws:s3:::my-bucket/*',
    'arn:aws:sns:us-east-1:*:${self:custom.topic}',
    'https://sqs.us-east-1.amazonaws.com/123456789012/payments-queue',
    'QueueName: "events-q"',
    "TopicName: 'topic-x'",
    'TableName: sessions',
    'BucketName: uploads',
    'FunctionName: worker-fn',
    'https://api.partner.com/v1/x https://API.Other.io:8443/y',
    'https://github.com/acme https://raw.githubusercontent.com/x https://registry.npmjs.org http://localhost:3000 https://www.example.com https://s3.amazonaws.com',
  ].join('\n');

  it('extrai variáveis de ambiente de vários formatos', async () => {
    const { result } = await collect({
      'src/config/env.ts': config,
      '.env.example': 'export DB_HOST=localhost\nSECRET_KEY=valorreal\n# comentario\nlower=1\n',
    });
    expect(result.facts.envVars).toEqual(
      [
        'API_KEY',
        'DATABASE_URL',
        'DB_HOST',
        'ENVCONF_VAR',
        'GO_OTHER',
        'GO_VAR',
        'JAVA_VAR',
        'NEST_OTHER',
        'NEST_VAR',
        'SECRET_KEY',
        'SLS_VAR',
        'STRUCT_VAR',
      ].sort(),
    );
  });

  it('do .env.example guarda só os nomes (nunca os valores)', async () => {
    const { result } = await collect({ '.env.example': 'export DB_HOST=localhost\nSECRET_KEY=valorreal\n' });
    const snippet = result.snippets.find((s) => s.path === '.env.example');
    expect(snippet?.content).toBe('DB_HOST=\nSECRET_KEY=');
    expect(JSON.stringify(result)).not.toContain('valorreal');
  });

  it('extrai recursos AWS (ARNs, URLs de fila e nomes) e ignora placeholders', async () => {
    const { result } = await collect({ 'src/config/env.ts': config });
    expect(result.facts.resources).toEqual(
      expect.arrayContaining([
        { type: 'sqs', name: 'orders-queue' },
        { type: 'lambda', name: 'processor' },
        { type: 'dynamodb', name: 'users' },
        { type: 's3', name: 'my-bucket' },
        { type: 'sqs', name: 'payments-queue' },
        { type: 'sqs', name: 'events-q' },
        { type: 'sns', name: 'topic-x' },
        { type: 'dynamodb', name: 'sessions' },
        { type: 's3', name: 'uploads' },
        { type: 'lambda', name: 'worker-fn' },
      ]),
    );
    expect(result.facts.resources.some((r) => r.name.startsWith('${'))).toBe(false);
  });

  it('extrai hosts e ignora os genéricos', async () => {
    const { result } = await collect({ 'src/config/env.ts': config });
    expect(result.facts.hosts).toEqual(['api.other.io', 'api.partner.com']);
  });

  it('não lê arquivos de configuração que são testes ou grandes demais', async () => {
    const { github } = await collect({ 'src/config/env.test.ts': 'process.env.X_TEST', 'src/config/big.ts': 'x'.repeat(60_001) });
    expect(github.fileReads).not.toContain('src/config/env.test.ts');
    expect(github.fileReads).not.toContain('src/config/big.ts');
  });
});

describe('RepoCollector — higiene do repositório', () => {
  it('conta testes, detecta e2e, lockfiles, automação, lint, CODEOWNERS, changelog, docs e binários', async () => {
    const { result } = await collect({
      'src/a.test.ts': 'x',
      'src/b.spec.tsx': 'x',
      'tests/helper.ts': 'x',
      'pkg/x_test.go': 'x',
      'app/test_views.py': 'x',
      'app/views_test.py': 'x',
      'src/FooTest.java': 'x',
      'e2e/login.ts': 'x',
      'yarn.lock': 'x',
      'go.sum': 'x',
      '.github/dependabot.yml': 'x',
      'eslint.config.js': 'x',
      '.prettierrc': 'x',
      '.golangci.yml': 'x',
      'src/.eslintrc.json': 'x',
      '.github/CODEOWNERS': 'x',
      'CHANGELOG.md': 'x',
      'SECURITY.md': 'x',
      'AGENTS.md': 'x',
      '.env.sample': 'A=1',
      'CONTRIBUTING.md': 'x',
      'lib/tool.jar': 'x',
      'bin/app.exe': 'x',
      '.env': 'A=1',
      'config/.env.production': 'A=1',
      'config/.env.example': 'A=1',
    });
    const f = result.facts;
    expect(f.testFiles).toBe(7);
    expect(f.e2e).toBe(true);
    expect(f.lockfiles).toEqual(['yarn.lock', 'go.sum']);
    expect(f.updateAutomation).toBe('.github/dependabot.yml');
    expect(f.lintConfig.sort()).toEqual(['.golangci.yml', '.prettierrc', 'eslint.config.js']);
    expect(f.hasCodeowners).toBe(true);
    expect(f.hasChangelog).toBe(true);
    expect(f.docFiles).toEqual({ security: true, agents: true, envExample: true, contributing: true });
    expect(f.binaryFiles.sort()).toEqual(['bin/app.exe', 'lib/tool.jar']);
    expect(f.committedEnvFiles.sort()).toEqual(['.env', 'config/.env.production']);
  });

  it('e2e pela devDependency e sem nada de higiene', async () => {
    const { result } = await collect({ 'package.json': pkg({ devDependencies: { cypress: '13' } }) });
    const f = result.facts;
    expect(f.e2e).toBe(true);
    expect(f.testFiles).toBe(0);
    expect(f.lockfiles).toEqual([]);
    expect(f.updateAutomation).toBeNull();
    expect(f.hasCodeowners).toBe(false);
    expect(f.docFiles).toEqual({ security: false, agents: false, envExample: false, contributing: false });
  });

  it('sem e2e quando nada indica', async () => {
    const { result } = await collect({ 'src/a.ts': 'x' });
    expect(result.facts.e2e).toBe(false);
  });
});

describe('RepoCollector — dependências', () => {
  it('npm: usa o lockfile (packages e formato antigo) e cai na faixa do package.json', async () => {
    const { result } = await collect({
      'package.json': pkg({ dependencies: { express: '^4.18.0', pg: '^8.0.0', lodash: '~4.17.21', foo: 'latest' }, devDependencies: { vitest: '1.0.0' } }),
      'package-lock.json': JSON.stringify({ packages: { 'node_modules/express': { version: '4.19.2' } }, dependencies: { pg: { version: '8.11.3' } } }),
    });
    expect(result.facts.dependencies).toEqual([
      { name: 'express', version: '4.19.2', ecosystem: 'npm' },
      { name: 'pg', version: '8.11.3', ecosystem: 'npm' },
      { name: 'lodash', version: '4.17.21', ecosystem: 'npm' },
    ]);
  });

  it('npm sem dependências diretas = vazio; package.json inválido é ignorado', async () => {
    expect((await collect({ 'package.json': pkg({ devDependencies: { x: '1.0.0' } }) })).result.facts.dependencies).toEqual([]);
    expect((await collect({ 'package.json': '{ inválido' })).result.facts.dependencies).toEqual([]);
  });

  it('Go: bloco require (sem indiretas) e require de uma linha', async () => {
    const goMod = [
      'module github.com/acme/api',
      '',
      'go 1.22',
      '',
      'require github.com/single/dep v0.1.0',
      '',
      'require (',
      '\tgithub.com/jackc/pgx/v5 v5.5.0',
      '\tgolang.org/x/text v0.14.0 // indirect',
      ')',
    ].join('\n');
    const { result } = await collect({ 'go.mod': goMod });
    expect(result.facts.dependencies).toEqual([
      { name: 'github.com/jackc/pgx/v5', version: 'v5.5.0', ecosystem: 'Go' },
      { name: 'github.com/single/dep', version: 'v0.1.0', ecosystem: 'Go' },
    ]);
    expect(result.facts.dataStores).toEqual(['github.com/jackc/pgx/v5']);
  });
});

describe('RepoCollector — tipo de aplicação', () => {
  it('mobile por React Native', async () => {
    expect((await collect({ 'package.json': pkg({ dependencies: { 'react-native': '0.73.0' } }) })).result.facts.appType).toBe('mobile');
  });

  it('mobile por gradle + AndroidManifest sem Dockerfile', async () => {
    expect((await collect({ 'build.gradle': 'x', 'app/src/main/AndroidManifest.xml': '<x/>' })).result.facts.appType).toBe('mobile');
  });

  it('infra por Terraform como linguagem principal ou por Pulumi', async () => {
    expect((await collect({ 'main.tf': 'resource "x" {}' })).result.facts.appType).toBe('infra');
    expect((await collect({ 'Pulumi.yaml': 'x', 'index.ts': 'x' })).result.facts.appType).toBe('infra');
  });

  it('frontend por React/Vite (sem NestJS)', async () => {
    expect((await collect({ 'package.json': pkg({ dependencies: { react: '18.0.0' } }), 'src/main.tsx': 'x' })).result.facts.appType).toBe('frontend');
  });

  it('service por deploy (Docker/oni/serverless), mesmo com React + NestJS', async () => {
    expect(
      (await collect({ 'package.json': pkg({ dependencies: { react: '18.0.0', '@nestjs/core': '10.0.0' } }), Dockerfile: 'FROM node:20' })).result.facts
        .appType,
    ).toBe('service');
  });

  it('library por index.d.ts/tsconfig.build.json sem Dockerfile', async () => {
    expect((await collect({ 'package.json': '{}', 'tsconfig.build.json': '{}', 'src/a.ts': 'x' })).result.facts.appType).toBe('library');
  });

  it('framework de servidor é serviço mesmo sem Dockerfile (NestJS com tsconfig.build.json)', async () => {
    expect(
      (await collect({ 'package.json': pkg({ dependencies: { '@nestjs/core': '10.0.0' } }), 'tsconfig.build.json': '{}', 'src/main.ts': 'x' })).result.facts
        .appType,
    ).toBe('service');
  });

  it('docs sem linguagem e unknown no resto', async () => {
    expect((await collect({ 'README.md': '# x' })).result.facts.appType).toBe('docs');
    expect((await collect({ 'src/a.ts': 'x' })).result.facts.appType).toBe('unknown');
  });
});

describe('RepoCollector — auditoria de workflows', () => {
  const sha = 'a'.repeat(40);
  const digest = 'b'.repeat(64);
  const ci = `name: ci
on: [push]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@${sha}
      - uses: "docker://alpine:3"
      - uses: docker://alpine@sha256:${digest}
      - uses: acme/shared-action@main
      - uses: ACME/other@v1
      - uses: ./local-action
      - uses: some/action
      - uses: github/codeql-action/init@v3 # CodeQL
      - run: semgrep ci && gitleaks detect
      - uses: acme/comm-graph/integrations/github-action@main
`;
  const dangerous = `on: pull_request_target
permissions: write-all
jobs:
  build:
    steps:
      - uses: actions/checkout@${sha}
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`;
  const jobPerms = `on: [push]
jobs:
  a:
    permissions:
      contents: read
  b:
    permissions:
      contents: read
`;
  const partial = `on: [push]
jobs:
  a:
    permissions:
      contents: read
  b:
    runs-on: x
`;
  const noJobs = 'on: [push]\nname: vazio\n';
  const prtSafe = 'on: pull_request_target\npermissions:\n  contents: read\njobs:\n  x:\n    steps:\n      - run: echo trufflehog\n';

  it('aponta gatilhos perigosos, write-all, permissions ausentes, actions sem SHA, SAST e secret scanning', async () => {
    const { result } = await collect({
      '.github/workflows/ci.yml': ci,
      '.github/workflows/danger.yaml': dangerous,
      '.github/workflows/jobperms.yml': jobPerms,
      '.github/workflows/partial.yml': partial,
      '.github/workflows/nojobs.yml': noJobs,
      '.github/workflows/prt.yml': prtSafe,
      '.github/workflows/nested/ignored.yml': 'x',
    });
    const a = result.facts.workflowAudit;
    expect(a.files).toBe(6);
    expect(result.facts.workflows.sort()).toEqual(['ci.yml', 'danger.yaml', 'jobperms.yml', 'nojobs.yml', 'partial.yml', 'prt.yml']);
    expect(a.dangerousTriggers).toEqual(['danger.yaml']);
    expect(a.writeAll).toEqual(['danger.yaml']);
    expect(a.missingPermissions.sort()).toEqual(['nojobs.yml', 'partial.yml']);
    expect(a.unpinnedActions.sort()).toEqual(['actions/checkout@v4', 'docker://alpine:3', 'github/codeql-action/init@v3', 'some/action'].sort());
    expect(a.sastTools.sort()).toEqual(['codeql', 'semgrep']);
    expect(a.secretScanTools.sort()).toEqual(['gitleaks', 'trufflehog']);
    expect(a.sendsMetrics).toBe(true);
    expect(result.facts.realDependencyHarness).toBe('services no CI');
  });

  it('lê no máximo 15 workflows mas conta todos', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 17; i++) files[`.github/workflows/w${String(i).padStart(2, '0')}.yml`] = 'permissions: read-all\n';
    const { result } = await collect(files);
    expect(result.facts.workflowAudit.files).toBe(17);
    expect(result.facts.workflows.length).toBe(17);
    expect(result.facts.workflowAudit.missingPermissions).toEqual([]);
  });

  it('sem workflows: auditoria vazia', async () => {
    const { result } = await collect({});
    expect(result.facts.workflowAudit).toEqual({
      files: 0,
      dangerousTriggers: [],
      writeAll: [],
      missingPermissions: [],
      unpinnedActions: [],
      sastTools: [],
      secretScanTools: [],
      sendsMetrics: false,
    });
  });
});

describe('RepoCollector — bancos e harness', () => {
  it('testcontainers tem prioridade', async () => {
    const { result } = await collect({
      'package.json': pkg({
        dependencies: { pg: '8.0.0', ioredis: '5.0.0', '@valkey/client': '1.0.0', left: '1.0.0' },
        devDependencies: { testcontainers: '10.0.0' },
      }),
      'docker-compose.yml': 'services: {}',
    });
    expect(result.facts.dataStores.sort()).toEqual(['@valkey/client', 'ioredis', 'pg']);
    expect(result.facts.realDependencyHarness).toBe('testcontainers');
  });

  it('docker compose', async () => {
    const { result } = await collect({ 'package.json': pkg({ dependencies: { mongoose: '8.0.0' } }), 'deploy/compose.test.yaml': 'x' });
    expect(result.facts.dataStores).toEqual(['mongoose']);
    expect(result.facts.realDependencyHarness).toBe('docker compose');
  });

  it('nenhum harness', async () => {
    const { result } = await collect({ 'package.json': pkg({ dependencies: { redis: '4.0.0' } }) });
    expect(result.facts.realDependencyHarness).toBeNull();
  });

  it('módulos indiretos do go.mod e gorm.io também contam', async () => {
    const goMod = 'module x\n\nrequire (\n\tgorm.io/gorm v1.25.0\n\tgithub.com/redis/go-redis/v9 v9.0.0 // indirect\n)\n';
    const { result } = await collect({ 'go.mod': goMod });
    expect(result.facts.dataStores.sort()).toEqual(['github.com/redis/go-redis/v9', 'gorm.io/gorm']);
  });
});

describe('RepoCollector — GitHub, README, trechos e código', () => {
  it('lê topics, secret scanning e regras do branch', async () => {
    const { result } = await collect({}, (g) => {
      g.details = { topics: ['api'], secretScanning: true };
      g.rules = ['pull_request'];
    });
    expect(result.facts.github).toEqual({ topics: ['api'], secretScanning: true, branchRules: ['pull_request'] });
  });

  it('falhas da API viram null', async () => {
    const { result } = await collect({}, (g) => {
      g.details = new Error('403');
      g.rules = new Error('404');
    });
    expect(result.facts.github).toEqual({ topics: null, secretScanning: null, branchRules: null });
  });

  it('README redigido, trechos sem segredos, arquivos ilegíveis ignorados e lista de código filtrada', async () => {
    const { result } = await collect(
      {
        'README.md': `# Api\n\nSenha do banco: DB_PASSWORD=abc12345\n${'texto '.repeat(10)}`,
        'package.json': pkg({ name: 'x', scripts: { test: 'vitest' } }),
        Dockerfile: 'FROM node:20\nENV API_TOKEN=secreto123',
        'src/config/db.ts': 'export const url = "postgres://u:senha@db:5432/x";',
        'src/config/broken.ts': 'x',
        '.github/workflows/ci.yml': 'permissions: read-all\n',
        'src/app.ts': 'x',
        'src/types.d.ts': 'x',
        'src/app.test.ts': 'x',
        'migrations/001.ts': 'x',
        'scripts/seed.go': 'x',
        'lib/x.py': 'x',
        'README.txt.bak': 'x',
      },
      (g) => g.failFiles.add('src/config/broken.ts'),
    );
    expect(result.readme).toContain('DB_PASSWORD=[redigido]');
    expect(result.facts.readmeChars).toBeGreaterThan(40);
    expect(result.snippets.map((s) => s.path)).toEqual(['package.json', 'Dockerfile', 'src/config/db.ts', '.github/workflows/ci.yml']);
    expect(result.snippets.find((s) => s.path === 'Dockerfile')?.content).toContain('API_TOKEN=[redigido]');
    expect(result.snippets.find((s) => s.path === 'src/config/db.ts')?.content).toContain('postgres://[redigido]@db');
    expect(result.sourceFiles.map((s) => s.path).sort()).toEqual(['lib/x.py', 'src/app.ts', 'src/config/broken.ts', 'src/config/db.ts']);
    // Máxima: todo código, inclusive migrações e scripts; testes e .d.ts continuam fora.
    expect(result.allCodeFiles.map((s) => s.path).sort()).toEqual([
      'lib/x.py',
      'migrations/001.ts',
      'scripts/seed.go',
      'src/app.ts',
      'src/config/broken.ts',
      'src/config/db.ts',
    ]);
  });

  it('sem README', async () => {
    const { result } = await collect({ 'src/a.ts': 'x' });
    expect(result.readme).toBe('');
    expect(result.facts.readmeChars).toBe(0);
  });

  it('README presente mas ilegível', async () => {
    const { result } = await collect({ 'readme.rst': 'Projeto' }, (g) => g.failFiles.add('readme.rst'));
    expect(result.readme).toBe('');
    expect(result.facts.readmeChars).toBe(0);
  });
});
