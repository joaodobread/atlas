import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentsKit, type DocumentsKit } from '../../../test/support/documents.ts';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors/AppError.ts';
import type { IMarkdownFolder, MarkdownFile } from '../../infra/files/IMarkdownFolder.ts';
import { LocalMarkdownFolder } from '../../infra/files/LocalMarkdownFolder.ts';
import { FolderWatchService } from './FolderWatchService.ts';

/** Sistema de arquivos em memória: pastas -> arquivos; guarda os callbacks de watch. */
class FakeFolder implements IMarkdownFolder {
  readonly dirs = new Map<string, MarkdownFile[]>();
  readonly watchers = new Map<string, () => void>();
  readonly stopped: string[] = [];
  scanCalls = 0;
  failScan: Error | null = null;

  exists(dir: string): boolean {
    return this.dirs.has(dir);
  }
  async scan(dir: string): Promise<MarkdownFile[]> {
    this.scanCalls++;
    await Promise.resolve();
    if (this.failScan) throw this.failScan;
    return [...(this.dirs.get(dir) ?? [])];
  }
  watch(dir: string, onChange: () => void): () => void {
    this.watchers.set(dir, onChange);
    return () => this.stopped.push(dir);
  }
}

describe('FolderWatchService', () => {
  let k: DocumentsKit;
  let fsFake: FakeFolder;
  let service: FolderWatchService;
  let changed: number[][];
  const DIR = path.resolve('/docs/arquitetura');

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    k = documentsKit(db);
    fsFake = new FakeFolder();
    fsFake.dirs.set(DIR, [
      { path: `${DIR}/a.md`, content: '# A\nconteúdo a' },
      { path: `${DIR}/b.md`, content: '# B\nconteúdo b' },
    ]);
    service = new FolderWatchService(k.folders, k.documents, k.documentService, fsFake, k.events);
    changed = [];
    k.events.on('documents.changed', (p) => changed.push(p.documentIds));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('add valida a pasta, indexa os arquivos e começa a observar', async () => {
    await expect(service.add('/nao/existe')).rejects.toBeInstanceOf(ValidationError);
    const folder = await service.add(`${DIR}/`);
    expect(folder).toMatchObject({ path: DIR, documentCount: 2 });
    expect(folder.last_scan_at).not.toBeNull();
    expect(fsFake.watchers.has(DIR)).toBe(true);
    const docs = await k.documents.listByFolder(folder.id);
    expect(docs.map((d) => d.path).sort()).toEqual([`${DIR}/a.md`, `${DIR}/b.md`]);
    expect((await k.documents.findByPath(`${DIR}/a.md`))?.source).toBe('folder');
    await expect(service.add(DIR)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await service.list()).toHaveLength(1);
  });

  it('mudança na pasta reescaneia: atualiza, cria e remove documentos', async () => {
    const folder = await service.add(DIR);
    const removedId = (await k.documents.findByPath(`${DIR}/b.md`))!.id;
    fsFake.dirs.set(DIR, [
      { path: `${DIR}/a.md`, content: '# A\nalterado' },
      { path: `${DIR}/c.md`, content: '# C' },
    ]);
    changed.length = 0;
    fsFake.watchers.get(DIR)!();
    await vi.waitFor(async () => expect((await k.documents.listByFolder(folder.id)).map((d) => d.path).sort()).toEqual([`${DIR}/a.md`, `${DIR}/c.md`]));
    await vi.waitFor(() => expect(changed).toContainEqual([removedId]));
    expect((await k.documents.findByPath(`${DIR}/a.md`))?.content).toBe('# A\nalterado');
  });

  it('scans concorrentes da mesma pasta são unificados', async () => {
    const folder = await service.add(DIR);
    fsFake.scanCalls = 0;
    await Promise.all([service.rescan(folder.id), service.rescan(folder.id)]);
    expect(fsFake.scanCalls).toBe(1);
  });

  it('rescan devolve a pasta atualizada; inexistente dá 404', async () => {
    const folder = await service.add(DIR);
    fsFake.dirs.set(DIR, []);
    const after = await service.rescan(folder.id);
    expect(after.documentCount).toBe(0);
    await expect(service.rescan(9999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('remove para de observar, apaga os documentos e avisa; inexistente dá 404', async () => {
    const folder = await service.add(DIR);
    const ids = (await k.documents.listByFolder(folder.id)).map((d) => d.id).sort((a, b) => a - b);
    changed.length = 0;
    await service.remove(folder.id);
    expect(fsFake.stopped).toEqual([DIR]);
    expect(changed.map((c) => [...c].sort((a, b) => a - b))).toEqual([ids]);
    expect(await k.documents.listByFolder(folder.id)).toEqual([]);
    await expect(service.remove(folder.id)).rejects.toThrow(`Pasta ${folder.id} não encontrada`);
  });

  it('erro no scan disparado pelo watch é só registrado; pasta apagada é ignorada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const folder = await service.add(DIR);
    fsFake.failScan = new Error('EACCES');
    fsFake.watchers.get(DIR)!();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(`[folders] ${DIR}:`, fsFake.failScan));

    fsFake.failScan = null;
    await k.folders.delete(folder.id);
    fsFake.scanCalls = 0;
    fsFake.watchers.get(DIR)!();
    await new Promise((r) => setTimeout(r, 50));
    expect(fsFake.scanCalls).toBe(0);
  });

  it('start observa as pastas salvas, pula as que sumiram e registra falhas de scan', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await k.folders.insert('/sumiu');
    const ok = await k.folders.insert(DIR);
    const broken = await k.folders.insert('/quebrada');
    fsFake.dirs.set('/quebrada', []);
    const scan = fsFake.scan.bind(fsFake);
    vi.spyOn(fsFake, 'scan').mockImplementation((dir) => (dir === '/quebrada' ? Promise.reject(new Error('falhou')) : scan(dir)));

    await service.start();
    expect(warn).toHaveBeenCalledWith('[folders] pasta não encontrada, ignorando: /sumiu');
    expect(error).toHaveBeenCalledWith('[folders] falha ao escanear /quebrada:', expect.objectContaining({ message: 'falhou' }));
    expect([...fsFake.watchers.keys()].sort()).toEqual([DIR, '/quebrada'].sort());
    expect((await k.folders.findById(ok.id))?.documentCount).toBe(2);
    expect((await k.folders.findById(broken.id))?.last_scan_at).toBeNull();

    // Observar de novo a mesma pasta encerra o watcher anterior.
    await service.start();
    expect(fsFake.stopped).toEqual(expect.arrayContaining([DIR, '/quebrada']));
  });

  it('funciona com a pasta local de verdade', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commgraph-watch-'));
    try {
      fs.writeFileSync(path.join(dir, 'leia.md'), '# Leia\ntexto');
      const real = new FolderWatchService(k.folders, k.documents, k.documentService, new LocalMarkdownFolder(), k.events);
      const folder = await real.add(dir);
      expect(folder.documentCount).toBe(1);
      await real.remove(folder.id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
