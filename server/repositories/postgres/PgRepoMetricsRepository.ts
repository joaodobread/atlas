import type { RepoMetricsSnapshot } from '../../../shared/types.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { IRepoMetricsRepository, MetricsData, NewMetrics } from '../contracts/IRepoMetricsRepository.ts';

interface Row {
  id: number;
  owner: string;
  repo: string;
  sha: string;
  ref: string | null;
  run_url: string | null;
  data_json: string;
  report_keys: string | null;
  received_at: string;
}

const toSnapshot = (r: Row): RepoMetricsSnapshot => ({
  ...(JSON.parse(r.data_json) as MetricsData),
  id: r.id,
  owner: r.owner,
  repo: r.repo,
  sha: r.sha,
  ref: r.ref,
  runUrl: r.run_url,
  receivedAt: r.received_at,
  reportKeys: r.report_keys ? (JSON.parse(r.report_keys) as string[]) : [],
});

export class PgRepoMetricsRepository implements IRepoMetricsRepository {
  constructor(private readonly db: IDatabase) {}

  async insert(m: NewMetrics): Promise<RepoMetricsSnapshot> {
    const id = await this.db.insert('INSERT INTO repo_metrics (owner, repo, sha, ref, run_url, data_json, report_keys) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      m.owner,
      m.repo,
      m.sha,
      m.ref,
      m.runUrl,
      JSON.stringify(m.data),
      JSON.stringify(m.reportKeys),
    ]);
    return toSnapshot((await this.db.get<Row>('SELECT * FROM repo_metrics WHERE id = ?', [id]))!);
  }

  async latest(owner: string, repo: string): Promise<RepoMetricsSnapshot | null> {
    const r = await this.db.get<Row>('SELECT * FROM repo_metrics WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) ORDER BY id DESC LIMIT 1', [
      owner,
      repo,
    ]);
    return r ? toSnapshot(r) : null;
  }

  async history(owner: string, repo: string, limit: number): Promise<RepoMetricsSnapshot[]> {
    return (
      await this.db.all<Row>('SELECT * FROM repo_metrics WHERE lower(owner) = lower(?) AND lower(repo) = lower(?) ORDER BY id DESC LIMIT ?', [
        owner,
        repo,
        limit,
      ])
    ).map(toSnapshot);
  }
}
