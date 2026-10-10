import { useImportViewModel } from '../viewmodels/useImportViewModel.ts';

export function ImportModal() {
  const vm = useImportViewModel();
  return (
    <div className="modal-backdrop" onClick={vm.close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Importar JSON</h2>
          <button className="icon" onClick={vm.close}>
            ×
          </button>
        </header>
        <p className="muted">
          Formato de troca (o mesmo do export). Em <code>merge</code> é idempotente: nós casam por pai + nome. Refs podem apontar para nós existentes pelo
          caminho <code>Projeto/Modulo</code>.
        </p>
        <textarea
          className="code"
          rows={18}
          value={vm.text}
          onChange={(e) => vm.setText(e.target.value)}
          placeholder='{ "mode": "merge", "nodes": [], "connections": [] }'
        />
        {vm.error && <p className="field-error">{vm.error}</p>}
        {vm.result && (
          <div className="import-result">
            <p>
              Nós: {vm.result.nodesCreated} criados, {vm.result.nodesUpdated} atualizados · Interfaces: {vm.result.interfacesCreated} · Conexões:{' '}
              {vm.result.connectionsCreated} criadas, {vm.result.connectionsUpdated} atualizadas · Locais: {vm.result.callSitesCreated}
            </p>
            {vm.result.warnings.length > 0 && (
              <ul className="warnings">
                {vm.result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <footer className="row actions">
          <button onClick={vm.fillTemplate}>Exemplo</button>
          <span className="spacer" />
          <button onClick={vm.close}>Fechar</button>
          <button className="primary" disabled={vm.busy || !vm.text.trim()} onClick={vm.submit}>
            Importar
          </button>
        </footer>
      </div>
    </div>
  );
}
