/** Eventos de domínio trocados entre services sem acoplá-los diretamente. */
export interface DomainEvents {
  /** Nós/interfaces mudaram (nomes, criação, remoção): menções precisam ser recalculadas. */
  'graph.changed': undefined;
  /** Documentos/trechos mudaram: índices em memória precisam ser invalidados. */
  'documents.changed': { documentIds: number[] };
  /** Trechos receberam embedding. */
  'chunks.embedded': { chunkIds: number[] };
  /** Configuração de LLM alterada pela interface. */
  'llm.changed': undefined;
}

export type EventName = keyof DomainEvents;
export type Handler<E extends EventName> = (payload: DomainEvents[E]) => void;

export interface IEventBus {
  emit<E extends EventName>(event: E, ...payload: DomainEvents[E] extends undefined ? [] : [DomainEvents[E]]): void;
  on<E extends EventName>(event: E, handler: Handler<E>): () => void;
}

export class EventBus implements IEventBus {
  private readonly handlers = new Map<EventName, Set<Handler<EventName>>>();

  emit<E extends EventName>(event: E, ...payload: DomainEvents[E] extends undefined ? [] : [DomainEvents[E]]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        (h as Handler<E>)(payload[0] as DomainEvents[E]);
      } catch (err) {
        console.error(`[events] erro no handler de ${event}:`, err);
      }
    }
  }

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<EventName>);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler<EventName>);
  }
}
