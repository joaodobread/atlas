import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { MetricsData, NewMetrics } from '../contracts/IRepoMetricsRepository.ts';
import { PgRepoMetricsRepository } from './PgRepoMetricsRepository.ts';

const data = (lines: number): MetricsData => ({
  coverage: { lines, branches: null },
  tests: { unit: { total: 10, passed: 9, failed: 1, skipped: 0 } },
  security: { sast: { critical: 0, high: 1, medium: 2, low: 3 } },
  tools: ['vitest'],
  mutationScore: null,
  flakyRate: null,
  lint: { errors: 0, warnings: 2 },
  warnings: [],
});

const metrics = (over: Partial<NewMetrics> = {}): NewMetrics => ({
  owner: 'Acme',
  repo: 'Api',
  sha: 'abc',
  ref: 'refs/heads/main',
  runUrl: 'https://ci/1',
  data: data(80),
  reportKeys: ['reports/junit.xml'],
  ...over,
});

describe('PgRepoMetricsRepository', () => {
  let repo: PgRepoMetricsRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgRepoMetricsRepository(db);
  });

  it('insert devolve o snapshot completo (dados JSON + metadados)', async () => {
    const s = await repo.insert(metrics());
    expect(s).toEqual({
      ...data(80),
      id: expect.any(Number),
      owner: 'Acme',
      repo: 'Api',
      sha: 'abc',
      ref: 'refs/heads/main',
      runUrl: 'https://ci/1',
      receivedAt: expect.stringMatching(/Z$/),
      reportKeys: ['reports/junit.xml'],
    });
  });

  it('ref/runUrl nulos e report_keys ausente no banco viram []', async () => {
    const s = await repo.insert(metrics({ ref: null, runUrl: null, reportKeys: [] }));
    expect(s).toMatchObject({ ref: null, runUrl: null, reportKeys: [] });
    const db = await testDatabase();
    await db.run('UPDATE repo_metrics SET report_keys = NULL WHERE id = ?', [s.id]);
    expect((await repo.latest('acme', 'api'))?.reportKeys).toEqual([]);
  });

  it('latest (case-insensitive) pega o mais recente; null se não houver', async () => {
    await repo.insert(metrics({ sha: '1', data: data(10) }));
    await repo.insert(metrics({ sha: '2', data: data(20) }));
    await repo.insert(metrics({ repo: 'Outro', sha: '3' }));
    expect(await repo.latest('ACME', 'API')).toMatchObject({ sha: '2', coverage: { lines: 20 } });
    expect(await repo.latest('acme', 'nada')).toBeNull();
  });

  it('history: mais recentes primeiro, com limite', async () => {
    for (const sha of ['1', '2', '3']) await repo.insert(metrics({ sha }));
    expect((await repo.history('acme', 'api', 2)).map((s) => s.sha)).toEqual(['3', '2']);
    expect(await repo.history('x', 'y', 5)).toEqual([]);
  });
});
