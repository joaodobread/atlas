import { NotFoundError } from '../../core/errors/AppError.ts';
import type { IDatabase, SqlValue } from '../../infra/database/IDatabase.ts';
import type { ICrudRepository } from '../contracts/ICrudRepository.ts';

/**
 * Base para repositórios Postgres. Apenas colunas presentes em `writableColumns`
 * são gravadas, então nenhum campo arbitrário chega ao SQL.
 */
export abstract class PgCrudRepository<TEntity, TCreate extends object, TUpdate extends object> implements ICrudRepository<TEntity, TCreate, TUpdate> {
  protected abstract readonly table: string;
  protected abstract readonly writableColumns: readonly string[];
  protected readonly orderBy: string = 'id';
  protected readonly touchUpdatedAt: boolean = false;

  constructor(protected readonly db: IDatabase) {}

  findAll(): Promise<TEntity[]> {
    return this.db.all<TEntity>(`SELECT * FROM ${this.table} ORDER BY ${this.orderBy}`);
  }

  findById(id: number): Promise<TEntity | null> {
    return this.db.get<TEntity>(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);
  }

  async exists(id: number): Promise<boolean> {
    return (await this.db.get(`SELECT 1 FROM ${this.table} WHERE id = ?`, [id])) !== null;
  }

  async create(data: TCreate): Promise<TEntity> {
    const [cols, values] = this.columnsOf(data);
    const sql = cols.length
      ? `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      : `INSERT INTO ${this.table} DEFAULT VALUES`;
    const id = await this.db.insert(sql, values);
    return (await this.findById(id))!;
  }

  async update(id: number, data: TUpdate): Promise<TEntity> {
    const [cols, values] = this.columnsOf(data);
    const sets = cols.map((c) => `${c} = ?`);
    if (sets.length && this.touchUpdatedAt) sets.push('updated_at = now()');
    if (sets.length) await this.db.run(`UPDATE ${this.table} SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
    const entity = await this.findById(id);
    if (!entity) throw new NotFoundError(`${this.table} ${id} não encontrado`);
    return entity;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, [id])).changes > 0;
  }

  private columnsOf(data: object): [string[], SqlValue[]] {
    const cols: string[] = [];
    const values: SqlValue[] = [];
    for (const col of this.writableColumns) {
      const value = (data as Record<string, unknown>)[col];
      if (value === undefined) continue;
      cols.push(col);
      values.push(value as SqlValue);
    }
    return [cols, values];
  }
}
