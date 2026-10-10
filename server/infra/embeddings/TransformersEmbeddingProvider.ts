import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingKind, IEmbeddingProvider } from './IEmbeddingProvider.ts';
import type { IModelCache } from './ModelCache.ts';

/**
 * Embeddings locais com transformers.js (ONNX). O modelo é baixado na primeira chamada
 * e fica em cache em `cacheDir`. Modelos E5 exigem os prefixos "query: " / "passage: ".
 */
export class TransformersEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions = 384;
  state: IEmbeddingProvider['state'] = 'idle';
  lastError: string | null = null;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(
    readonly model: string,
    private readonly cacheDir: string,
    private readonly modelCache: IModelCache | null = null,
  ) {}

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const extractor = await this.load();
    const prefix = this.model.toLowerCase().includes('e5') ? `${kind}: ` : '';
    const output = await extractor(
      texts.map((t) => prefix + t),
      { pooling: 'mean', normalize: true },
    );
    const rows = output.tolist() as number[][];
    return rows.map((r) => Float32Array.from(r));
  }

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.state = 'loading';
      this.pipelinePromise = (async () => {
        // Cache compartilhado no bucket: falhas aqui não impedem o download direto do Hugging Face.
        await this.modelCache?.restore(this.model).catch((err: unknown) => console.warn('[embeddings] cache do bucket indisponível:', err));
        const { pipeline, env } = await import('@huggingface/transformers');
        env.cacheDir = this.cacheDir;
        const p = (await pipeline('feature-extraction', this.model, { dtype: 'q8' })) as FeatureExtractionPipeline;
        this.state = 'ready';
        void this.modelCache?.persist(this.model).catch((err: unknown) => console.warn('[embeddings] não foi possível guardar o modelo no bucket:', err));
        return p;
      })().catch((err: unknown) => {
        this.state = 'error';
        this.lastError = err instanceof Error ? err.message : String(err);
        this.pipelinePromise = null;
        throw err;
      });
    }
    return this.pipelinePromise;
  }
}
