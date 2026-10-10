import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { PgDocumentRepository } from './PgDocumentRepository.ts';
import { PgWatchedFolderRepository } from './PgWatchedFolderRepository.ts';

describe('PgWatchedFolderRepository', () => {
  let folders: PgWatchedFolderRepository;
  let docs: PgDocumentRepository;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    folders = new PgWatchedFolderRepository(db);
    docs = new PgDocumentRepository(db);
  });

  it('insert devolve a pasta com contagem zero; lista ordenada por caminho', async () => {
    const b = await folders.insert('/b/docs');
    await folders.insert('/a/docs');
    expect(b).toMatchObject({ path: '/b/docs', last_scan_at: null, documentCount: 0 });
    expect((await folders.list()).map((f) => f.path)).toEqual(['/a/docs', '/b/docs']);
  });

  it('caminho é único', async () => {
    await folders.insert('/x');
    await expect(folders.insert('/x')).rejects.toThrow(/unique|duplicate/i);
  });

  it('conta documentos da pasta; findById/findByPath', async () => {
    const f = await folders.insert('/docs');
    for (const p of ['/docs/a.md', '/docs/b.md']) {
      await docs.insert({ path: p, title: p, source: 'folder', folder_id: f.id, node_id: null, content: 'x', hash: 'h' });
    }
    expect((await folders.findById(f.id))?.documentCount).toBe(2);
    expect((await folders.findByPath('/docs'))?.id).toBe(f.id);
    expect(await folders.findByPath('/outra')).toBeNull();
    expect(await folders.findById(999)).toBeNull();
  });

  it('touchScan marca a data; delete remove a pasta e os documentos dela', async () => {
    const f = await folders.insert('/docs');
    const d = await docs.insert({ path: '/docs/a.md', title: 'a', source: 'folder', folder_id: f.id, node_id: null, content: 'x', hash: 'h' });
    await folders.touchScan(f.id);
    expect((await folders.findById(f.id))?.last_scan_at).toMatch(/Z$/);
    expect(await folders.delete(f.id)).toBe(true);
    expect(await docs.findById(d)).toBeNull();
    expect(await folders.delete(f.id)).toBe(false);
  });
});
