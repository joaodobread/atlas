import path from 'node:path';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors/AppError.ts';
import type { IEventBus } from '../../core/events/EventBus.ts';
import type { IMarkdownFolder } from '../../infra/files/IMarkdownFolder.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { IWatchedFolderRepository } from '../../repositories/contracts/IWatchedFolderRepository.ts';
import type { WatchedFolder } from '../../../shared/types.ts';
import type { IDocumentService, IFolderWatchService } from '../contracts/index.ts';

/** Sincroniza os .md de pastas locais com os documentos e observa mudanças. */
export class FolderWatchService implements IFolderWatchService {
  private readonly stoppers = new Map<number, () => void>();
  private readonly scanning = new Map<number, Promise<void>>();

  constructor(
    private readonly folders: IWatchedFolderRepository,
    private readonly documents: IDocumentRepository,
    private readonly documentService: IDocumentService,
    private readonly fs: IMarkdownFolder,
    private readonly events: IEventBus,
  ) {}

  async start(): Promise<void> {
    for (const f of await this.folders.list()) {
      if (!this.fs.exists(f.path)) {
        console.warn(`[folders] pasta não encontrada, ignorando: ${f.path}`);
        continue;
      }
      this.watch(f.id, f.path);
      await this.scan(f.id).catch((err) => console.error(`[folders] falha ao escanear ${f.path}:`, err));
    }
  }

  async list(): Promise<WatchedFolder[]> {
    return await this.folders.list();
  }

  async add(rawPath: string): Promise<WatchedFolder> {
    const dir = path.resolve(rawPath);
    if (!this.fs.exists(dir)) throw new ValidationError(`Pasta não encontrada: ${dir}`);
    if (await this.folders.findByPath(dir)) throw new BusinessRuleError('Esta pasta já está sendo monitorada');
    const folder = await this.folders.insert(dir);
    this.watch(folder.id, dir);
    await this.scan(folder.id);
    return (await this.folders.findById(folder.id))!;
  }

  async remove(id: number): Promise<void> {
    this.stoppers.get(id)?.();
    this.stoppers.delete(id);
    const docIds = (await this.documents.listByFolder(id)).map((d) => d.id);
    if (!(await this.folders.delete(id))) throw new NotFoundError(`Pasta ${id} não encontrada`);
    this.events.emit('documents.changed', { documentIds: docIds });
  }

  async rescan(id: number): Promise<WatchedFolder> {
    if (!(await this.folders.findById(id))) throw new NotFoundError(`Pasta ${id} não encontrada`);
    await this.scan(id);
    return (await this.folders.findById(id))!;
  }

  private watch(id: number, dir: string): void {
    this.stoppers.get(id)?.();
    this.stoppers.set(
      id,
      this.fs.watch(dir, () => void this.scan(id).catch((err: unknown) => console.error(`[folders] ${dir}:`, err))),
    );
  }

  /** Um scan por pasta por vez; chamadas concorrentes aguardam o atual. */
  private async scan(id: number): Promise<void> {
    const running = this.scanning.get(id);
    if (running) return running;
    const p = this.doScan(id).finally(() => this.scanning.delete(id));
    this.scanning.set(id, p);
    return p;
  }

  private async doScan(id: number): Promise<void> {
    const folder = await this.folders.findById(id);
    if (!folder) return;
    const files = await this.fs.scan(folder.path);
    const present = new Set(files.map((f) => f.path));
    for (const f of files) await this.documentService.upsertData({ path: f.path, content: f.content, source: 'folder', folderId: id });
    // Arquivos apagados da pasta saem do índice.
    const removed = (await this.documents.listByFolder(id)).filter((d) => !present.has(d.path));
    for (const d of removed) await this.documents.delete(d.id);
    if (removed.length) this.events.emit('documents.changed', { documentIds: removed.map((d) => d.id) });
    await this.folders.touchScan(id);
  }
}
