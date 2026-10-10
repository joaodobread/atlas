import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, TEST_DATABASE_URL, testDatabase } from '../../../test/support/database.ts';
import { MIGRATIONS } from './migrations.ts';
import { PostgresDatabase, toPositional } from './PostgresDatabase.ts';

const poolOf = (db: PostgresDatabase) => (db as unknown as { pool: pg.Pool }).pool;
const fresh = () => new PostgresDatabase({ url: TEST_DATABASE_URL, ssl: 'disable', sslCa: null, poolMax: 2 });

describe('toPositional', () => {
  it('converte ? em $n fora de strings e identificadores', () => {
    expect(toPositional(`SELECT '?' AS a, "x?" FROM t WHERE a = ? AND b = ?`)).toBe(`SELECT '?' AS a, "x?" FROM t WHERE a = $1 AND b = $2`);
  });

  it('não mexe em SQL sem placeholders e numera vários em sequência', () => {
    expect(toPositional('SELECT 1')).toBe('SELECT 1');
    expect(toPositional('VALUES (?, ?), (?, ?)')).toBe('VALUES ($1, $2), ($3, $4)');
  });

  it('volta a converter depois de fechar a string; aspas de outro tipo dentro da string não a fecham', () => {
    expect(toPositional(`SELECT 'it"s ?' , ? , "a'?" , ?`)).toBe(`SELECT 'it"s ?' , $1 , "a'?" , $2`);
  });

  it("trata '' (aspas escapadas) como reabertura da string", () => {
    expect(toPositional(`SELECT 'a''?' , ?`)).toBe(`SELECT 'a''?' , $1`);
  });
});

describe('PostgresDatabase', () => {
  beforeEach(async () => {
    await resetDatabase(await testDatabase());
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('consultas', () => {
    it('insere e lê com datas em ISO', async () => {
      const db = await testDatabase();
      const id = await db.insert('INSERT INTO nodes (graph_id, name) VALUES (?, ?)', [1, 'API']);
      const row = await db.get<{ name: string; created_at: string }>('SELECT name, created_at FROM nodes WHERE id = ?', [id]);
      expect(row?.name).toBe('API');
      expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('converte timestamp sem fuso como UTC, bigint e numeric em número', async () => {
      const db = await testDatabase();
      const row = await db.get<{ t: string; c: number; n: number }>(
        "SELECT '2024-03-01 10:20:30'::timestamp AS t, COUNT(*) AS c, 1.25::numeric AS n FROM graphs",
      );
      expect(row).toEqual({ t: '2024-03-01T10:20:30.000Z', c: 1, n: 1.25 });
    });

    it('get devolve null sem linhas; all devolve lista vazia; parâmetros são opcionais', async () => {
      const db = await testDatabase();
      expect(await db.get('SELECT * FROM nodes')).toBeNull();
      expect(await db.all('SELECT * FROM nodes')).toEqual([]);
      expect(await db.all<{ name: string }>('SELECT name::text FROM graphs')).toEqual([{ name: 'Principal' }]);
    });

    it('run devolve o número de linhas afetadas', async () => {
      const db = await testDatabase();
      await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['a']);
      await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['b']);
      expect(await db.run('UPDATE nodes SET tech = ?', ['go'])).toEqual({ changes: 2 });
      expect(await db.run('DELETE FROM nodes WHERE name = ?', ['zzz'])).toEqual({ changes: 0 });
      expect(await db.run('CREATE TEMP TABLE IF NOT EXISTS tmp_x (a int)')).toEqual({ changes: 0 });
    });

    it('insert respeita RETURNING existente e remove ";" final antes de acrescentar', async () => {
      const db = await testDatabase();
      const id = await db.insert('INSERT INTO graphs (name) VALUES (?) RETURNING id', ['G2']);
      const id2 = await db.insert('INSERT INTO graphs (name) VALUES (?);  ', ['G3']);
      expect(id2).toBe(id + 1);
      expect(typeof id).toBe('number');
    });

    it('insert falha se nenhuma linha voltar', async () => {
      const db = await testDatabase();
      await expect(db.insert("INSERT INTO graphs (name) VALUES ('Principal') ON CONFLICT DO NOTHING")).rejects.toThrow('INSERT não retornou id');
    });

    it('normaliza bigint, Uint8Array, arrays, booleanos e Date nos parâmetros', async () => {
      const db = await testDatabase();
      const row = await db.get<{ b: number; bytes: string; arr: number[]; flag: boolean; d: string }>(
        "SELECT ?::bigint AS b, encode(?::bytea, 'hex') AS bytes, ?::int[] AS arr, ?::boolean AS flag, ?::timestamptz AS d",
        [9007199254740991n, new Uint8Array([1, 255]), [1, 2, 3], true, new Date('2025-01-02T03:04:05Z')],
      );
      expect(row).toEqual({ b: 9007199254740991, bytes: '01ff', arr: [1, 2, 3], flag: true, d: '2025-01-02T03:04:05.000Z' });
    });

    it('propaga erros de SQL', async () => {
      const db = await testDatabase();
      await expect(db.all('SELECT * FROM tabela_que_nao_existe')).rejects.toThrow(/tabela_que_nao_existe/);
    });
  });

  describe('transaction', () => {
    it('confirma e devolve o resultado', async () => {
      const db = await testDatabase();
      const result = await db.transaction(async () => {
        await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['a']);
        return 42;
      });
      expect(result).toBe(42);
      expect(await db.all('SELECT 1 FROM nodes')).toHaveLength(1);
    });

    it('desfaz a transação inteira quando uma aninhada falha', async () => {
      const db = await testDatabase();
      await expect(
        db.transaction(async () => {
          await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['a']);
          await db.transaction(async () => {
            throw new Error('boom');
          });
        }),
      ).rejects.toThrow('boom');
      expect((await db.all('SELECT 1 FROM nodes')).length).toBe(0);
    });

    it('aninhada reaproveita a mesma conexão (vê dados não confirmados) e confirma junto', async () => {
      const db = await testDatabase();
      await db.transaction(async () => {
        const outer = await db.get<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['a']);
        await db.transaction(async () => {
          expect((await db.get<{ pid: number }>('SELECT pg_backend_pid() AS pid'))!.pid).toBe(outer!.pid);
          expect(await db.all('SELECT 1 FROM nodes')).toHaveLength(1);
          await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['b']);
        });
      });
      expect(await db.all('SELECT 1 FROM nodes')).toHaveLength(2);
    });

    it('isola: fora da transação não se vê o que ainda não foi confirmado', async () => {
      const db = await testDatabase();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let inserted!: () => void;
      const insertedP = new Promise<void>((r) => (inserted = r));
      const tx = db.transaction(async () => {
        await db.insert('INSERT INTO nodes (graph_id, name) VALUES (1, ?)', ['x']);
        inserted();
        await gate;
      });
      await insertedP;
      expect(await db.all('SELECT 1 FROM nodes')).toHaveLength(0);
      release();
      await tx;
      expect(await db.all('SELECT 1 FROM nodes')).toHaveLength(1);
    });

    it('propaga o erro original mesmo quando o ROLLBACK também falha (conexão caiu)', async () => {
      const db = fresh();
      // O cliente emprestado do pool não tem listener de 'error' (o pg remove o de ocioso no checkout):
      // sem este listener, a queda da conexão viraria exceção não tratada no processo.
      const clientErrors: string[] = [];
      poolOf(db).on('connect', (c) => c.on('error', (e) => clientErrors.push(e.message)));
      try {
        await expect(
          db.transaction(async () => {
            await db.run('SELECT pg_terminate_backend(pg_backend_pid())');
          }),
        ).rejects.toThrow(/terminat/);
        expect(clientErrors.length).toBeGreaterThan(0);
        // A conexão quebrada foi devolvida ao pool; o banco continua utilizável.
        expect(await db.get<{ ok: number }>('SELECT 1 AS ok')).toEqual({ ok: 1 });
      } finally {
        await db.close();
      }
    });
  });

  describe('construtor', () => {
    it('aceita SSL require/verify-full com CA lida do arquivo', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ca-'));
      const ca = path.join(dir, 'ca.pem');
      fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n');
      try {
        const verify = new PostgresDatabase({ url: TEST_DATABASE_URL, ssl: 'verify-full', sslCa: ca, poolMax: 1 });
        const ssl = (poolOf(verify).options as { ssl: { rejectUnauthorized: boolean; ca?: string } }).ssl;
        expect(ssl.rejectUnauthorized).toBe(true);
        expect(ssl.ca).toContain('BEGIN CERTIFICATE');
        await verify.close();

        const require = new PostgresDatabase({ url: TEST_DATABASE_URL, ssl: 'require', sslCa: null, poolMax: 1 });
        expect((poolOf(require).options as { ssl: unknown }).ssl).toEqual({ rejectUnauthorized: false });
        await require.close();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falha se o arquivo de CA não existe', () => {
      expect(() => new PostgresDatabase({ url: TEST_DATABASE_URL, ssl: 'verify-full', sslCa: '/nao/existe/ca.pem', poolMax: 1 })).toThrow(/ENOENT/);
    });

    it('erro em conexão ociosa só é logado (não derruba o processo)', async () => {
      const db = fresh();
      poolOf(db).emit('error', new Error('conexão perdida'), {});
      expect(console.error).toHaveBeenCalledWith('[db] conexão ociosa com erro:', 'conexão perdida');
      await db.close();
    });
  });

  describe('waitUntilReady', () => {
    it('retorna logo quando o banco responde', async () => {
      const db = fresh();
      await db.waitUntilReady(1, 1);
      expect(console.warn).not.toHaveBeenCalled();
      await db.close();
    });

    it('tenta de novo e desiste após o número de tentativas, relançando o último erro', async () => {
      const db = new PostgresDatabase({ url: 'postgres://x:y@127.0.0.1:1/nada', ssl: 'disable', sslCa: null, poolMax: 1 });
      await expect(db.waitUntilReady(3, 1)).rejects.toThrow(/ECONNREFUSED/);
      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenNthCalledWith(1, expect.stringContaining('(1/3)'));
      await db.close();
    });

    it('recupera quando o banco volta a responder; loga erros que não são Error', async () => {
      const db = fresh();
      const pool = poolOf(db);
      const real = pool.query.bind(pool) as (sql: string) => Promise<unknown>;
      let calls = 0;
      vi.spyOn(pool, 'query').mockImplementation((sql: string) => (++calls === 1 ? Promise.reject('ECONNREFUSED cru') : real(sql)));
      await db.waitUntilReady(5, 1);
      expect(calls).toBe(2);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('(1/5): ECONNREFUSED cru'));
      await db.close();
    });
  });

  describe('migrate', () => {
    afterEach(async () => {
      const db = await testDatabase();
      await db.run('DELETE FROM schema_migrations WHERE version >= 9000');
      await db.run('DROP TABLE IF EXISTS mig_test_a, mig_test_b');
    });

    it('é idempotente: reaplicar as migrações não faz nada', async () => {
      const db = await testDatabase();
      const before = await db.all('SELECT version, applied_at FROM schema_migrations ORDER BY version');
      await db.migrate(MIGRATIONS);
      expect(await db.all('SELECT version, applied_at FROM schema_migrations ORDER BY version')).toEqual(before);
      expect(console.log).not.toHaveBeenCalled();
    });

    it('aplica as pendentes em ordem de versão e registra cada uma', async () => {
      const db = await testDatabase();
      await db.migrate([
        ...MIGRATIONS,
        { version: 9002, name: 'b depende de a', sql: 'CREATE TABLE mig_test_b (id int REFERENCES mig_test_a(id))' },
        { version: 9001, name: 'a', sql: 'CREATE TABLE mig_test_a (id int PRIMARY KEY)' },
      ]);
      const rows = await db.all<{ version: number; name: string }>('SELECT version, name FROM schema_migrations WHERE version >= 9000 ORDER BY version');
      expect(rows).toEqual([
        { version: 9001, name: 'a' },
        { version: 9002, name: 'b depende de a' },
      ]);
      expect(console.log).toHaveBeenNthCalledWith(1, '[db] migração 9001 aplicada: a');
    });

    it('migração com erro: desfaz só ela, não registra e informa versão/nome', async () => {
      const db = await testDatabase();
      const err = await db
        .migrate([
          { version: 9001, name: 'ok', sql: 'CREATE TABLE mig_test_a (id int)' },
          { version: 9002, name: 'quebrada', sql: 'CREATE TABLE mig_test_b (id int); SELECT * FROM nao_existe' },
        ])
        .catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toMatch(/^Migração 9002 \(quebrada\) falhou: .*nao_existe/);
      expect(err!.cause).toBeInstanceOf(Error);
      const versions = (await db.all<{ version: number }>('SELECT version FROM schema_migrations WHERE version >= 9000')).map((r) => r.version);
      expect(versions).toEqual([9001]);
      expect(await db.get("SELECT to_regclass('mig_test_b') AS t")).toEqual({ t: null });
      // O lock foi liberado: outra migração roda normalmente.
      await expect(db.migrate([{ version: 9002, name: 'consertada', sql: 'CREATE TABLE mig_test_b (id int)' }])).resolves.toBeUndefined();
    });

    it('formata erro não-Error e ignora falha ao liberar o lock', async () => {
      const db = fresh();
      const queries: string[] = [];
      const client = {
        query: vi.fn<(sql: string) => Promise<{ rows: unknown[] }>>(async (sql: string) => {
          queries.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
          if (sql.startsWith('SELECT version')) return { rows: [] };
          if (sql === 'QUEBRA') throw 'texto cru';
          if (sql.includes('pg_advisory_unlock')) throw new Error('conexão caiu');
          return { rows: [] };
        }),
        release: vi.fn<() => void>(),
        on: vi.fn<() => void>(),
        off: vi.fn<() => void>(),
      };
      vi.spyOn(poolOf(db), 'connect').mockImplementation((async () => client) as never);
      await expect(db.migrate([{ version: 1, name: 'x', sql: 'QUEBRA' }])).rejects.toThrow('Migração 1 (x) falhou: texto cru');
      expect(queries).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
      await db.close();
    });
  });
});
