import { create } from 'zustand';
import type { DocumentSummary, IndexStatus, LlmInfo, WatchedFolder } from '../../shared/types.ts';

interface DocsState {
  documents: DocumentSummary[];
  folders: WatchedFolder[];
  status: IndexStatus | null;
  llm: LlmInfo | null;
  setData(data: Partial<Pick<DocsState, 'documents' | 'folders' | 'status' | 'llm'>>): void;
}

/** Model: documentos indexados, pastas monitoradas e estado da indexação. */
export const useDocsStore = create<DocsState>()((set) => ({
  documents: [],
  folders: [],
  status: null,
  llm: null,
  setData: (data) => set(data),
}));
