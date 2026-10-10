import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import pg from 'pg';
import type { IDatabase, RunResult, SqlValue } from './IDatabase.ts';
import type { Migration } from './migrations.ts';

export interface PostgresOptions {
  url: string;
  /** disable | require (TLS sem verificar) | verify-full (TLS verificando o certificado, ex.: RDS). */
  ssl: 'disable' | 'require' | 'verify-full';
  /** Caminho de um bundle de CA (ex.: global-bundle.pem da AWS). */
  sslCa: string | null;
  poolMax: number;
}

// Datas como ISO e bigint/numeric como número (ids e contagens cabem em Number).
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => new Date(`${v}Z`).toISOString());
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

const MIGRATION_LOCK = 724_031;

/** Converte placeholders `?` em `$n` (ignora `?` dentro de strings e de identificadores entre aspas). */
export function toPositional(sql: string): string {
  let out = '';
  let n = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') out += `$${++n}`;
    else out += ch;
  }
  return out;
}

const normalize = (params: readonly SqlValue[]) => params.map((p) => (typeof p === 'bigint' ? p.toString() : p instanceof Uint8Array ? Buffer.from(p) : p));

export class PostgresDatabase implements IDatabase {
  private readonly pool: pg.Pool;
  private readonly tx = new AsyncLocalStorage<pg.PoolClient>();

  constructor(options: PostgresOptions) {
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.poolMax,
      ssl:
        options.ssl === 'disable'
          ? false
          : { rejectUnauthorized: options.ssl === 'verify-full', ...(options.sslCa ? { ca: fs.readFileSync(options.sslCa, 'utf8') } : {}) },
      // Falha rápido se o banco não responder (o boot tenta de novo).
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      application_name: 'comm-graph',
    });
    // Erro numa conexão ociosa não pode derrubar o processo.
    this.pool.on('error', (err) => console.error('[db] conexão ociosa com erro:', err.message));
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return (await this.query(sql, params)).rows as T[];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return ((await this.query(sql, params)).rows[0] as T | undefined) ?? null;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    return { changes: (await this.query(sql, params)).rowCount ?? 0 };
  }

  async insert(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    const withReturning = /\breturning\b/i.test(sql) ? sql : `${sql.trimEnd().replace(/;$/, '')} RETURNING id`;
    const row = (await this.query(withReturning, params)).rows[0] as { id: number } | undefined;
    if (!row) throw new Error('INSERT não retornou id');
    return Number(row.id);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.tx.getStore()) return fn();
    const client = await this.pool.connect();
    // Com o cliente emprestado, o pool não escuta os erros dele: sem este listener uma queda de conexão
    // (failover do RDS, pg_terminate_backend…) viraria exceção não tratada e derrubaria o processo.
    client.on('error', this.onClientError);
    try {
      await client.query('BEGIN');
      const result = await this.tx.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.off('error', this.onClientError);
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Espera o banco aceitar conexões (útil com banco gerenciado ou container subindo junto). */
  async waitUntilReady(attempts = 30, delayMs = 2000): Promise<void> {
    for (let i = 1; ; i++) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (err) {
        if (i >= attempts) throw err;
        console.warn(`[db] aguardando o banco (${i}/${attempts}): ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  /** Aplica as migrações pendentes; um lock evita duas instâncias migrando ao mesmo tempo. */
  async migrate(migrations: readonly Migration[]): Promise<void> {
    const client = await this.pool.connect();
    // Com o cliente emprestado, o pool não escuta os erros dele: sem este listener uma queda de conexão
    // (failover do RDS, pg_terminate_backend…) viraria exceção não tratada e derrubaria o processo.
    client.on('error', this.onClientError);
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const applied = new Set((await client.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
      for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
        if (applied.has(m.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
          await client.query('COMMIT');
          console.log(`[db] migração ${m.version} aplicada: ${m.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migração ${m.version} (${m.name}) falhou: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
      client.off('error', this.onClientError);
      client.release();
    }
  }

  private readonly onClientError = (err: Error): void => {
    console.error('[db] conexão em uso caiu:', err.message);
  };

  private query(sql: string, params: readonly SqlValue[]) {
    const runner = this.tx.getStore() ?? this.pool;
    return runner.query(toPositional(sql), normalize(params) as unknown[]);
  }
}
