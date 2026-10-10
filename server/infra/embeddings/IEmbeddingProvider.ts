export type EmbeddingKind = 'query' | 'passage';

export interface IEmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  /** Vetores normalizados (norma 1): similaridade = produto escalar. */
  embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]>;
  readonly state: 'idle' | 'loading' | 'ready' | 'error';
  readonly lastError: string | null;
}
