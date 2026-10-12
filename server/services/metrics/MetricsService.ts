import type { IngestMetricsInput } from '../../../shared/schemas.ts';
import type { RepoMetricsSnapshot, SeverityCounts, TestCounts } from '../../../shared/types.ts';
import type { IObjectStorage } from '../../infra/storage/IObjectStorage.ts';
import type { IRepoMetricsRepository, MetricsData } from '../../repositories/contracts/IRepoMetricsRepository.ts';
import type { IIntrospectionService, IMetricsService } from '../contracts/index.ts';
import { parseCobertura, parseGoCover, parseIstanbulSummary, parseJunit, parseLcov, parseSarif, parseSonarqube, type CoverageResult } from './reportParsers.ts';

const HISTORY_LIMIT = 50;

/**
 * Recebe as métricas enviadas pelos workflows do GitHub (cobertura, JUnit, SARIF de SAST/DAST/SCA…),
 * interpreta, guarda o histórico e recalcula o scorecard do repositório.
 */
export class MetricsService implements IMetricsService {
  constructor(
    private readonly repo: IRepoMetricsRepository,
    private readonly introspection: IIntrospectionService,
    private readonly storage: IObjectStorage,
  ) {}

  async ingest(input: IngestMetricsInput): Promise<RepoMetricsSnapshot> {
    const data: MetricsData = {
      coverage: null,
      tests: {},
      security: {},
      tools: [],
      mutationScore: input.metrics.mutationScore ?? null,
      flakyRate: input.metrics.flakyRate ?? null,
      lint:
        input.metrics.lintErrors != null || input.metrics.lintWarnings != null
          ? { errors: input.metrics.lintErrors ?? 0, warnings: input.metrics.lintWarnings ?? 0 }
          : null,
      sonar: null,
      warnings: [],
    };
    const tools = new Set<string>();
    let coverage: CoverageResult | null = null;

    for (const [i, r] of input.reports.entries()) {
      const label = `${r.type}${r.tool ? ` (${r.tool})` : ''} #${i + 1}`;
      try {
        if (r.tool) tools.add(r.tool);
        switch (r.type) {
          case 'istanbul-summary':
          case 'lcov':
          case 'go-cover':
          case 'cobertura': {
            const parsed = { 'istanbul-summary': parseIstanbulSummary, lcov: parseLcov, 'go-cover': parseGoCover, cobertura: parseCobertura }[r.type](
              r.content,
            );
            coverage = mergeCoverage(coverage, parsed);
            break;
          }
          case 'junit': {
            const kind = r.category === 'e2e' || r.category === 'integration' ? r.category : 'unit';
            data.tests[kind] = addTests(data.tests[kind], parseJunit(r.content));
            break;
          }
          case 'sarif': {
            const parsed = parseSarif(r.content);
            parsed.tools.forEach((t) => tools.add(t));
            const kind = r.category === 'dast' || r.category === 'sca' || r.category === 'secrets' ? r.category : 'sast';
            data.security[kind] = addSeverity(data.security[kind], parsed.counts);
            break;
          }
          case 'sonarqube': {
            data.sonar = parseSonarqube(r.content);
            tools.add(r.tool ?? 'sonarqube');
            break;
          }
        }
      } catch (err) {
        data.warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Valores já calculados pelo workflow prevalecem sobre os relatórios.
    if (input.metrics.coverageLines != null || input.metrics.coverageBranches != null) {
      coverage = { lines: input.metrics.coverageLines ?? coverage?.lines ?? null, branches: input.metrics.coverageBranches ?? coverage?.branches ?? null };
    }
    // Sem relatório de cobertura, vale a do Sonar.
    if (!coverage && data.sonar?.coverage != null) coverage = { lines: data.sonar.coverage, branches: null };
    data.coverage = coverage;
    data.tools = [...tools];

    // Relatórios brutos ficam no bucket privado (auditoria e reprocessamento futuro).
    const reportKeys: string[] = [];
    const prefix = `ci-reports/${safe(input.owner)}/${safe(input.repo)}/${safe(input.sha)}/${Date.now()}`;
    for (const [i, r] of input.reports.entries()) {
      const ext =
        r.type === 'sarif' || r.type === 'istanbul-summary' || r.type === 'sonarqube' ? 'json' : r.type === 'junit' || r.type === 'cobertura' ? 'xml' : 'txt';
      const key = `${prefix}/${i + 1}-${r.type}${r.category ? `-${r.category}` : ''}.${ext}`;
      try {
        await this.storage.put('private', key, r.content, ext === 'json' ? 'application/json' : ext === 'xml' ? 'application/xml' : 'text/plain');
        reportKeys.push(key);
      } catch (err) {
        data.warnings.push(`não foi possível guardar o relatório ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const saved = await this.repo.insert({
      owner: input.owner,
      repo: input.repo,
      sha: input.sha,
      ref: input.ref ?? null,
      runUrl: input.runUrl ?? null,
      data,
      reportKeys,
    });
    await this.introspection.refreshQuality(input.owner, input.repo);
    return saved;
  }

  async history(owner: string, repo: string): Promise<RepoMetricsSnapshot[]> {
    return await this.repo.history(owner, repo, HISTORY_LIMIT);
  }
}

/** Segmento seguro de chave de objeto. */
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 120);

/** Vários relatórios de cobertura (ex.: monorepo): fica a média simples. */
function mergeCoverage(a: CoverageResult | null, b: CoverageResult): CoverageResult {
  if (!a) return b;
  const avg = (x: number | null, y: number | null) => (x == null ? y : y == null ? x : Math.round(((x + y) / 2) * 100) / 100);
  return { lines: avg(a.lines, b.lines), branches: avg(a.branches, b.branches) };
}

const addTests = (a: TestCounts | undefined, b: TestCounts): TestCounts =>
  a ? { total: a.total + b.total, passed: a.passed + b.passed, failed: a.failed + b.failed, skipped: a.skipped + b.skipped } : b;

const addSeverity = (a: SeverityCounts | undefined, b: SeverityCounts): SeverityCounts =>
  a ? { critical: a.critical + b.critical, high: a.high + b.high, medium: a.medium + b.medium, low: a.low + b.low } : b;
