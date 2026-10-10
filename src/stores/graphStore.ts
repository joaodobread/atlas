import { create } from 'zustand';
import type { GraphData, GraphInfo } from '../../shared/types.ts';
import { GraphIndex } from '../domain/GraphIndex.ts';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface GraphState {
  index: GraphIndex;
  /** Todos os grafos (diagramas) disponíveis. */
  graphs: GraphInfo[];
  status: Status;
  error: string | null;
  setLoading(): void;
  setData(data: GraphData): void;
  setGraphs(graphs: GraphInfo[]): void;
  setError(message: string): void;
}

/** Model: estado do grafo vindo da API. */
export const useGraphStore = create<GraphState>()((set) => ({
  index: GraphIndex.empty(),
  graphs: [],
  status: 'idle',
  error: null,
  setLoading: () => set((s) => ({ status: s.status === 'ready' ? 'ready' : 'loading' })),
  setData: (data) => set({ index: new GraphIndex(data), status: 'ready', error: null }),
  setGraphs: (graphs) => set({ graphs }),
  setError: (message) => set({ status: 'error', error: message }),
}));
