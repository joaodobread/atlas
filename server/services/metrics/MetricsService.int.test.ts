import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryObjectStorage } from '../../../test/support/MemoryObjectStorage.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { ingestMetricsSchema, type IngestMetricsInput } from '../../../shared/schemas.ts';
import { PgRepoMetricsRepository } from '../../repositories/postgres/PgRepoMetricsRepository.ts';
import type { IIntrospectionService } from '../contracts/index.ts';
import { MetricsService } from './MetricsService.ts';

const LCOV = 'LF:10\nLH:8\nBRF:4\nBRH:2';
const ISTANBUL = JSON.stringify({ total: { lines: { pct: 60 }, branches: { pct: 'x' } } });
const JUNIT = '<testsuite><testcase/><testcase><failure/></testcase><testcase><skipped/></testcase></testsuite>';
const sarif = (tool: string, level: string) => JSON.stringify({ runs: [{ tool: { driver: { name: tool } }, results: [{ level }] }] });

describe('MetricsService', () => {
  let storage: MemoryObjectStorage;
  let refreshQuality: ReturnType<typeof vi.fn<(owner: string, repo: string) => Promise<void>>>;
  let service: MetricsService;

  const input = (raw: Record<string, unknown>): IngestMetricsInput => ingestMetricsSchema.parse({ owner: 'acme', repo: 'api', sha: 'abc1234', ...raw });

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    storage = new MemoryObjectStorage();
    refreshQuality = vi.fn<(owner: string, repo: string) => Promise<void>>().mockResolvedValue(undefined);
    const introspection = { refreshQuality } as Partial<IIntrospectionService> as IIntrospectionService;
    service = new MetricsService(new PgRepoMetricsRepository(db), introspection, storage);
  });

  it('interpreta cobertura, testes e segurança, guarda os relatórios e recalcula o scorecard', async () => {
    const snap = await service.ingest(
      input({
        ref: 'refs/heads/main',
        runUrl: 'https://ci.example/run/1',
        reports: [
          { type: 'lcov', content: LCOV, tool: 'vitest' },
          { type: 'istanbul-summary', content: ISTANBUL },
          { type: 'junit', content: JUNIT },
          { type: 'junit', category: 'unit', content: JUNIT },
          { type: 'junit', category: 'e2e', content: JUNIT, tool: 'playwright' },
          { type: 'junit', category: 'integration', content: JUNIT },
          { type: 'sarif', content: sarif('CodeQL', 'error') },
          { type: 'sarif', category: 'sast', content: sarif('Semgrep', 'warning') },
          { type: 'sarif', category: 'dast', content: sarif('ZAP', 'note') },
          { type: 'sarif', category: 'sca', content: sarif('Trivy', 'error') },
          { type: 'sarif', category: 'secrets', content: sarif('gitleaks', 'error') },
          { type: 'go-cover', content: 'a.go:1.1,2.2 1 1' },
          { type: 'cobertura', category: 'unit', content: '<coverage line-rate="1" branch-rate="1">' },
        ],
        metrics: { mutationScore: 55, flakyRate: 2, lintWarnings: 4 },
      }),
    );

    // lcov (80/50) + istanbul (60/null) = 70/50; + go (100/null) = 85/50; + cobertura (100/100) = 92.5/75
    expect(snap.coverage).toEqual({ lines: 92.5, branches: 75 });
    expect(snap.tests).toEqual({
      unit: { total: 6, passed: 2, failed: 2, skipped: 2 },
      e2e: { total: 3, passed: 1, failed: 1, skipped: 1 },
      integration: { total: 3, passed: 1, failed: 1, skipped: 1 },
    });
    expect(snap.security).toEqual({
      sast: { critical: 0, high: 1, medium: 1, low: 0 },
      dast: { critical: 0, high: 0, medium: 0, low: 1 },
      sca: { critical: 0, high: 1, medium: 0, low: 0 },
      secrets: { critical: 0, high: 1, medium: 0, low: 0 },
    });
    expect(snap.tools.sort()).toEqual(['CodeQL', 'Semgrep', 'Trivy', 'ZAP', 'gitleaks', 'playwright', 'vitest'].sort());
    expect(snap).toMatchObject({
      mutationScore: 55,
      flakyRate: 2,
      lint: { errors: 0, warnings: 4 },
      warnings: [],
      ref: 'refs/heads/main',
      runUrl: 'https://ci.example/run/1',
    });

    expect(snap.reportKeys).toHaveLength(13);
    expect(snap.reportKeys[0]).toMatch(/^ci-reports\/acme\/api\/abc1234\/\d+\/1-lcov\.txt$/);
    expect(snap.reportKeys[1]).toMatch(/\/2-istanbul-summary\.json$/);
    expect(snap.reportKeys[2]).toMatch(/\/3-junit\.xml$/);
    expect(snap.reportKeys[4]).toMatch(/\/5-junit-e2e\.xml$/);
    expect(snap.reportKeys[12]).toMatch(/\/13-cobertura-unit\.xml$/);
    expect(storage.objects.get(`private:${snap.reportKeys[0]}`)?.contentType).toBe('text/plain');
    expect(storage.objects.get(`private:${snap.reportKeys[1]}`)?.contentType).toBe('application/json');
    expect(storage.objects.get(`private:${snap.reportKeys[2]}`)?.contentType).toBe('application/xml');
    expect(refreshQuality).toHaveBeenCalledWith('acme', 'api');
  });

  it('valores calculados pelo workflow prevalecem sobre os relatórios', async () => {
    const a = await service.ingest(input({ reports: [{ type: 'lcov', content: LCOV }], metrics: { coverageLines: 91 } }));
    expect(a.coverage).toEqual({ lines: 91, branches: 50 });
    const b = await service.ingest(input({ metrics: { coverageBranches: 40, lintErrors: 3 } }));
    expect(b.coverage).toEqual({ lines: null, branches: 40 });
    expect(b.lint).toEqual({ errors: 3, warnings: 0 });
    expect(b).toMatchObject({ mutationScore: null, flakyRate: null, ref: null, runUrl: null, reportKeys: [] });
    const d = await service.ingest(input({ metrics: { coverageLines: 80 } }));
    expect(d.coverage).toEqual({ lines: 80, branches: null });
    const c = await service.ingest(input({}));
    expect(c).toMatchObject({ coverage: null, lint: null, tests: {}, security: {}, tools: [] });
  });

  it('relatórios inválidos viram avisos sem impedir o restante', async () => {
    const snap = await service.ingest(
      input({
        sha: 'ABCDEF1',
        owner: 'my org',
        reports: [
          { type: 'lcov', content: 'vazio', tool: 'jest' },
          { type: 'sarif', content: '{}' },
          { type: 'junit', category: 'e2e', content: JUNIT },
        ],
      }),
    );
    expect(snap.warnings).toEqual(['lcov (jest) #1: lcov sem linhas (LF)', 'sarif #2: SARIF sem "runs"']);
    expect(snap.tests.e2e?.total).toBe(3);
    expect(snap.tools).toEqual(['jest']);
    expect(snap.reportKeys[0]).toMatch(/^ci-reports\/my_org\/api\/ABCDEF1\//);
  });

  it('média de cobertura ignora valores ausentes', async () => {
    const snap = await service.ingest(
      input({
        reports: [
          { type: 'cobertura', content: '<coverage branch-rate="0.4">' },
          { type: 'lcov', content: LCOV },
        ],
      }),
    );
    expect(snap.coverage).toEqual({ lines: 80, branches: 45 });
  });

  it('erro não-Error do bucket também vira aviso', async () => {
    class StringFailStorage extends MemoryObjectStorage {
      override put(): never {
        // oxlint-disable-next-line no-throw-literal
        throw 'cota excedida';
      }
    }
    const db = await testDatabase();
    const s = new MetricsService(
      new PgRepoMetricsRepository(db),
      { refreshQuality } as Partial<IIntrospectionService> as IIntrospectionService,
      new StringFailStorage(),
    );
    const snap = await s.ingest(input({ reports: [{ type: 'lcov', content: LCOV }] }));
    expect(snap.warnings).toEqual(['não foi possível guardar o relatório 1: cota excedida']);
  });

  it('falha ao guardar no bucket vira aviso', async () => {
    storage.failPuts = true;
    const snap = await service.ingest(input({ reports: [{ type: 'junit', content: JUNIT }] }));
    expect(snap.reportKeys).toEqual([]);
    expect(snap.warnings).toEqual(['não foi possível guardar o relatório 1: storage indisponível']);
  });

  it('devolve o histórico do mais novo para o mais antigo', async () => {
    await service.ingest(input({ sha: 'aaaaaaa' }));
    await service.ingest(input({ sha: 'bbbbbbb' }));
    await service.ingest({ ...input({ sha: 'ccccccc' }), repo: 'other' });
    const history = await service.history('ACME', 'api');
    expect(history.map((h) => h.sha)).toEqual(['bbbbbbb', 'aaaaaaa']);
  });
});
