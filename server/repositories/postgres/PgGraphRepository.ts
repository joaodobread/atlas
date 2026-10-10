import type { GraphInfo } from '../../../shared/types.ts';
import type { IDatabase, SqlValue } from '../../infra/database/IDatabase.ts';
import type { IGraphRepository } from '../contracts/IGraphRepository.ts';

const SELECT = `SELECT g.id, g.name::text AS name, g.description, g.created_at, g.updated_at,
  (SELECT COUNT(*) FROM nodes n WHERE n.graph_id = g.id)::int AS "nodeCount" FROM graphs g`;

export class PgGraphRepository implements IGraphRepository {
  constructor(private readonly db: IDatabase) {}

  list(): Promise<GraphInfo[]> {
    return this.db.all<GraphInfo>(`${SELECT} ORDER BY g.id`);
  }

  findById(id: number): Promise<GraphInfo | null> {
    return this.db.get<GraphInfo>(`${SELECT} WHERE g.id = ?`, [id]);
  }

  findByName(name: string): Promise<GraphInfo | null> {
    return this.db.get<GraphInfo>(`${SELECT} WHERE g.name = ?`, [name]);
  }

  async create(name: string, description: string | null): Promise<GraphInfo> {
    const id = await this.db.insert('INSERT INTO graphs (name, description) VALUES (?, ?)', [name, description]);
    return (await this.findById(id))!;
  }

  async update(id: number, data: { name?: string; description?: string | null }): Promise<GraphInfo> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (data.name !== undefined) {
      sets.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      params.push(data.description);
    }
    if (sets.length) await this.db.run(`UPDATE graphs SET ${sets.join(', ')}, updated_at = now() WHERE id = ?`, [...params, id]);
    return (await this.findById(id))!;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM graphs WHERE id = ?', [id])).changes > 0;
  }

  async count(): Promise<number> {
    return (await this.db.get<{ c: number }>('SELECT COUNT(*)::int AS c FROM graphs'))!.c;
  }
}
