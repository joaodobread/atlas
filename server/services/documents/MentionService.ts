import type { IEventBus } from '../../core/events/EventBus.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { IInterfaceRepository } from '../../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../../repositories/contracts/INodeRepository.ts';
import type { ChunkMention } from '../../../shared/types.ts';
import type { IMentionService } from '../contracts/index.ts';
import { MentionDetector } from './MentionDetector.ts';

/** Mantém a tabela de menções em dia: por documento ao indexar e tudo quando o grafo muda. */
export class MentionService implements IMentionService {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly documents: IDocumentRepository,
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    events: IEventBus,
  ) {
    // Nomes mudaram: recalcula tudo (com debounce para imports em lote).
    events.on('graph.changed', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.recompute().catch((err: unknown) => console.error('[mentions] falha ao recalcular:', err)), 500);
    });
  }

  async recompute(chunkIds?: readonly number[]): Promise<void> {
    const detector = new MentionDetector(await this.nodes.findAll(), await this.interfaces.findAll());
    const chunks = chunkIds ? await this.documents.chunksByIds(chunkIds) : await this.documents.allChunks();
    const mentions: ChunkMention[] = chunks.flatMap((c) =>
      detector.detect(`${c.heading}\n${c.content}`).map((m) => ({
        chunk_id: c.id,
        node_id: m.nodeId,
        matched: m.matched,
        method: m.method,
        confidence: m.confidence,
      })),
    );
    // Menções vindas do LLM são mantidas: só ele as recalcula.
    await this.documents.replaceMentions(
      chunks.map((c) => c.id),
      mentions,
      ['exact', 'fuzzy'],
    );
  }
}
