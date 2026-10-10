import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import { PgNodeRepository } from './PgNodeRepository.ts';

describe('PgNodeRepository (e PgCrudRepository)', () => {
  let repo: PgNodeRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgNodeRepository(db);
  });

  it('create grava só os campos informados e aplica os padrões do banco', async () => {
    const n = await repo.create({ graph_id: 1, name: 'API', kind: 'service' });
    expect(n).toMatchObject({ graph_id: 1, parent_id: null, name: 'API', kind: 'service', tech: null, icon: null, description: null });
    expect(n.id).toBeTypeOf('number');
    expect(n.created_at).toMatch(/Z$/);
  });

  it('create ignora campos fora de writableColumns (nada arbitrário chega ao SQL)', async () => {
    const n = await repo.create({ graph_id: 1, name: 'X', kind: 'project', id: 999, created_at: '2000-01-01' } as never);
    expect(n.id).not.toBe(999);
    expect(n.created_at.startsWith('2000')).toBe(false);
  });

  it('findAll ordena por nome sem diferenciar maiúsculas e depois por id', async () => {
    await repo.create({ graph_id: 1, name: 'beta', kind: 'project' });
    await repo.create({ graph_id: 1, name: 'Alpha', kind: 'project' });
    await repo.create({ graph_id: 1, name: 'alpha', kind: 'project' });
    expect((await repo.findAll()).map((n) => n.name)).toEqual(['Alpha', 'alpha', 'beta']);
  });

  it('findById/exists', async () => {
    const n = await repo.create({ graph_id: 1, name: 'A', kind: 'project' });
    expect(await repo.findById(n.id)).toEqual(n);
    expect(await repo.exists(n.id)).toBe(true);
    expect(await repo.findById(n.id + 100)).toBeNull();
    expect(await repo.exists(n.id + 100)).toBe(false);
  });

  it('update altera só o definido, aceita null e toca updated_at', async () => {
    const n = await repo.create({ graph_id: 1, name: 'A', kind: 'project', tech: 'node', description: 'desc' });
    await new Promise((r) => setTimeout(r, 5));
    const u = await repo.update(n.id, { name: 'B', tech: null, description: undefined });
    expect(u).toMatchObject({ name: 'B', tech: null, description: 'desc', kind: 'project' });
    expect(Date.parse(u.updated_at)).toBeGreaterThan(Date.parse(n.updated_at));
  });

  it('update sem campos não grava (nem updated_at) e devolve a entidade', async () => {
    const n = await repo.create({ graph_id: 1, name: 'A', kind: 'project' });
    expect(await repo.update(n.id, {})).toEqual(n);
  });

  it('update de id inexistente lança NotFoundError (com e sem campos)', async () => {
    await expect(repo.update(12345, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.update(12345, {})).rejects.toThrow('nodes 12345 não encontrado');
  });

  it('delete informa se removeu e apaga filhos em cascata', async () => {
    const p = await repo.create({ graph_id: 1, name: 'P', kind: 'project' });
    const c = await repo.create({ graph_id: 1, name: 'C', kind: 'project', parent_id: p.id });
    expect(await repo.delete(p.id)).toBe(true);
    expect(await repo.exists(c.id)).toBe(false);
    expect(await repo.delete(p.id)).toBe(false);
  });

  it('findByParentAndName trata parent null corretamente (IS NOT DISTINCT FROM)', async () => {
    const root = await repo.create({ graph_id: 1, name: 'Svc', kind: 'project' });
    const child = await repo.create({ graph_id: 1, name: 'Svc', kind: 'project', parent_id: root.id });
    expect((await repo.findByParentAndName(1, null, 'Svc'))?.id).toBe(root.id);
    expect((await repo.findByParentAndName(1, root.id, 'Svc'))?.id).toBe(child.id);
    expect(await repo.findByParentAndName(1, null, 'svc')).toBeNull();
    expect(await repo.findByParentAndName(2, null, 'Svc')).toBeNull();
  });

  it('findByGraph / graphOf / findParentId / deleteByGraph', async () => {
    const db = await testDatabase();
    const g2 = await db.insert("INSERT INTO graphs (name) VALUES ('G2')");
    const a = await repo.create({ graph_id: 1, name: 'b', kind: 'project' });
    const b = await repo.create({ graph_id: 1, name: 'A', kind: 'project', parent_id: a.id });
    const other = await repo.create({ graph_id: g2, name: 'O', kind: 'project' });

    expect((await repo.findByGraph(1)).map((n) => n.name)).toEqual(['A', 'b']);
    expect(await repo.graphOf(other.id)).toBe(g2);
    expect(await repo.graphOf(9999)).toBeUndefined();
    expect(await repo.findParentId(b.id)).toBe(a.id);
    expect(await repo.findParentId(a.id)).toBeNull();
    expect(await repo.findParentId(9999)).toBeUndefined();

    await repo.deleteByGraph(1);
    expect(await repo.findByGraph(1)).toEqual([]);
    expect(await repo.exists(other.id)).toBe(true);
  });

  it('create sem nenhum campo usa DEFAULT VALUES (e o banco recusa colunas obrigatórias)', async () => {
    await expect(repo.create({} as never)).rejects.toThrow(/null value in column/);
  });

  it('create propaga violação de FK (grafo inexistente)', async () => {
    await expect(repo.create({ graph_id: 999, name: 'x', kind: 'project' })).rejects.toThrow(/foreign key/);
  });
});
