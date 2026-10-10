export type Visibility = 'private' | 'public';

export interface StoredObject {
  key: string;
  visibility: Visibility;
  size: number;
  contentType: string;
}

/** Storage de arquivos (S3 ou compatível). Dois buckets: privado e público. */
export interface IObjectStorage {
  /** Cria os buckets se faltarem (e torna o público legível anonimamente, quando configurado). */
  ensureBuckets(): Promise<void>;
  put(visibility: Visibility, key: string, body: Uint8Array | string, contentType: string): Promise<StoredObject>;
  /** Conteúdo do objeto, ou null se não existir. */
  get(visibility: Visibility, key: string): Promise<Uint8Array | null>;
  delete(visibility: Visibility, key: string): Promise<void>;
  list(visibility: Visibility, prefix: string): Promise<Array<{ key: string; size: number }>>;
  /** URL pública (só faz sentido para o bucket público). */
  publicUrl(key: string): string;
}
