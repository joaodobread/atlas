import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { ISettingsRepository } from '../contracts/ISettingsRepository.ts';

export class PgSettingsRepository implements ISettingsRepository {
  constructor(private readonly db: IDatabase) {}

  async get(key: string): Promise<unknown> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}
