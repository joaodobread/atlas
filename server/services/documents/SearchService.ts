import type { IEmbeddingProvider } from '../../infra/embeddings/IEmbeddingProvider.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { AffectedNode, SearchHit, SearchResult } from '../../../shared/types.ts';
import type { SearchQueryInput } from '../../../shared/schemas.ts';
import type { ISearchService } from '../contracts/index.ts';

/** Constante do Reciprocal Rank Fusion. */
const RRF_K = 60;
const SEMANTIC_MIN_SCORE = 0.8;
const SEMANTIC_MAX_GAP = 0.06;

/**
 * Busca híbrida: textual (full-text do Postgres) + semântica (pgvector), fundidas por Reciprocal Rank Fusion.
 * Cada resultado traz os nós do grafo mencionados no trecho.
 */
export class SearchService implements ISearchService {
  constructor(
    private readonly documents: IDocumentRepository,
    private readonly embeddings: IEmbeddingProvider,
  ) {}

  async search({ q, mode, limit }: SearchQueryInput): Promise<SearchResult> {
    const pool = limit * 3;
    const text = mode === 'semantic' ? [] : await this.textSearch(q, pool);

    let semantic: Array<{ id: number; score: number }> = [];
    let semanticUnavailable = false;
    if (mode !== 'text') {
      try {
        const [query] = await this.embeddings.embed([q], 'query');
        const found = await this.documents.vectorSearch(query!, this.embeddings.model, pool);
        // Modelos E5 dão similaridades altas até para textos pouco relacionados: corte absoluto + relativo ao melhor.
        const floor = Math.max(SEMANTIC_MIN_SCORE, (found[0]?.score ?? 0) - SEMANTIC_MAX_GAP);
        semantic = found.filter((s) => s.score >= floor);
      } catch {
        semanticUnavailable = true;
      }
    }

    // Fusão por posição (RRF): robusta a escalas diferentes de score.
    const fused = new Map<number, { score: number; matchedBy: Set<'text' | 'semantic'>; snippet?: string }>();
    text.forEach((t, rank) => {
      const e = fused.get(t.chunkId) ?? { score: 0, matchedBy: new Set() };
      e.score += 1 / (RRF_K + rank + 1);
      e.matchedBy.add('text');
      e.snippet = t.snippet;
      fused.set(t.chunkId, e);
    });
    semantic.forEach((s, rank) => {
      const e = fused.get(s.id) ?? { score: 0, matchedBy: new Set() };
      e.score += 1 / (RRF_K + rank + 1);
      e.matchedBy.add('semantic');
      fused.set(s.id, e);
    });

    const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
    const chunks = new Map((await this.documents.chunksByIds(top.map(([id]) => id))).map((c) => [c.id, c]));
    const mentions = await this.documents.mentionsOfChunks(top.map(([id]) => id));

    const hits: SearchHit[] = top.flatMap(([id, e]) => {
      const c = chunks.get(id);
      if (!c) return [];
      return [
        {
          chunkId: id,
          documentId: c.document_id,
          path: c.path,
          title: c.title,
          heading: c.heading,
          startLine: c.start_line,
          endLine: c.end_line,
          snippet: e.snippet ?? excerpt(c.content),
          score: e.score,
          matchedBy: [...e.matchedBy],
          mentionedNodeIds: [...new Set(mentions.filter((m) => m.chunk_id === id).map((m) => m.node_id))],
          nodeId: c.node_id,
        },
      ];
    });

    return { query: q, mode, hits, affectedNodes: affected(hits), semanticUnavailable };
  }

  private async textSearch(q: string, limit: number) {
    const fts = toTsQuery(q);
    if (!fts) return [];
    try {
      return await this.documents.textSearch(fts, limit);
    } catch {
      return [];
    }
  }
}

/** Palavras sem valor de busca (pt/en): não entram na consulta textual. */
const STOPWORDS = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob sobre ' +
    'e ou mas se que qual quais quem como quando onde porque por que é são ser foi era está estão ter tem têm há ' +
    'eu tu ele ela nós vós eles elas me te lhe nos isso isto aquilo este esta esse essa ao aos à às seu sua seus suas ' +
    'mais menos muito pouco já não sim também só the of and or to in on for with is are was be it this that what which who how'
  ).split(' '),
);

/**
 * Texto livre -> consulta to_tsquery segura: só letras/números por termo, cada um com prefixo (termo:*),
 * combinados com OR (|); o ts_rank ordena.
 */
export function toTsQuery(q: string): string {
  const tokens = q
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .slice(0, 16);
  return [...new Set(tokens)].map((t) => `${t}:*`).join(' | ');
}

function excerpt(content: string, max = 260): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function affected(hits: readonly SearchHit[]): AffectedNode[] {
  const counts = new Map<number, number>();
  for (const h of hits) for (const id of h.mentionedNodeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].map(([nodeId, n]) => ({ nodeId, hits: n })).sort((a, b) => b.hits - a.hits);
}
