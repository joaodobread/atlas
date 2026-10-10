import type { FormEvent } from 'react';
import { useDocsManagerViewModel } from '../../viewmodels/useDocsManagerViewModel.ts';
import { Field } from '../common/Field.tsx';

export function DocsManager() {
  const vm = useDocsManagerViewModel();

  const submitFolder = (e: FormEvent) => {
    e.preventDefault();
    void vm.addFolder();
  };

  return (
    <details className="docs-manager" open={vm.documents.length === 0}>
      <summary>
        Gerenciar documentos <span className="muted small">{vm.indexLabel}</span>
      </summary>

      {vm.canUpload && (
        <label className="upload">
          <input type="file" accept=".md,.markdown,.mdx,text/markdown" multiple onChange={(e) => void vm.upload(e.target.files)} disabled={vm.busy} />
          <span>Enviar arquivos .md</span>
        </label>
      )}

      {vm.canManageFolders && (
        <form className="inline-form" onSubmit={submitFolder}>
          <Field error={vm.folderError ?? undefined}>
            <input placeholder="Pasta local: /Users/.../repo/docs" value={vm.folderPath} onChange={(e) => vm.setFolderPath(e.target.value)} />
          </Field>
          <button disabled={vm.busy}>Monitorar</button>
        </form>
      )}

      {vm.folders.length > 0 && (
        <ul className="list">
          {vm.folders.map((f) => (
            <li key={f.id}>
              <span title={f.path}>
                📁 {vm.fileName(f.path)} <span className="muted small">{f.documentCount} docs</span>
              </span>
              <span>
                {vm.canUpload && (
                  <button className="icon" title="Reindexar" onClick={() => void vm.rescanFolder(f.id)}>
                    ↻
                  </button>
                )}
                {vm.canManageFolders && (
                  <button className="icon" title="Parar de monitorar" onClick={() => vm.removeFolder(f.id)}>
                    ×
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ul className="list doc-list">
        {vm.documents.map((d) => (
          <li key={d.id} className="link" onClick={() => vm.openDocument(d.id)} title={d.path}>
            <span>
              {d.title}
              <span className="tag subtle">{vm.sourceLabel(d.source)}</span>
              {d.mentionCount > 0 && <span className="tag">{d.mentionCount} nós</span>}
              {d.embeddedCount < d.chunkCount && <span className="tag subtle">vetorizando</span>}
            </span>
            {d.source !== 'folder' && vm.canUpload && (
              <button
                className="icon"
                title="Remover"
                onClick={(e) => {
                  e.stopPropagation();
                  vm.removeDocument(d.id);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
