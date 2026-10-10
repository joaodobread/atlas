import type { EmbeddingKind, IEmbeddingProvider } from '../../server/infra/embeddings/IEmbeddingProvider.ts';

/**
 * Embeddings determinísticos para testes: cada palavra (minúscula, sem acento) soma 1 numa posição
 * escolhida por hash; o vetor é normalizado. Textos com as mesmas palavras ficam próximos.
 */
export class HashEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions: number;
  state: IEmbeddingProvider['state'] = 'ready';
  lastError: string | null = null;
  /** Quando definido, embed() rejeita com este erro. */
  failWith: unknown = null;
  readonly calls: Array<{ texts: string[]; kind: EmbeddingKind }> = [];

  constructor(
    readonly model = 'hash-test',
    dimensions = 384,
  ) {
    this.dimensions = dimensions;
  }

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    this.calls.push({ texts: [...texts], kind });
    if (this.failWith != null) throw this.failWith;
    return texts.map((t) => this.vector(t));
  }

  vector(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const words = text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    for (const w of words) v[hash(w) % this.dimensions] += 1;
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
