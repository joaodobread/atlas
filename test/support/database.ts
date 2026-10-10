import pg from 'pg';
import { MIGRATIONS } from '../../server/infra/database/migrations.ts';
import { PostgresDatabase } from '../../server/infra/database/PostgresDatabase.ts';

/** URL do Postgres usado nos testes (o banco "<nome>_test" é criado e migrado automaticamente). */
const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://commgraph:commgraph@127.0.0.1:5432/commgraph';

export const TEST_DATABASE_URL = (() => {
  const u = new URL(BASE_URL);
  if (!u.pathname.endsWith('_test')) u.pathname = `${u.pathname}_test`;
  return u.toString();
})();

let shared: PostgresDatabase | null = null;

/** Cria o banco de teste (se faltar), aplica as migrações e devolve a conexão compartilhada. */
export async function testDatabase(): Promise<PostgresDatabase> {
  if (shared) return shared;
  const target = new URL(TEST_DATABASE_URL);
  const admin = new pg.Client({ connectionString: BASE_URL.replace(/\/[^/]*$/, '/postgres') });
  await admin.connect();
  const name = target.pathname.slice(1);
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  await admin.end();
  shared = new PostgresDatabase({ url: TEST_DATABASE_URL, ssl: 'disable', sslCa: null, poolMax: 4 });
  await shared.migrate(MIGRATIONS);
  return shared;
}

/** Esvazia todas as tabelas (menos o controle de migrações) e recria o grafo padrão. */
export async function resetDatabase(db: PostgresDatabase): Promise<void> {
  const tables = await db.all<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'");
  await db.run(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await db.run("INSERT INTO graphs (name) VALUES ('Principal')");
}

export async function closeTestDatabase(): Promise<void> {
  await shared?.close();
  shared = null;
}
