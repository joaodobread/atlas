import { useEffect, useRef } from 'react';
import { useDocumentViewerViewModel } from '../../viewmodels/useDocumentViewerViewModel.ts';

export function DocumentViewer() {
  const vm = useDocumentViewerViewModel();
  const firstRef = useRef<HTMLDivElement>(null);

  // Rola até a faixa citada.
  useEffect(() => {
    firstRef.current?.scrollIntoView({ block: 'center' });
  }, [vm.doc, vm.firstHighlightedLine]);

  if (!vm.open) return null;
  return (
    <div className="modal-backdrop" onClick={vm.close}>
      <div className="modal doc-viewer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{vm.doc?.title ?? 'Carregando…'}</h2>
            {vm.doc && <p className="muted small">{vm.doc.path}</p>}
          </div>
          <button className="icon" onClick={vm.close}>
            ×
          </button>
        </header>
        {vm.error && <p className="field-error">{vm.error}</p>}
        {vm.mentionedNodes.length > 0 && (
          <div className="chips">
            <span className="muted small">Menciona:</span>
            {vm.mentionedNodes.map((n) => (
              <button key={n.id} className="chip small" title={n.path} onClick={() => vm.focusNode(n.id)}>
                {n.name}
              </button>
            ))}
          </div>
        )}
        <div className="doc-lines">
          {vm.lines.map((text, i) => {
            const line = i + 1;
            const hi = vm.isHighlighted(line);
            return (
              <div key={line} ref={line === vm.firstHighlightedLine ? firstRef : undefined} className={`doc-line${hi ? ' hi' : ''}`}>
                <span className="ln">{line}</span>
                <span className="tx">{text || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
