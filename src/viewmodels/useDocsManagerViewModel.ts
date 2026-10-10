import { useState } from 'react';
import { importDocumentsSchema, watchedFolderSchema } from '../../shared/schemas.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { useDocsStore } from '../stores/docsStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { usePermissions } from './usePermissions.ts';

/** Upload de .md, pastas monitoradas e lista de documentos. */
export function useDocsManagerViewModel() {
  const documents = useDocsStore((s) => s.documents);
  const folders = useDocsStore((s) => s.folders);
  const status = useDocsStore((s) => s.status);
  const pushToast = useUiStore((s) => s.pushToast);
  const openDocument = useUiStore((s) => s.openDocument);
  const [folderPath, setFolderPath] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { canEditDocs, canManageSettings } = usePermissions();

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) pushToast('success', success);
    } catch (err) {
      pushToast('error', errorMessage(err));
    } finally {
      await DocsSync.getInstance()
        .reload()
        .catch(() => undefined);
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const documents = await Promise.all(
      [...files].map(async (f) => ({ path: `upload/${f.webkitRelativePath || f.name}`, content: await f.text(), source: 'upload' as const })),
    );
    const parsed = importDocumentsSchema.safeParse({ documents });
    if (!parsed.success) return pushToast('error', errorMessage(parsed.error));
    await run(async () => {
      const out = await DocumentApi.getInstance().importMany(parsed.data);
      const changed = out.filter((o) => o.status !== 'unchanged').length;
      pushToast('success', `${changed} documento(s) indexado(s)${out.length - changed ? `, ${out.length - changed} sem mudanças` : ''}`);
    });
  };

  const addFolder = async () => {
    const parsed = watchedFolderSchema.safeParse({ path: folderPath });
    if (!parsed.success) return setFolderError(errorMessage(parsed.error));
    setFolderError(null);
    await run(async () => {
      await DocumentApi.getInstance().addFolder(parsed.data.path);
      setFolderPath('');
    }, 'Pasta adicionada e indexada');
  };

  return {
    documents,
    folders,
    status,
    busy,
    canUpload: canEditDocs,
    canManageFolders: canManageSettings,
    folderPath,
    setFolderPath: (v: string) => {
      setFolderPath(v);
      setFolderError(null);
    },
    folderError,
    upload,
    addFolder,
    removeFolder: (id: number) => {
      if (confirm('Parar de monitorar esta pasta? Os documentos dela saem do índice.'))
        void run(() => DocumentApi.getInstance().removeFolder(id), 'Pasta removida');
    },
    rescanFolder: (id: number) => run(() => DocumentApi.getInstance().rescanFolder(id), 'Pasta reindexada'),
    removeDocument: (id: number) => {
      if (confirm('Remover este documento do índice?')) void run(() => DocumentApi.getInstance().remove(id), 'Documento removido');
    },
    openDocument: (id: number) => openDocument({ documentId: id }),
    indexLabel: !status
      ? ''
      : status.embeddingState === 'loading-model'
        ? 'Baixando/carregando modelo de embeddings…'
        : status.embeddingState === 'indexing' || status.pending > 0
          ? `Vetorizando: ${status.embedded}/${status.chunks} trechos`
          : status.embeddingState === 'error'
            ? `Erro nos embeddings: ${status.embeddingError ?? ''}`
            : `${status.documents} documentos + ${status.graphDocuments} nós do modelo · ${status.chunks} trechos vetorizados`,
    sourceLabel: (s: string) => (s === 'folder' ? 'pasta' : s === 'upload' ? 'upload' : 'API'),
    fileName: (p: string) => p.split(/[\\/]/).pop() ?? p,
  };
}
