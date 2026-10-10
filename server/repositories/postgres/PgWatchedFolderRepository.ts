import type { WatchedFolder } from '../../../shared/types.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { IWatchedFolderRepository } from '../contracts/IWatchedFolderRepository.ts';

const SELECT = `SELECT f.*, (SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id)::int AS "documentCount" FROM watched_folders f`;

export class PgWatchedFolderRepository implements IWatchedFolderRepository {
  constructor(private readonly db: IDatabase) {}

  list(): Promise<WatchedFolder[]> {
    return this.db.all<WatchedFolder>(`${SELECT} ORDER BY f.path`);
  }

  findById(id: number): Promise<WatchedFolder | null> {
    return this.db.get<WatchedFolder>(`${SELECT} WHERE f.id = ?`, [id]);
  }

  findByPath(path: string): Promise<WatchedFolder | null> {
    return this.db.get<WatchedFolder>(`${SELECT} WHERE f.path = ?`, [path]);
  }

  async insert(path: string): Promise<WatchedFolder> {
    const id = await this.db.insert('INSERT INTO watched_folders (path) VALUES (?)', [path]);
    return (await this.findById(id))!;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.run('DELETE FROM watched_folders WHERE id = ?', [id])).changes > 0;
  }

  async touchScan(id: number): Promise<void> {
    await this.db.run('UPDATE watched_folders SET last_scan_at = now() WHERE id = ?', [id]);
  }
}
