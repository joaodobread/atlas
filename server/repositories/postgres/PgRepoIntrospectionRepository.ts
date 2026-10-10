import { attentionOf } from '../../../shared/repoHealth.ts';
import type {
  IntrospectionStatus,
  QualityReport,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
  RepoMetricsSnapshot,
  RepoActivity,
  RepoFacts,
  RepoProcess,
  ScoreHistoryPoint,
} from '../../../shared/types.ts';
import type { AnalysisDepth, IntrospectionStage } from '../../../shared/constants.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { IntrospectionOutcome, IRepoIntrospectionRepository, RepoMetadata } from '../contracts/IRepoIntrospectionRepository.ts';

interface Row {
  id: number;
  owner: string;
  name: string;
  description: string | null;
  default_branch: string | null;
  language: string | null;
  archived: boolean;
  pushed_at: string | null;
  html_url: string | null;
  analyzed_sha: string | null;
  status: IntrospectionStatus;
  error: string | null;
  score: number | null;
  facts_json: string | null;
  quality_json: string | null;
  analysis_json: string | null;
  proposal_json: string | null;
  document_id: number | null;
  node_id: number | null;
  analysis_depth: AnalysisDepth | null;
  process_json: string | null;
  activity_json: string | null;
  cp_depth: AnalysisDepth | null;
  cp_stage: IntrospectionStage | null;
  cp_done: number | null;
  cp_total: number | null;
  cp_updated_at: string | null;
  system_name: string | null;
  metrics_json: string | null;
  trend_json: string | null;
  analyzed_at: string | null;
  applied_at: string | null;
}

type Detail = Omit<RepoIntrospectionDetail, 'metrics' | 'history'>;

/** Repositório + sistema (pai do nó ligado), métricas mais recentes e últimas notas. */
const SELECT = `
  SELECT r.*, COALESCE(p.name, n.name) AS system_name,
    cp.depth AS cp_depth, cp.stage AS cp_stage, cp.done AS cp_done, cp.total AS cp_total, cp.updated_at AS cp_updated_at,
    (SELECT data_json FROM repo_metrics m WHERE lower(m.owner) = lower(r.owner) AND lower(m.repo) = lower(r.name) ORDER BY m.id DESC LIMIT 1) AS metrics_json,
    (SELECT json_agg(score)::text FROM (SELECT score FROM repo_score_history h WHERE h.repo_id = r.id ORDER BY h.id DESC LIMIT 12) last) AS trend_json
  FROM repo_introspections r
  LEFT JOIN nodes n ON n.id = r.node_id
  LEFT JOIN nodes p ON p.id = n.parent_id
  LEFT JOIN introspection_checkpoints cp ON cp.repo_id = r.id`;

const json = <T>(text: string | null): T | null => (text ? (JSON.parse(text) as T) : null);

const summary = (r: Row): RepoIntrospectionSummary => {
  const quality = json<QualityReport>(r.quality_json);
  const metrics = json<Pick<RepoMetricsSnapshot, 'coverage' | 'security'>>(r.metrics_json);
  const sec = metrics ? Object.values(metrics.security) : [];
  const intel = json<Pick<RepoFacts, 'intel'>>(r.facts_json)?.intel;
  const activity = json<RepoActivity>(r.activity_json);
  const vulnerabilities = intel?.vulnerabilities ? intel.vulnerabilities.length : null;
  const runtimeEol = intel?.runtimeSupport ? !intel.runtimeSupport.supported : null;
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    description: r.description,
    language: r.language,
    archived: r.archived,
    pushedAt: r.pushed_at,
    htmlUrl: r.html_url,
    status: r.status,
    error: r.error,
    score: r.score,
    analyzedAt: r.analyzed_at,
    appliedAt: r.applied_at,
    documentId: r.document_id,
    stale: !!r.analyzed_at && !!r.pushed_at && Date.parse(r.pushed_at) > Date.parse(r.analyzed_at),
    confidence: quality?.confidence ?? null,
    nodeId: r.node_id,
    system: r.system_name,
    hasMetrics: metrics != null,
    analysisDepth: r.analysis_depth,
    coverage: metrics?.coverage?.lines ?? null,
    securityFindings: sec.length ? sec.reduce((a, c) => a + c.critical + c.high + c.medium + c.low, 0) : null,
    failingCategories: quality?.categories.filter((c) => c.score != null && c.score < 5).map((c) => c.category) ?? [],
    trend: (json<Array<number | null>>(r.trend_json) ?? []).reverse(),
    activity,
    vulnerabilities,
    runtimeEol,
    attention: attentionOf({ archived: r.archived, pushedAt: r.pushed_at, activity, vulnerabilities, runtimeEol, score: r.score }),
    resumable:
      r.cp_depth && r.cp_stage && r.cp_updated_at
        ? { depth: r.cp_depth, stage: r.cp_stage, done: r.cp_done, total: r.cp_total, updatedAt: r.cp_updated_at }
        : null,
  };
};

export class PgRepoIntrospectionRepository implements IRepoIntrospectionRepository {
  constructor(private readonly db: IDatabase) {}

  async list(owner: string): Promise<RepoIntrospectionSummary[]> {
    return (await this.db.all<Row>(`${SELECT} WHERE r.owner = ? ORDER BY r.pushed_at DESC NULLS LAST, r.name`, [owner])).map(summary);
  }

  async findById(id: number): Promise<Detail | null> {
    const r = await this.db.get<Row>(`${SELECT} WHERE r.id = ?`, [id]);
    return r ? this.detail(r) : null;
  }

  async findByName(owner: string, name: string): Promise<Detail | null> {
    const r = await this.db.get<Row>(`${SELECT} WHERE lower(r.owner) = lower(?) AND lower(r.name) = lower(?)`, [owner, name]);
    return r ? this.detail(r) : null;
  }

  async upsertMetadata(m: RepoMetadata): Promise<void> {
    await this.db.run(
      `INSERT INTO repo_introspections (owner, name, description, default_branch, language, archived, fork, pushed_at, html_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner, name) DO UPDATE SET
         description = excluded.description, default_branch = excluded.default_branch, language = excluded.language,
         archived = excluded.archived, fork = excluded.fork, pushed_at = excluded.pushed_at, html_url = excluded.html_url,
         updated_at = now()`,
      [m.owner, m.name, m.description, m.defaultBranch, m.language, m.archived, m.fork, m.pushedAt, m.htmlUrl],
    );
  }

  async deleteMissing(owner: string, keepNames: readonly string[]): Promise<void> {
    await this.db.run('DELETE FROM repo_introspections WHERE owner = ? AND NOT (name = ANY(?::text[]))', [owner, [...keepNames]]);
  }

  async analyzedSha(id: number): Promise<string | null> {
    return (await this.db.get<{ analyzed_sha: string | null }>('SELECT analyzed_sha FROM repo_introspections WHERE id = ?', [id]))?.analyzed_sha ?? null;
  }

  async setStatus(id: number, status: IntrospectionStatus, error: string | null = null): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET status = ?, error = ?, updated_at = now() WHERE id = ?', [status, error, id]);
  }

  async saveOutcome(id: number, o: IntrospectionOutcome): Promise<void> {
    await this.db.run(
      `UPDATE repo_introspections SET status = 'done', error = ?, analyzed_sha = ?, analysis_depth = ?, score = ?, facts_json = ?, quality_json = ?,
         analysis_json = ?, proposal_json = ?, document_id = ?, analyzed_at = now(), updated_at = now()
       WHERE id = ?`,
      [
        o.warning ?? null,
        o.sha,
        o.depth,
        o.quality.score,
        JSON.stringify(o.facts),
        JSON.stringify(o.quality),
        JSON.stringify(o.analysis),
        JSON.stringify(o.proposal),
        o.documentId,
        id,
      ],
    );
  }

  async saveQuality(id: number, quality: QualityReport): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET quality_json = ?, score = ?, updated_at = now() WHERE id = ?', [
      JSON.stringify(quality),
      quality.score,
      id,
    ]);
  }

  async markApplied(id: number): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET applied_at = now() WHERE id = ?', [id]);
  }

  async saveProcess(id: number, process: RepoProcess): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET process_json = ? WHERE id = ?', [JSON.stringify(process), id]);
  }

  async saveActivity(id: number, activity: RepoActivity): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET activity_json = ? WHERE id = ?', [JSON.stringify(activity), id]);
  }

  async linkNode(id: number, nodeId: number | null): Promise<void> {
    await this.db.run('UPDATE repo_introspections SET node_id = ? WHERE id = ?', [nodeId, id]);
  }

  async addHistory(id: number, q: QualityReport): Promise<void> {
    await this.db.run('INSERT INTO repo_score_history (repo_id, score, confidence, version, categories_json) VALUES (?, ?, ?, ?, ?)', [
      id,
      q.score,
      q.confidence,
      q.version,
      JSON.stringify(q.categories.map((c) => ({ category: c.category, score: c.score }))),
    ]);
  }

  async history(id: number, limit: number): Promise<ScoreHistoryPoint[]> {
    const rows = await this.db.all<{ score: number | null; confidence: number; version: string; created_at: string }>(
      'SELECT score, confidence, version, created_at FROM repo_score_history WHERE repo_id = ? ORDER BY id DESC LIMIT ?',
      [id, limit],
    );
    return rows.map((h) => ({ score: h.score, confidence: h.confidence, version: h.version, createdAt: h.created_at })).reverse();
  }

  async resetRunning(): Promise<void> {
    await this.db.run(`UPDATE repo_introspections SET status = 'pending' WHERE status = 'running'`);
  }

  private detail(r: Row): Detail {
    return {
      ...summary(r),
      defaultBranch: r.default_branch,
      facts: json(r.facts_json),
      quality: json<QualityReport>(r.quality_json),
      analysis: json(r.analysis_json),
      proposal: json(r.proposal_json),
      process: json<RepoProcess>(r.process_json),
    };
  }
}
