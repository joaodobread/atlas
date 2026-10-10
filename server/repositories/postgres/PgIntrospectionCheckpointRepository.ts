import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { IIntrospectionCheckpointRepository, IntrospectionCheckpoint } from '../contracts/IIntrospectionCheckpointRepository.ts';

export class PgIntrospectionCheckpointRepository implements IIntrospectionCheckpointRepository {
  constructor(private readonly db: IDatabase) {}

  async get(repoId: number): Promise<IntrospectionCheckpoint | null> {
    const row = await this.db.get<{ data_json: string }>('SELECT data_json FROM introspection_checkpoints WHERE repo_id = ?', [repoId]);
    return row ? (JSON.parse(row.data_json) as IntrospectionCheckpoint) : null;
  }

  async save(repoId: number, cp: IntrospectionCheckpoint): Promise<void> {
    await this.db.run(
      `INSERT INTO introspection_checkpoints (repo_id, sha, depth, stage, done, total, data_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, now())
       ON CONFLICT (repo_id) DO UPDATE SET sha = excluded.sha, depth = excluded.depth, stage = excluded.stage,
         done = excluded.done, total = excluded.total, data_json = excluded.data_json, updated_at = now()`,
      [repoId, cp.sha, cp.depth, cp.stage, cp.done, cp.total, JSON.stringify(cp)],
    );
  }

  async clear(repoId: number): Promise<void> {
    await this.db.run('DELETE FROM introspection_checkpoints WHERE repo_id = ?', [repoId]);
  }
}
