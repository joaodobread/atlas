export type SqlValue = string | number | bigint | boolean | null | Date | Uint8Array | readonly number[] | readonly string[];

export interface RunResult {
  /** Linhas afetadas. */
  changes: number;
}

/**
 * Acesso ao banco. Parâmetros com `?` (convertidos para $1, $2… pelo driver).
 * `transaction` é reentrante: chamadas aninhadas reaproveitam a transação externa.
 */
export interface IDatabase {
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  /** INSERT … e devolve o `id` gerado (acrescenta RETURNING id se faltar). */
  insert(sql: string, params?: readonly SqlValue[]): Promise<number>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
