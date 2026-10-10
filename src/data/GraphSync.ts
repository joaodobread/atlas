import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { GraphApi } from './api/GraphApi.ts';
import { errorMessage } from '../core/errorMessage.ts';

/** Sincroniza o store com a API: a lista de grafos e o grafo aberto. */
export class GraphSync {
  private static instance: GraphSync | undefined;

  private constructor(private readonly api: GraphApi) {}

  static getInstance(api: GraphApi = GraphApi.getInstance()): GraphSync {
    return (GraphSync.instance ??= new GraphSync(api));
  }

  async reload(): Promise<void> {
    const store = useGraphStore.getState();
    store.setLoading();
    try {
      const graphs = await this.api.list();
      store.setGraphs(graphs);
      // Grafo salvo pode ter sido excluído: cai no primeiro.
      const ui = useUiStore.getState();
      const current = graphs.find((g) => g.id === ui.graphId) ?? graphs[0];
      if (!current) throw new Error('Nenhum grafo disponível');
      if (current.id !== ui.graphId) ui.setGraph(current.id);
      store.setData(await this.api.load(current.id));
    } catch (err) {
      store.setError(errorMessage(err));
    }
  }

  /** Troca o grafo aberto e carrega. */
  async open(graphId: number): Promise<void> {
    useUiStore.getState().setGraph(graphId);
    await this.reload();
  }
}
