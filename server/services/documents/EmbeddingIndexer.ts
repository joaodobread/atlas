import type { IEventBus } from '../../core/events/EventBus.ts';
import type { IEmbeddingProvider } from '../../infra/embeddings/IEmbeddingProvider.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { IndexStatus } from '../../../shared/types.ts';
import type { IEmbeddingIndexer } from '../contracts/index.ts';

const BATCH = 16;

/** Gera embeddings dos trechos pendentes em segundo plano, um lote por vez. */
export class EmbeddingIndexer implements IEmbeddingIndexer {
  private running = false;
  private error: string | null = null;

  constructor(
    private readonly documents: IDocumentRepository,
    private readonly embeddings: IEmbeddingProvider,
    private readonly events: IEventBus,
  ) {}

  kick(): void {
    if (this.running) return;
    this.running = true;
    this.error = null;
    void this.resetIfModelChanged()
      .then(() => this.loop())
      .finally(() => {
        this.running = false;
      });
  }

  async status(): Promise<Omit<IndexStatus, 'llmMentions'>> {
    const counts = await this.documents.counts();
    const state: IndexStatus['embeddingState'] =
      this.error != null ? 'error' : this.embeddings.state === 'loading' ? 'loading-model' : this.running ? 'indexing' : 'idle';
    return { ...counts, embeddingModel: this.embeddings.model, embeddingState: state, embeddingError: this.error ?? this.embeddings.lastError };
  }

  private modelChecked = false;

  /** Trocou o modelo: os vetores antigos não são comparáveis. */
  private async resetIfModelChanged(): Promise<void> {
    if (this.modelChecked) return;
    this.modelChecked = true;
    const reset = await this.documents.resetEmbeddingsNotFrom(this.embeddings.model);
    if (reset) console.log(`[embeddings] ${reset} trechos serão reindexados com ${this.embeddings.model}`);
  }

  private async loop(): Promise<void> {
    try {
      for (;;) {
        const batch = await this.documents.pendingEmbedding(BATCH);
        if (!batch.length) return;
        const vectors = await this.embeddings.embed(
          batch.map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content)),
          'passage',
        );
        for (const [i, c] of batch.entries()) await this.documents.setEmbedding(c.id, vectors[i]!, this.embeddings.model);
        this.events.emit('chunks.embedded', { chunkIds: batch.map((c) => c.id) });
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.error('[embeddings] falha ao indexar:', this.error);
    }
  }
}
