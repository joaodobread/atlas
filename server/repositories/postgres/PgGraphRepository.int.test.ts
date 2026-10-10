import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { PgGraphRepository } from './PgGraphRepository.ts';
import { PgNodeRepository } from './PgNodeRepository.ts';

describe('PgGraphRepository', () => {
  let repo: PgGraphRepository;
  let nodes: PgNodeRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    repo = new PgGraphRepository(db);
    nodes = new PgNodeRepository(db);
  });

  it('lista o grafo padrão com a contagem de nós', async () => {
    await nodes.create({ graph_id: 1, name: 'a', kind: 'project' });
    await nodes.create({ graph_id: 1, name: 'b', kind: 'project' });
    const [g] = await repo.list();
    expect(g).toMatchObject({ id: 1, name: 'Principal', description: null, nodeCount: 2 });
    expect(typeof g.name).toBe('string');
    expect(await repo.count()).toBe(1);
  });

  it('create/findById/findByName (nome único sem diferenciar maiúsculas)', async () => {
    const g = await repo.create('Pagamentos', 'fluxos de PIX');
    expect(g).toMatchObject({ name: 'Pagamentos', description: 'fluxos de PIX', nodeCount: 0 });
    expect(await repo.findById(g.id)).toEqual(g);
    expect((await repo.findByName('pagamentos'))?.id).toBe(g.id);
    expect(await repo.findByName('outro')).toBeNull();
    expect(await repo.findById(999)).toBeNull();
    await expect(repo.create('PAGAMENTOS', null)).rejects.toThrow(/duplicate|unique/i);
    expect((await repo.list()).map((x) => x.id)).toEqual([1, g.id]);
  });

  it('update parcial: só nome, só descrição (inclusive null) e nada', async () => {
    const g = await repo.create('X', 'd');
    expect(await repo.update(g.id, { name: 'Y' })).toMatchObject({ name: 'Y', description: 'd' });
    expect(await repo.update(g.id, { description: null })).toMatchObject({ name: 'Y', description: null });
    const same = await repo.update(g.id, {});
    expect(same).toMatchObject({ name: 'Y', description: null });
    expect(same.updated_at).toBe((await repo.findById(g.id))!.updated_at);
    expect(await repo.update(g.id, { name: 'Z', description: 'nova' })).toMatchObject({ name: 'Z', description: 'nova' });
  });

  it('delete remove o grafo e seus nós em cascata', async () => {
    const g = await repo.create('Temp', null);
    const n = await nodes.create({ graph_id: g.id, name: 'n', kind: 'project' });
    expect(await repo.delete(g.id)).toBe(true);
    expect(await nodes.exists(n.id)).toBe(false);
    expect(await repo.delete(g.id)).toBe(false);
    expect(await repo.count()).toBe(1);
  });
});
