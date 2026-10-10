import { describe, expect, it } from 'vitest';
import type { QualityCheck, QualityReport, RepoFacts, RepoMetricsSnapshot, RepoProcess } from '../../../shared/types.ts';
import { makeFacts } from '../../../test/support/githubFakes.ts';
import { CATEGORIES, QUALITY_VERSION, QualityScorer, summarize, type ScoreInput } from './QualityScorer.ts';

const DAY = 24 * 3600 * 1000;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 5 * DAY).toISOString();

function metrics(over: Partial<RepoMetricsSnapshot> = {}): RepoMetricsSnapshot {
  return {
    id: 1,
    owner: 'acme',
    repo: 'api',
    sha: 'abcdef1234567',
    ref: 'main',
    runUrl: null,
    receivedAt: '2026-01-01T00:00:00Z',
    reportKeys: [],
    coverage: null,
    tests: {},
    security: {},
    tools: [],
    mutationScore: null,
    flakyRate: null,
    lint: null,
    warnings: [],
    ...over,
  };
}

function proc(over: Partial<RepoProcess> = {}): RepoProcess {
  return {
    windowDays: 90,
    collectedAt: '2026-01-01T00:00:00Z',
    mergedPrs: 10,
    reviewedPrs: 9,
    linkedPrs: 7,
    directPushes: { sampled: 10, direct: 0 },
    commits: 50,
    topAuthorShare: 0.4,
    openPrs: 2,
    staleOpenPrs: 0,
    unreviewedOldPrs: 0,
    errors: [],
    ...over,
  };
}

const scorer = new QualityScorer();
function score(facts: Partial<RepoFacts> = {}, rest: Partial<Omit<ScoreInput, 'facts'>> = {}): QualityReport {
  return scorer.score({
    facts: makeFacts(facts),
    metrics: rest.metrics ?? null,
    process: rest.process ?? null,
    repo: rest.repo ?? { description: null, pushedAt: null },
  });
}
const check = (r: QualityReport, id: string): QualityCheck | undefined => r.categories.flatMap((c) => c.checks).find((c) => c.id === id);
const status = (r: QualityReport, id: string) => check(r, id)?.status;

const audit = (over: Partial<RepoFacts['workflowAudit']> = {}): RepoFacts['workflowAudit'] => ({
  files: 1,
  dangerousTriggers: [],
  writeAll: [],
  missingPermissions: [],
  unpinnedActions: [],
  sastTools: [],
  secretScanTools: [],
  sendsMetrics: false,
  ...over,
});

const sev = (critical = 0, high = 0, medium = 0, low = 0) => ({ critical, high, medium, low });

describe('QualityScorer — repositório exemplar', () => {
  it('passa em tudo, com nota alta e confiança 1', () => {
    const r = score(
      {
        appType: 'service',
        workflows: ['ci.yml'],
        workflowAudit: audit({ sastTools: ['semgrep'], secretScanTools: ['gitleaks'], sendsMetrics: true }),
        testFiles: 25,
        e2e: true,
        dataStores: ['pg'],
        realDependencyHarness: 'testcontainers',
        runtime: { name: 'node', version: '22' },
        dependencies: [{ name: 'x', version: '1.0.0', ecosystem: 'npm' }],
        intel: {
          vulnerabilities: [],
          freshness: { averageLibyears: 0.2, measured: 5, outdated: 1 },
          runtimeSupport: { supported: true, eol: daysFromNow(400), latest: '22.5.0' },
        },
        lockfiles: ['package-lock.json'],
        updateAutomation: 'renovate.json',
        lintConfig: ['eslint.config.js'],
        hasCodeowners: true,
        github: { topics: ['api'], secretScanning: true, branchRules: ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion'] },
        readmeChars: 2000,
        hasChangelog: true,
        envVars: ['DB_URL'],
        docFiles: { security: true, agents: true, envExample: true, contributing: true },
      },
      {
        metrics: metrics({
          coverage: { lines: 85, branches: 70 },
          tests: { unit: { total: 100, passed: 100, failed: 0, skipped: 0 }, e2e: { total: 10, passed: 10, failed: 0, skipped: 0 } },
          security: { sast: sev(), dast: sev(), secrets: sev(), sca: sev() },
          tools: ['semgrep', 'zap'],
          mutationScore: 80,
          flakyRate: 0,
          lint: { errors: 0, warnings: 3 },
        }),
        process: proc({ reviewedPrs: 10, linkedPrs: 10 }),
        repo: { description: 'API', pushedAt: recent },
      },
    );
    const all = r.categories.flatMap((c) => c.checks);
    expect(all.filter((c) => c.status !== 'pass').map((c) => c.id)).toEqual([]);
    expect(all.filter((c) => c.impact === 'grade' && c.score !== 10).map((c) => [c.id, c.score])).toEqual([]);
    expect(r.score).toBe(10);
    expect(r.confidence).toBe(1);
    expect(r.version).toBe(QUALITY_VERSION);
    expect(check(r, 'coverage-pct')?.detail).toBe('Cobertura de linhas 85%, branches 70%');
    expect(check(r, 'sast-findings')?.detail).toContain('(semgrep, zap)');
    expect(check(r, 'secret-scanning')?.detail).toBe('Secret scanning do GitHub ativo');
    expect(check(r, 'runtime-eol')?.detail).toContain('com suporte até');
    expect(r.categories.map((c) => c.weight)).toEqual(Object.values(CATEGORIES).map((c) => c.weight));
  });
});

describe('QualityScorer — repositório abandonado', () => {
  it('falha onde há evidência e marca desconhecido o que não dá para ver', () => {
    const r = score({
      appType: 'service',
      testFiles: 0,
      dataStores: ['redis'],
      committedEnvFiles: ['.env'],
      binaryFiles: ['a.jar', 'b.jar', 'c.jar', 'd.jar', 'e.jar', 'f.jar'],
      envVars: ['X'],
    });
    expect(status(r, 'pipeline-present')).toBe('fail');
    expect(check(r, 'metrics-reported')?.detail).toBe('Nenhuma métrica recebida do CI');
    expect(status(r, 'sast-in-pipeline')).toBe('fail');
    expect(status(r, 'secret-scanning')).toBe('unknown');
    expect(status(r, 'tests-present')).toBe('fail');
    expect(status(r, 'tests-passing')).toBe('unknown');
    expect(status(r, 'e2e')).toBe('fail');
    expect(check(r, 'coverage-pct')).toMatchObject({ status: 'fail', score: 0 });
    expect(status(r, 'real-dependency-harness')).toBe('fail');
    expect(status(r, 'runtime-eol')).toBe('unknown');
    expect(status(r, 'sast-findings')).toBe('fail');
    expect(status(r, 'dast-findings')).toBe('unknown');
    expect(status(r, 'secrets-findings')).toBe('unknown');
    expect(status(r, 'env-committed')).toBe('fail');
    expect(check(r, 'binary-artifacts')?.detail).toContain('…');
    expect(status(r, 'lockfile-present')).toBe('fail');
    expect(status(r, 'update-automation')).toBe('fail');
    expect(status(r, 'lint-config')).toBe('fail');
    expect(status(r, 'codeowners')).toBe('fail');
    expect(check(r, 'branch-protection')).toMatchObject({ status: 'unknown', detail: 'Regras do branch padrão não visíveis com o token' });
    expect(status(r, 'dangerous-workflow')).toBe('na');
    expect(status(r, 'token-permissions')).toBe('na');
    expect(status(r, 'pinned-actions')).toBe('na');
    expect(check(r, 'recent-activity')).toMatchObject({ status: 'warn', detail: 'Sem push registrado', impact: 'signal' });
    expect(check(r, 'review-coverage')).toMatchObject({ status: 'unknown', detail: 'Processo ainda não coletado' });
    expect(status(r, 'readme')).toBe('fail');
    expect(status(r, 'security-policy')).toBe('fail');
    expect(status(r, 'changelog')).toBe('warn');
    expect(status(r, 'env-example')).toBe('fail');
    expect(status(r, 'agents-md')).toBe('warn');
    expect(check(r, 'repo-metadata')?.detail).toBe('Sem descrição, topics desconhecidos');
    expect(check(r, 'sca-vulnerabilities')?.status).toBe('na');
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeLessThan(3);
    expect(r.confidence).toBeLessThan(1);
  });
});

describe('QualityScorer — repositório sem código (docs/infra)', () => {
  it('marca n/a o que só vale para código', () => {
    const r = score({ appType: 'docs', languages: [], manifests: [], workflowAudit: audit({ files: 0 }) });
    for (const id of ['metrics-reported', 'sast-in-pipeline', 'tests-present', 'e2e', 'coverage-pct', 'lint-config', 'lockfile-present', 'update-automation'])
      expect(status(r, id)).toBe('na');
    expect(check(r, 'tests-passing')).toBeUndefined();
    expect(check(r, 'runtime-eol')).toMatchObject({ status: 'na' });
    expect(check(r, 'sast-findings')).toBeUndefined();
  });
});

describe('QualityScorer — CI', () => {
  it('Bitbucket conta como pipeline', () => {
    const r = score({ deploy: ['Bitbucket Pipelines'] });
    expect(check(r, 'pipeline-present')).toMatchObject({ status: 'pass', detail: 'CI configurado: bitbucket-pipelines.yml' });
  });

  it('workflow envia métricas mas nada chegou', () => {
    const r = score({ workflowAudit: audit({ sendsMetrics: true }) });
    expect(check(r, 'metrics-reported')?.detail).toBe('O workflow envia métricas, mas nada chegou ainda');
  });

  it('SAST publicado só pelas métricas', () => {
    const r = score({}, { metrics: metrics({ security: { sast: sev() } }) });
    expect(check(r, 'sast-in-pipeline')).toMatchObject({ status: 'pass', detail: 'SAST publicado nas métricas do CI' });
  });

  it('secret scanning via CI; sem visibilidade é desconhecido e falha só quando desligado', () => {
    expect(check(score({ workflowAudit: audit({ secretScanTools: ['gitleaks'] }) }), 'secret-scanning')?.detail).toBe('Varredura de segredos no CI: gitleaks');
    expect(status(score({ workflowAudit: audit() }), 'secret-scanning')).toBe('unknown');
    expect(status(score({ github: { topics: null, secretScanning: false, branchRules: null } }), 'secret-scanning')).toBe('fail');
  });
});

describe('QualityScorer — testes', () => {
  it('nota dos testes presentes varia com a quantidade', () => {
    expect(check(score({ testFiles: 20 }), 'tests-present')?.score).toBe(10);
    expect(check(score({ testFiles: 5 }), 'tests-present')?.score).toBe(8);
    expect(check(score({ testFiles: 1 }), 'tests-present')?.score).toBe(6);
  });

  it('testes passando: usa integração quando não há unitários; falhas e total zero', () => {
    const integ = score({}, { metrics: metrics({ tests: { integration: { total: 10, passed: 8, failed: 1, skipped: 1 } } }) });
    expect(check(integ, 'tests-passing')).toMatchObject({ status: 'fail', score: 8.9 });
    const empty = score({}, { metrics: metrics({ tests: { unit: { total: 0, passed: 0, failed: 0, skipped: 0 } } }) });
    expect(check(empty, 'tests-passing')).toMatchObject({ status: 'pass', score: 0 });
  });

  it('e2e: biblioteca n/a, CI com falhas, suíte sem resultado e tipo desconhecido', () => {
    expect(status(score({ appType: 'library' }), 'e2e')).toBe('na');
    expect(check(score({}, { metrics: metrics({ tests: { e2e: { total: 4, passed: 3, failed: 1, skipped: 0 } } }) }), 'e2e')).toMatchObject({
      status: 'warn',
      score: 6,
    });
    expect(check(score({ e2e: true }), 'e2e')).toMatchObject({ status: 'warn', score: 6 });
    expect(status(score({ appType: 'unknown' }), 'e2e')).toBe('unknown');
  });

  it('cobertura: proporcional a 80%, aviso abaixo de 60% e teto 5 sem e2e', () => {
    expect(check(score({ e2e: true }, { metrics: metrics({ coverage: { lines: 40, branches: null } }) }), 'coverage-pct')).toMatchObject({
      status: 'warn',
      score: 5,
      detail: 'Cobertura de linhas 40%',
    });
    const capped = check(score({ appType: 'frontend' }, { metrics: metrics({ coverage: { lines: 90, branches: null } }) }), 'coverage-pct');
    expect(capped).toMatchObject({ status: 'pass', score: 5 });
    expect(capped?.detail).toContain('(limitada a 5: sem e2e)');
  });

  it('dependências reais: n/a sem banco', () => {
    expect(status(score({ dataStores: [] }), 'real-dependency-harness')).toBe('na');
  });

  it('mutation score e testes instáveis', () => {
    const r = score({}, { metrics: metrics({ mutationScore: 40, flakyRate: 3 }) });
    expect(check(r, 'mutation-score')).toMatchObject({ status: 'pass', score: 5 });
    expect(check(r, 'flaky-rate')).toMatchObject({ status: 'warn', score: 4 });
    expect(check(score({}, { metrics: metrics({ flakyRate: 1 }) }), 'flaky-rate')?.status).toBe('pass');
  });
});

describe('QualityScorer — segurança', () => {
  const rt = { name: 'node', version: '16' };
  const intel = (runtimeSupport: RepoFacts['intel']['runtimeSupport']) => ({ vulnerabilities: null, freshness: null, runtimeSupport });

  it('runtime: sem consulta, fora de suporte (com e sem versão mais nova), perto do fim e sem data', () => {
    expect(check(score({ runtime: rt }), 'runtime-eol')?.detail).toBe('node 16: suporte não consultado');
    const eol = check(score({ runtime: rt, intel: intel({ supported: false, eol: '2023-09-11', latest: '16.20.2' }) }), 'runtime-eol');
    expect(eol).toMatchObject({ status: 'fail', fix: 'Atualize para uma versão suportada (mais recente 16.20.2).' });
    expect(check(score({ runtime: rt, intel: intel({ supported: false, eol: '2023-09-11', latest: null }) }), 'runtime-eol')?.fix).toBe(
      'Atualize para uma versão suportada.',
    );
    expect(check(score({ runtime: rt, intel: intel({ supported: true, eol: daysFromNow(30), latest: null }) }), 'runtime-eol')).toMatchObject({
      status: 'warn',
      score: 6,
    });
    expect(check(score({ runtime: rt, intel: intel({ supported: true, eol: null, latest: null }) }), 'runtime-eol')).toMatchObject({
      status: 'pass',
      detail: 'node 16 com suporte',
    });
  });

  const deps = [{ name: 'a', version: '1.0.0', ecosystem: 'npm' as const }];

  it('vulnerabilidades: não consultado e com avisos', () => {
    expect(status(score({ dependencies: deps }), 'sca-vulnerabilities')).toBe('unknown');
    const r = score({
      dependencies: deps,
      intel: { vulnerabilities: [{ dependency: 'a@1.0.0', ids: ['GHSA-1', 'GHSA-2', 'GHSA-3'] }], freshness: null, runtimeSupport: null },
    });
    expect(check(r, 'sca-vulnerabilities')).toMatchObject({ status: 'warn', score: 4, fix: 'Atualize as dependências afetadas.' });
    expect(check(r, 'sca-vulnerabilities')?.detail).toContain('a@1.0.0 GHSA-1, GHSA-2');
  });

  it('atualização das dependências: sem medição e desatualizadas', () => {
    expect(
      status(
        score({ dependencies: deps, intel: { vulnerabilities: null, freshness: { averageLibyears: 0, measured: 0, outdated: 0 }, runtimeSupport: null } }),
        'dependency-freshness',
      ),
    ).toBe('unknown');
    expect(status(score({ dependencies: deps }), 'dependency-freshness')).toBe('unknown');
    const r = score({
      dependencies: deps,
      intel: { vulnerabilities: null, freshness: { averageLibyears: 1.75, measured: 4, outdated: 3 }, runtimeSupport: null },
    });
    expect(check(r, 'dependency-freshness')).toMatchObject({ status: 'warn', score: 5 });
    expect(
      check(
        score({ dependencies: deps, intel: { vulnerabilities: null, freshness: { averageLibyears: 5, measured: 1, outdated: 1 }, runtimeSupport: null } }),
        'dependency-freshness',
      )?.score,
    ).toBe(0);
  });

  it('achados de SAST/DAST/segredos por severidade', () => {
    const r = score({ appType: 'frontend' }, { metrics: metrics({ security: { sast: sev(1), dast: sev(0, 2), secrets: sev(0, 0, 3) } }) });
    expect(check(r, 'sast-findings')).toMatchObject({ status: 'fail', score: 0, fix: 'Corrija os achados críticos e altos.' });
    expect(check(r, 'sast-findings')?.detail).toBe('SAST: 1 crítico(s), 0 alto(s), 0 médio(s), 0 baixo(s)');
    expect(check(r, 'dast-findings')).toMatchObject({ status: 'fail', score: 3 });
    expect(check(r, 'secrets-findings')).toMatchObject({ status: 'warn', score: 7.5, fix: null });
    const many = score({}, { metrics: metrics({ security: { sast: sev(0, 9), secrets: sev(0, 0, 0, 2) } }) });
    expect(check(many, 'sast-findings')?.score).toBe(1);
    expect(check(many, 'secrets-findings')).toMatchObject({ status: 'pass', score: 9.5 });
    expect(check(score({}, { metrics: metrics({ security: { sast: sev(0, 0, 20) } }) }), 'sast-findings')?.score).toBe(5);
  });

  it('DAST só para serviço e frontend', () => {
    expect(check(score({ appType: 'mobile' }), 'dast-findings')).toBeUndefined();
  });

  it('scanner SCA do CI: pass ou aviso', () => {
    expect(check(score({}, { metrics: metrics({ security: { sca: sev(0, 0, 1) } }) }), 'sca-scanner')).toMatchObject({ status: 'pass', score: 8.5 });
    expect(check(score({}, { metrics: metrics({ security: { sca: sev(0, 1) } }) }), 'sca-scanner')).toMatchObject({ status: 'warn', score: 4 });
  });

  it('binários: até 5 sem reticências', () => {
    expect(check(score({ binaryFiles: ['a.exe'] }), 'binary-artifacts')?.detail).toBe('Binários versionados: a.exe');
  });
});

describe('QualityScorer — guardrails', () => {
  it('n/a sem gerenciador de pacotes', () => {
    const r = score({ manifests: [], dependencies: [] });
    expect(status(r, 'lockfile-present')).toBe('na');
    expect(status(r, 'update-automation')).toBe('na');
  });

  it('lint no CI com erros', () => {
    const c = check(score({}, { metrics: metrics({ lint: { errors: 9, warnings: 0 } }) }), 'lint-clean');
    expect(c).toMatchObject({ status: 'fail', score: 5 });
  });

  it('proteção de branch: sem rulesets, parcial', () => {
    expect(check(score({ github: { topics: null, secretScanning: null, branchRules: [] } }), 'branch-protection')?.detail).toContain('Nenhum ruleset');
    const partial = check(score({ github: { topics: null, secretScanning: null, branchRules: ['pull_request'] } }), 'branch-protection');
    expect(partial).toMatchObject({ status: 'warn', score: 3.3 });
    expect(partial?.detail).toBe('Branch padrão exige: pull_request (falta required_status_checks, non_fast_forward)');
    expect(check(score({ github: { topics: null, secretScanning: null, branchRules: ['deletion'] } }), 'branch-protection')?.detail).toContain(
      'nada relevante',
    );
  });

  it('workflows perigosos, sem permissions e actions sem SHA', () => {
    const r = score({
      workflowAudit: audit({
        files: 4,
        dangerousTriggers: ['a.yml'],
        writeAll: ['b.yml'],
        missingPermissions: ['a.yml', 'c.yml'],
        unpinnedActions: ['x/a@v1', 'x/b@v1', 'x/c@v1', 'x/d@v1', 'x/e@v1'],
      }),
    });
    expect(check(r, 'dangerous-workflow')?.detail).toBe('Workflow perigoso: a.yml (pull_request_target com checkout do PR); b.yml (write-all)');
    expect(check(r, 'token-permissions')).toMatchObject({ status: 'fail', score: 5 });
    expect(check(r, 'pinned-actions')).toMatchObject({ status: 'warn', score: 5 });
    expect(check(r, 'pinned-actions')?.detail).toBe('5 action(s) de terceiros sem SHA: x/a@v1, x/b@v1, x/c@v1, x/d@v1');
  });
});

describe('QualityScorer — processo', () => {
  it('erros de coleta viram desconhecido', () => {
    const r = score({}, { process: proc({ errors: ['PRs mesclados: x', 'commits: y', 'PRs abertos: z'] }) });
    expect(status(r, 'review-coverage')).toBe('unknown');
    expect(check(r, 'issue-traceability')).toBeUndefined();
    expect(status(r, 'direct-push-share')).toBe('unknown');
    expect(status(r, 'pr-upkeep')).toBe('unknown');
  });

  it('sem PRs, sem commits e poucos commits = n/a', () => {
    const r = score({}, { process: proc({ mergedPrs: 0, directPushes: null, topAuthorShare: null }) });
    expect(check(r, 'review-coverage')).toMatchObject({ status: 'na', detail: 'Nenhum PR mesclado em 90 dias' });
    expect(status(r, 'direct-push-share')).toBe('na');
    expect(status(r, 'bus-factor')).toBe('na');
  });

  it('avisos de revisão, rastreabilidade, push direto, bus factor e PRs parados', () => {
    const r = score(
      {},
      {
        process: proc({
          mergedPrs: 10,
          reviewedPrs: 5,
          linkedPrs: 2,
          directPushes: { sampled: 10, direct: 4 },
          topAuthorShare: 0.9,
          staleOpenPrs: 1,
          unreviewedOldPrs: 2,
        }),
      },
    );
    expect(check(r, 'review-coverage')).toMatchObject({ status: 'warn', score: 5 });
    expect(check(r, 'issue-traceability')).toMatchObject({ status: 'warn', score: 2 });
    expect(check(r, 'direct-push-share')).toMatchObject({ status: 'warn', score: 6, fix: 'Proíba push direto no branch padrão.' });
    expect(check(r, 'bus-factor')).toMatchObject({ status: 'warn', score: 2 });
    expect(check(r, 'bus-factor')?.fix).not.toBeNull();
    expect(check(r, 'pr-upkeep')).toMatchObject({ status: 'warn', score: 4.5 });
    expect(check(score({}, { process: proc({ topAuthorShare: 0.6 }) }), 'bus-factor')).toMatchObject({ status: 'warn', fix: null });
  });

  it('push antigo é aviso', () => {
    expect(check(score({}, { repo: { description: null, pushedAt: '2020-01-01T00:00:00Z' } }), 'recent-activity')).toMatchObject({
      status: 'warn',
      detail: 'Último push em 2020-01-01',
    });
  });
});

describe('QualityScorer — documentação', () => {
  it('README curto e metadados parciais', () => {
    const r = score({ readmeChars: 100, github: { topics: [], secretScanning: null, branchRules: null } }, { repo: { description: 'x', pushedAt: null } });
    expect(check(r, 'readme')).toMatchObject({ status: 'warn', score: 5 });
    expect(check(r, 'repo-metadata')).toMatchObject({ status: 'warn', detail: 'Com descrição, 0 topic(s)' });
  });

  it('env-example só para apps com variáveis', () => {
    expect(check(score({ appType: 'library', envVars: ['X'] }), 'env-example')).toBeUndefined();
    expect(check(score({ envVars: [] }), 'env-example')).toBeUndefined();
  });
});

describe('summarize', () => {
  const c = (over: Partial<QualityCheck>): QualityCheck => ({
    id: 'x',
    category: 'ci',
    impact: 'grade',
    status: 'pass',
    score: 10,
    detail: '',
    fix: null,
    ...over,
  });

  it('sem checks: nota null e confiança 0', () => {
    const r = summarize([]);
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.categories.every((x) => x.score === null)).toBe(true);
  });

  it('média ponderada; signal e n/a não contam; desconhecido reduz a confiança', () => {
    const r = summarize([
      c({ category: 'ci', score: 10 }),
      c({ category: 'ci', score: 0, status: 'fail' }),
      c({ category: 'tests', score: 2 }),
      c({ category: 'tests', score: null, status: 'unknown' }),
      c({ category: 'docs', score: 0, impact: 'signal', status: 'warn' }),
      c({ category: 'process', score: null, status: 'na' }),
    ]);
    const ci = r.categories.find((x) => x.category === 'ci')!;
    expect(ci.score).toBe(5);
    expect(r.categories.find((x) => x.category === 'docs')!.score).toBeNull();
    // (5*2 + 2*3) / 5 = 3.2
    expect(r.score).toBe(3.2);
    // ci: 2 * 1, tests: 3 * 0.5 → 3.5 / 5 = 0.7
    expect(r.confidence).toBe(0.7);
  });
});
