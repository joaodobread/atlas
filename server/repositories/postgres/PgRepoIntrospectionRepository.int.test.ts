import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { QualityReport, RepoAnalysis, RepoFacts, RepoGraphProposal, RepoProcess } from '../../../shared/types.ts';
import type { IntrospectionOutcome, RepoMetadata } from '../contracts/IRepoIntrospectionRepository.ts';
import { PgNodeRepository } from './PgNodeRepository.ts';
import { PgRepoIntrospectionRepository } from './PgRepoIntrospectionRepository.ts';
import { PgRepoMetricsRepository } from './PgRepoMetricsRepository.ts';

const meta = (over: Partial<RepoMetadata> = {}): RepoMetadata => ({
  owner: 'acme',
  name: 'api',
  description: 'API principal',
  defaultBranch: 'main',
  language: 'TypeScript',
  archived: false,
  fork: false,
  pushedAt: '2025-01-10T00:00:00.000Z',
  htmlUrl: 'https://github.com/acme/api',
  ...over,
});

const quality = (score: number | null, cats: Array<[QualityReport['categories'][number]['category'], number | null]> = []): QualityReport => ({
  version: 'q1',
  score,
  confidence: 0.75,
  categories: cats.map(([category, s]) => ({ category, label: category, weight: 1, score: s, checks: [] })),
});

const outcome = (over: Partial<IntrospectionOutcome> = {}): IntrospectionOutcome => ({
  sha: 'sha1',
  depth: 'medium',
  facts: { files: 10 } as unknown as RepoFacts,
  quality: quality(7, [
    ['ci', 8],
    ['tests', 3],
    ['docs', null],
  ]),
  analysis: { purpose: 'x' } as unknown as RepoAnalysis,
  proposal: { nodes: [] } as unknown as RepoGraphProposal,
  documentId: null,
  ...over,
});

describe('PgRepoIntrospectionRepository', () => {
  let repo: PgRepoIntrospectionRepository;
  let nodes: PgNodeRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgRepoIntrospectionRepository(db);
    nodes = new PgNodeRepository(db);
  });

  const idOf = async (owner = 'acme', name = 'api') => (await repo.findByName(owner, name))!.id;

  it('upsertMetadata cria com status pendente e resumo sem análise', async () => {
    await repo.upsertMetadata(meta());
    const d = await repo.findByName('ACME', 'API');
    expect(d).toEqual({
      id: expect.any(Number),
      owner: 'acme',
      name: 'api',
      description: 'API principal',
      language: 'TypeScript',
      archived: false,
      pushedAt: '2025-01-10T00:00:00.000Z',
      htmlUrl: 'https://github.com/acme/api',
      status: 'pending',
      error: null,
      score: null,
      analyzedAt: null,
      appliedAt: null,
      documentId: null,
      stale: false,
      confidence: null,
      nodeId: null,
      system: null,
      hasMetrics: false,
      analysisDepth: null,
      coverage: null,
      securityFindings: null,
      failingCategories: [],
      trend: [],
      activity: null,
      vulnerabilities: null,
      runtimeEol: null,
      // Fixture com push antigo: a saúde já aponta o repositório parado.
      attention: { level: 'attention', reasons: [expect.stringMatching(/^Sem commits há \d+ meses$/)] },
      resumable: null,
      defaultBranch: 'main',
      facts: null,
      quality: null,
      analysis: null,
      proposal: null,
      process: null,
    });
    expect(await repo.findById(d!.id)).toEqual(d);
    expect(await repo.findById(9999)).toBeNull();
    expect(await repo.findByName('acme', 'nada')).toBeNull();
  });

  it('upsertMetadata atualiza metadados sem mexer na análise', async () => {
    await repo.upsertMetadata(meta());
    const id = await idOf();
    await repo.saveOutcome(id, outcome());
    await repo.upsertMetadata(meta({ description: 'nova', archived: true, language: null }));
    const d = (await repo.findById(id))!;
    expect(d).toMatchObject({ description: 'nova', archived: true, language: null, status: 'done', score: 7 });
  });

  it('list filtra pelo dono e ordena por push mais recente (nulos por último), depois nome', async () => {
    await repo.upsertMetadata(meta({ name: 'velho', pushedAt: '2020-01-01T00:00:00Z' }));
    await repo.upsertMetadata(meta({ name: 'zeta', pushedAt: null }));
    await repo.upsertMetadata(meta({ name: 'alpha', pushedAt: null }));
    await repo.upsertMetadata(meta({ name: 'novo', pushedAt: '2025-01-01T00:00:00Z' }));
    await repo.upsertMetadata(meta({ owner: 'outro', name: 'x' }));
    expect((await repo.list('acme')).map((r) => r.name)).toEqual(['novo', 'velho', 'alpha', 'zeta']);
  });

  it('listDetails traz fatos e scorecard dos repositórios do dono, por nome', async () => {
    await repo.upsertMetadata(meta({ name: 'web' }));
    await repo.upsertMetadata(meta({ name: 'api' }));
    await repo.upsertMetadata(meta({ owner: 'outro', name: 'x' }));
    await repo.saveOutcome(await idOf('acme', 'web'), outcome());
    const list = await repo.listDetails('acme');
    expect(list.map((r) => [r.name, r.quality?.score ?? null, r.facts != null])).toEqual([
      ['api', null, false],
      ['web', 7, true],
    ]);
  });

  it('deleteMissing remove só os repositórios do dono que não vieram mais', async () => {
    for (const name of ['a', 'b', 'c']) await repo.upsertMetadata(meta({ name }));
    await repo.upsertMetadata(meta({ owner: 'outro', name: 'a' }));
    await repo.deleteMissing('acme', ['a', 'c']);
    expect((await repo.list('acme')).map((r) => r.name).sort()).toEqual(['a', 'c']);
    expect(await repo.list('outro')).toHaveLength(1);
    await repo.deleteMissing('acme', []);
    expect(await repo.list('acme')).toEqual([]);
  });

  it('setStatus, saveOutcome e analyzedSha', async () => {
    await repo.upsertMetadata(meta());
    const id = await idOf();
    expect(await repo.analyzedSha(id)).toBeNull();
    expect(await repo.analyzedSha(9999)).toBeNull();

    await repo.setStatus(id, 'running');
    expect((await repo.findById(id))?.status).toBe('running');
    await repo.setStatus(id, 'error', 'falhou');
    expect(await repo.findById(id)).toMatchObject({ status: 'error', error: 'falhou' });

    const db = await testDatabase();
    const docId = await db.insert("INSERT INTO documents (path, title, source, content, hash) VALUES ('r', 'r', 'api', 'c', 'h')");
    const o = outcome({ documentId: docId });
    await repo.saveOutcome(id, o);
    const d = (await repo.findById(id))!;
    expect(d).toMatchObject({
      status: 'done',
      error: null,
      score: 7,
      analysisDepth: 'medium',
      documentId: docId,
      confidence: 0.75,
      failingCategories: ['tests'],
      facts: o.facts,
      quality: o.quality,
      analysis: o.analysis,
      proposal: o.proposal,
    });
    expect(d.analyzedAt).toMatch(/Z$/);
    expect(await repo.analyzedSha(id)).toBe('sha1');
  });

  it('stale quando houve push depois da análise', async () => {
    await repo.upsertMetadata(meta({ pushedAt: '2000-01-01T00:00:00Z' }));
    const id = await idOf();
    await repo.saveOutcome(id, outcome());
    expect((await repo.findById(id))?.stale).toBe(false);
    await repo.upsertMetadata(meta({ pushedAt: '2999-01-01T00:00:00Z' }));
    expect((await repo.findById(id))?.stale).toBe(true);
    await repo.upsertMetadata(meta({ pushedAt: null }));
    expect((await repo.findById(id))?.stale).toBe(false);
  });

  it('saveQuality atualiza só o scorecard e a nota', async () => {
    await repo.upsertMetadata(meta());
    const id = await idOf();
    await repo.saveQuality(id, quality(null, [['security', 2]]));
    expect(await repo.findById(id)).toMatchObject({ score: null, status: 'pending', failingCategories: ['security'], confidence: 0.75 });
  });

  it('markApplied, saveProcess e resetRunning', async () => {
    await repo.upsertMetadata(meta());
    await repo.upsertMetadata(meta({ name: 'outro' }));
    const id = await idOf();
    const other = await idOf('acme', 'outro');
    await repo.markApplied(id);
    const process: RepoProcess = {
      windowDays: 90,
      collectedAt: '2025-01-01T00:00:00Z',
      mergedPrs: 3,
      reviewedPrs: 2,
      linkedPrs: 1,
      directPushes: null,
      commits: 10,
      topAuthorShare: 0.5,
      openPrs: 1,
      staleOpenPrs: 0,
      unreviewedOldPrs: 0,
      errors: [],
    };
    await repo.saveProcess(id, process);
    const d = (await repo.findById(id))!;
    expect(d.appliedAt).toMatch(/Z$/);
    expect(d.process).toEqual(process);

    const activity = { collectedAt: '2026-01-01T00:00:00Z', openPrs: 2, draftPrs: 1, oldPrs: 1, pulls: [], error: null };
    await repo.saveActivity(id, activity);
    expect((await repo.findById(id))?.activity).toEqual(activity);

    await repo.setStatus(id, 'running');
    await repo.setStatus(other, 'done');
    await repo.resetRunning();
    expect((await repo.findById(id))?.status).toBe('pending');
    expect((await repo.findById(other))?.status).toBe('done');
  });

  it('linkNode: sistema é o pai do nó ligado ou o próprio nó quando é raiz', async () => {
    await repo.upsertMetadata(meta());
    const id = await idOf();
    const sys = await nodes.create({ graph_id: 1, name: 'Pagamentos', kind: 'project' });
    const svc = await nodes.create({ graph_id: 1, name: 'api', kind: 'service', parent_id: sys.id });
    await repo.linkNode(id, svc.id);
    expect(await repo.findById(id)).toMatchObject({ nodeId: svc.id, system: 'Pagamentos' });
    await repo.linkNode(id, sys.id);
    expect(await repo.findById(id)).toMatchObject({ nodeId: sys.id, system: 'Pagamentos' });
    await repo.linkNode(id, null);
    expect(await repo.findById(id)).toMatchObject({ nodeId: null, system: null });
  });

  it('resumo usa as métricas mais recentes do repositório (cobertura e soma de achados)', async () => {
    await repo.upsertMetadata(meta({ owner: 'Acme', name: 'Api' }));
    const id = await idOf('acme', 'api');
    const metrics = new PgRepoMetricsRepository(await testDatabase());
    const base = { tests: {}, tools: [], mutationScore: null, flakyRate: null, lint: null, warnings: [] };
    await metrics.insert({
      owner: 'acme',
      repo: 'api',
      sha: '1',
      ref: null,
      runUrl: null,
      reportKeys: [],
      data: { ...base, coverage: { lines: 50, branches: null }, security: {} },
    });
    let d = (await repo.findById(id))!;
    expect(d).toMatchObject({ hasMetrics: true, coverage: 50, securityFindings: null });

    await metrics.insert({
      owner: 'ACME',
      repo: 'API',
      sha: '2',
      ref: null,
      runUrl: null,
      reportKeys: [],
      data: {
        ...base,
        coverage: null,
        security: { sast: { critical: 1, high: 2, medium: 3, low: 4 }, sca: { critical: 0, high: 0, medium: 0, low: 5 } },
      },
    });
    d = (await repo.findById(id))!;
    expect(d).toMatchObject({ hasMetrics: true, coverage: null, securityFindings: 15 });
  });

  it('histórico: addHistory/history (ordem cronológica e limite) e trend das últimas 12 notas', async () => {
    await repo.upsertMetadata(meta());
    const id = await idOf();
    const scores = Array.from({ length: 14 }, (_, i) => (i === 13 ? null : i));
    for (const s of scores) await repo.addHistory(id, quality(s, [['ci', s]]));

    const h = await repo.history(id, 3);
    expect(h.map((p) => p.score)).toEqual([11, 12, null]);
    expect(h[0]).toEqual({ score: 11, confidence: 0.75, version: 'q1', createdAt: expect.stringMatching(/Z$/) });
    expect(await repo.history(9999, 3)).toEqual([]);

    const db = await testDatabase();
    expect(await db.get('SELECT categories_json FROM repo_score_history ORDER BY id LIMIT 1')).toEqual({
      categories_json: JSON.stringify([{ category: 'ci', score: 0 }]),
    });

    const [summary] = await repo.list('acme');
    expect(summary.trend).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null]);
  });
});
