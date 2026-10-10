// Copia os dados de um banco SQLite antigo do Comm Graph (data/graph.db) para o Postgres configurado.
// O Postgres de destino é migrado e ESVAZIADO antes da cópia (os ids são preservados).
// Uso:
//   npm run migrate:sqlite -- --file data/graph.db [--yes]
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AppConfig } from '../server/config/AppConfig.ts';
import { MIGRATIONS } from '../server/infra/database/migrations.ts';
import { PostgresDatabase } from '../server/infra/database/PostgresDatabase.ts';
import type { SqlValue } from '../server/infra/database/IDatabase.ts';

const args = z
  .object({ file: z.string().min(1), yes: z.boolean() })
  .parse({ file: process.argv[process.argv.indexOf('--file') + 1] ?? 'data/graph.db', yes: process.argv.includes('--yes') });

/** Ordem respeita as chaves estrangeiras. */
const TABLES: Array<{ name: string; columns: string[]; transform?: (row: Record<string, unknown>) => Record<string, unknown> }> = [
  { name: 'graphs', columns: ['id', 'name', 'description', 'created_at', 'updated_at'] },
  { name: 'nodes', columns: ['id', 'graph_id', 'parent_id', 'name', 'kind', 'tech', 'icon', 'description', 'created_at', 'updated_at'] },
  { name: 'interfaces', columns: ['id', 'node_id', 'name', 'type', 'spec', 'description'] },
  { name: 'connections', columns: ['id', 'source_id', 'target_id', 'target_interface_id', 'parent_connection_id', 'protocol', 'description', 'created_at'] },
  { name: 'call_sites', columns: ['id', 'connection_id', 'file_path', 'line', 'symbol', 'snippet', 'notes'] },
  { name: 'watched_folders', columns: ['id', 'path', 'created_at', 'last_scan_at'] },
  {
    name: 'documents',
    columns: [
      'id',
      'path',
      'title',
      'source',
      'folder_id',
      'node_id',
      'content',
      'hash',
      'created_at',
      'updated_at',
      'llm_mentions_hash',
      'llm_mentions_error',
    ],
  },
  {
    name: 'doc_chunks',
    columns: ['id', 'document_id', 'ordinal', 'heading', 'content', 'start_line', 'end_line', 'embedding', 'embedding_model'],
    transform: (r) => ({
      ...r,
      embedding: r.embedding instanceof Uint8Array ? `[${Array.from(new Float32Array(r.embedding.slice().buffer)).join(',')}]` : null,
    }),
  },
  { name: 'chunk_mentions', columns: ['chunk_id', 'node_id', 'matched', 'method', 'confidence'] },
  { name: 'settings', columns: ['key', 'value', 'updated_at'] },
  {
    name: 'users',
    columns: ['id', 'email', 'name', 'password_hash', 'role', 'active', 'created_at', 'updated_at', 'last_login_at'],
    transform: (r) => ({ ...r, active: r.active === 1 }),
  },
  { name: 'sessions', columns: ['token_hash', 'user_id', 'created_at', 'expires_at', 'last_seen_at', 'user_agent'] },
  { name: 'api_tokens', columns: ['id', 'user_id', 'name', 'token_hash', 'prefix', 'created_at', 'last_used_at'] },
  {
    name: 'repo_introspections',
    columns: [
      'id',
      'owner',
      'name',
      'description',
      'default_branch',
      'language',
      'archived',
      'fork',
      'pushed_at',
      'html_url',
      'analyzed_sha',
      'analysis_depth',
      'status',
      'error',
      'score',
      'facts_json',
      'quality_json',
      'analysis_json',
      'proposal_json',
      'process_json',
      'node_id',
      'document_id',
      'analyzed_at',
      'applied_at',
      'updated_at',
    ],
    transform: (r) => ({ ...r, archived: r.archived === 1, fork: r.fork === 1 }),
  },
  { name: 'repo_metrics', columns: ['id', 'owner', 'repo', 'sha', 'ref', 'run_url', 'data_json', 'received_at'] },
  { name: 'repo_score_history', columns: ['id', 'repo_id', 'score', 'confidence', 'version', 'categories_json', 'created_at'] },
];

const TIMESTAMP = /^(created_at|updated_at|last_scan_at|expires_at|last_seen_at|last_login_at|last_used_at|pushed_at|analyzed_at|applied_at|received_at)$/;
/** SQLite guardava "YYYY-MM-DD HH:MM:SS" em UTC (ou ISO do GitHub). */
const toTimestamp = (v: unknown) => (typeof v !== 'string' || !v ? null : v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);

async function main(): Promise<void> {
  const config = AppConfig.fromEnv();
  const source = new DatabaseSync(args.file, { readOnly: true });
  const sourceTables = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name));
  const target = new PostgresDatabase(config.database);
  await target.waitUntilReady(5, 1000);
  await target.migrate(MIGRATIONS);

  const existing = await target.get<{ n: number }>('SELECT (SELECT COUNT(*) FROM nodes) + (SELECT COUNT(*) FROM users) AS n');
  if (existing && existing.n > 0 && !args.yes) {
    throw new Error('O Postgres de destino já tem dados. Rode de novo com --yes para apagá-los e copiar do SQLite.');
  }

  await target.transaction(async () => {
    await target.run(`TRUNCATE ${TABLES.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of TABLES) {
      if (!sourceTables.has(table.name)) continue;
      const sourceCols = new Set((source.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string }>).map((c) => c.name));
      const cols = table.columns.filter((c) => sourceCols.has(c));
      const rows = source.prepare(`SELECT ${cols.join(', ')} FROM ${table.name}`).all() as Array<Record<string, unknown>>;
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200).map((r) => (table.transform ? table.transform(r) : r));
        const values = batch.flatMap((r) => cols.map((c) => (TIMESTAMP.test(c) ? toTimestamp(r[c]) : r[c]) as SqlValue));
        const tuple = `(${cols.map((c) => (c === 'embedding' ? '?::vector' : '?')).join(', ')})`;
        await target.run(`INSERT INTO ${table.name} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE VALUES ${batch.map(() => tuple).join(', ')}`, values);
      }
      console.log(`${table.name}: ${rows.length}`);
    }
    // Identidades continuam do maior id copiado.
    for (const table of TABLES.filter((t) => t.columns.includes('id'))) {
      await target.run(`SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), GREATEST((SELECT MAX(id) FROM ${table.name}), 1))`);
    }
  });
  await target.close();
  console.log('Pronto. Guarde o data/secret.key (ou mantenha o mesmo APP_SECRET): as configurações criptografadas dependem dele.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
