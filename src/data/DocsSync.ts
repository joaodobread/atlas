import { useDocsStore } from '../stores/docsStore.ts';
import { DocumentApi } from './api/DocumentApi.ts';

/** Sincroniza o store de documentos com a API; acompanha a indexação enquanto houver pendências. */
export class DocsSync {
  private static instance: DocsSync | undefined;
  private polling: ReturnType<typeof setTimeout> | undefined;

  private constructor(private readonly api: DocumentApi) {}

  static getInstance(api: DocumentApi = DocumentApi.getInstance()): DocsSync {
    return (DocsSync.instance ??= new DocsSync(api));
  }

  async reload(): Promise<void> {
    const [documents, folders, status, llm] = await Promise.all([this.api.list(), this.api.folders(), this.api.status(), this.api.llm()]);
    useDocsStore.getState().setData({ documents, folders, status, llm });
    this.schedulePoll(status.pending > 0 || status.embeddingState !== 'idle');
  }

  private schedulePoll(active: boolean): void {
    clearTimeout(this.polling);
    if (!active) return;
    this.polling = setTimeout(() => {
      void this.reload().catch(() => this.schedulePoll(true));
    }, 2500);
  }
}
