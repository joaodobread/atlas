import fs from 'node:fs';
import path from 'node:path';
import type { IObjectStorage } from '../storage/IObjectStorage.ts';

/** Sincroniza o cache local do modelo de embeddings com o bucket privado. */
export interface IModelCache {
  /** Baixa o modelo do bucket se ainda não estiver no disco. */
  restore(model: string): Promise<void>;
  /** Envia o modelo baixado do Hugging Face para o bucket (só na primeira vez). */
  persist(model: string): Promise<void>;
}

/**
 * Evita baixar o modelo (~130 MB) do Hugging Face em cada container novo: a primeira instância envia para
 * `models/<modelo>/` no bucket privado e as seguintes restauram de lá.
 */
export class BucketModelCache implements IModelCache {
  constructor(
    private readonly storage: IObjectStorage,
    private readonly cacheDir: string,
  ) {}

  async restore(model: string): Promise<void> {
    const local = path.join(this.cacheDir, model);
    if (fs.existsSync(local) && fs.readdirSync(local).length) return;
    const objects = await this.storage.list('private', this.prefix(model));
    for (const o of objects) {
      const body = await this.storage.get('private', o.key);
      if (!body) continue;
      const file = path.join(local, o.key.slice(this.prefix(model).length));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    if (objects.length) console.log(`[embeddings] modelo ${model} restaurado do bucket (${objects.length} arquivo(s))`);
  }

  async persist(model: string): Promise<void> {
    if ((await this.storage.list('private', this.prefix(model))).length) return;
    const local = path.join(this.cacheDir, model);
    if (!fs.existsSync(local)) return;
    const files = fs.readdirSync(local, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    for (const f of files) {
      const full = path.join(f.parentPath, f.name);
      const rel = path.relative(local, full).split(path.sep).join('/');
      await this.storage.put('private', `${this.prefix(model)}${rel}`, fs.readFileSync(full), 'application/octet-stream');
    }
    console.log(`[embeddings] modelo ${model} guardado no bucket (${files.length} arquivo(s))`);
  }

  private prefix(model: string): string {
    return `models/${model.replace(/[^\w./-]+/g, '_')}/`;
  }
}
