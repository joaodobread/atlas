import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import type { NewSecurityReport } from '../contracts/ISecurityReportRepository.ts';
import { PgSecurityReportRepository } from './PgSecurityReportRepository.ts';

const base: NewSecurityReport = {
  scope: 'acme/api',
  kind: 'report',
  focus: null,
  method: 'llm',
  model: 'm1',
  llmError: null,
  score: 72,
  risk: 'high',
  level: 2,
  narrative: { summary: 'ok', highlights: ['a'], risks: [], roadmap: [] },
  tips: null,
  createdBy: null,
};

describe('PgSecurityReportRepository', () => {
  let repo: PgSecurityReportRepository;
  let userId: number;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgSecurityReportRepository(db);
    userId = await db.insert("INSERT INTO users (email, name, password_hash, role) VALUES ('a@x.dev', 'Ana', 'h', 'editor')");
  });

  it('grava relatório e dicas e lista por escopo, mais novos primeiro', async () => {
    const a = await repo.insert({ ...base, createdBy: userId });
    expect(a).toMatchObject({ scope: 'acme/api', kind: 'report', narrative: base.narrative, tips: null, createdBy: 'Ana', score: 72, risk: 'high', level: 2 });
    expect(a.createdAt).toBeTruthy();
    const tip = { title: 't', axis: 'pipeline' as const, why: 'w', how: 'h', effort: 'low' as const };
    const b = await repo.insert({ ...base, kind: 'tips', focus: 'pipeline', method: 'heuristic', model: null, llmError: 'caiu', narrative: null, tips: [tip] });
    expect(b).toMatchObject({ kind: 'tips', focus: 'pipeline', tips: [tip], narrative: null, llmError: 'caiu', createdBy: null });
    await repo.insert({ ...base, scope: '*', tips: null, kind: 'tips' });
    expect((await repo.list('acme/api', 10)).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(await repo.list('acme/api', 1)).toHaveLength(1);
    expect((await repo.list('*', 10))[0]!.tips).toEqual([]);
  });
});
