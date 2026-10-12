import type { RepoFacts, RepoMetricsSnapshot, RepoProcess } from '../../shared/types.ts';
import { QualityScorer } from '../../server/services/github/QualityScorer.ts';
import type { PostureInput } from '../../server/services/reports/SecurityPosture.ts';
import { makeFacts } from './githubFakes.ts';

const DAY = 24 * 3600 * 1000;

export const sev = (critical = 0, high = 0, medium = 0, low = 0) => ({ critical, high, medium, low });

export function makeMetrics(over: Partial<RepoMetricsSnapshot> = {}): RepoMetricsSnapshot {
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
    sonar: null,
    warnings: [],
    ...over,
  };
}

/** Fatos de um repositório que faz tudo certo. */
export function exemplaryFacts(over: Partial<RepoFacts> = {}): RepoFacts {
  return makeFacts({
    appType: 'service',
    workflows: ['ci.yml'],
    workflowAudit: {
      files: 1,
      dangerousTriggers: [],
      writeAll: [],
      missingPermissions: [],
      unpinnedActions: [],
      sastTools: ['semgrep'],
      secretScanTools: ['gitleaks'],
      sendsMetrics: true,
    },
    testFiles: 25,
    e2e: true,
    runtime: { name: 'node', version: '22' },
    dependencies: [{ name: 'x', version: '1.0.0', ecosystem: 'npm' }],
    intel: {
      vulnerabilities: [],
      freshness: { averageLibyears: 0.2, measured: 5, outdated: 1 },
      runtimeSupport: { supported: true, eol: new Date(Date.now() + 400 * DAY).toISOString().slice(0, 10), latest: '22.5.0' },
    },
    lockfiles: ['package-lock.json'],
    updateAutomation: 'renovate.json',
    lintConfig: ['eslint.config.js'],
    hasCodeowners: true,
    github: { topics: ['api'], secretScanning: true, branchRules: ['pull_request', 'required_status_checks', 'non_fast_forward'] },
    readmeChars: 2000,
    hasChangelog: true,
    docFiles: { security: true, agents: true, envExample: true, contributing: true },
    ...over,
  });
}

export function exemplaryMetrics(over: Partial<RepoMetricsSnapshot> = {}): RepoMetricsSnapshot {
  return makeMetrics({
    coverage: { lines: 85, branches: 70 },
    tests: { unit: { total: 100, passed: 100, failed: 0, skipped: 0 }, e2e: { total: 10, passed: 10, failed: 0, skipped: 0 } },
    security: { sast: sev(), dast: sev(), secrets: sev(), sca: sev() },
    tools: ['semgrep', 'zap'],
    lint: { errors: 0, warnings: 0 },
    ...over,
  });
}

export const goodProcess = (): RepoProcess => ({
  windowDays: 90,
  collectedAt: '2026-01-01T00:00:00Z',
  mergedPrs: 10,
  reviewedPrs: 10,
  linkedPrs: 10,
  directPushes: { sampled: 10, direct: 0 },
  commits: 50,
  topAuthorShare: 0.4,
  openPrs: 2,
  staleOpenPrs: 0,
  unreviewedOldPrs: 0,
  errors: [],
});

/** Entrada da postura com o scorecard real calculado dos fatos/métricas. */
export function postureInput(
  facts: RepoFacts,
  metrics: RepoMetricsSnapshot | null,
  { name = 'api', process = goodProcess() }: { name?: string; process?: RepoProcess | null } = {},
): PostureInput {
  const quality = new QualityScorer().score({ facts, metrics, process, repo: { description: 'API', pushedAt: new Date(Date.now() - 5 * DAY).toISOString() } });
  return { owner: 'acme', name, htmlUrl: `https://github.com/acme/${name}`, analyzedAt: '2026-01-02T00:00:00Z', facts, quality, metrics };
}
