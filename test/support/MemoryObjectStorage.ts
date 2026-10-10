import type { IObjectStorage, StoredObject, Visibility } from '../../server/infra/storage/IObjectStorage.ts';

/** Storage em memória para testes. */
export class MemoryObjectStorage implements IObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  failPuts = false;

  async ensureBuckets(): Promise<void> {}

  async put(visibility: Visibility, key: string, body: Uint8Array | string, contentType: string): Promise<StoredObject> {
    if (this.failPuts) throw new Error('storage indisponível');
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    this.objects.set(`${visibility}:${key}`, { body: bytes, contentType });
    return { key, visibility, size: bytes.byteLength, contentType };
  }

  async get(visibility: Visibility, key: string): Promise<Uint8Array | null> {
    return this.objects.get(`${visibility}:${key}`)?.body ?? null;
  }

  async delete(visibility: Visibility, key: string): Promise<void> {
    this.objects.delete(`${visibility}:${key}`);
  }

  async list(visibility: Visibility, prefix: string): Promise<Array<{ key: string; size: number }>> {
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(`${visibility}:${prefix}`))
      .map(([k, v]) => ({ key: k.slice(visibility.length + 1), size: v.body.byteLength }));
  }

  publicUrl(key: string): string {
    return `https://public.test/${key}`;
  }
}
