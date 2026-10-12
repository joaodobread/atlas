import { useSecurityReportViewModel } from '../../viewmodels/useSecurityReportViewModel.ts';
import { PortfolioView } from './PortfolioView.tsx';
import { RepoPostureView } from './RepoPostureView.tsx';
import { ReportPanel } from './ReportPanel.tsx';

export type SecurityVm = ReturnType<typeof useSecurityReportViewModel>;

export function SecurityScreen() {
  const vm = useSecurityReportViewModel();
  const title = vm.scope ? `${vm.scope.owner}/${vm.scope.name}` : 'Segurança e DevSecOps';
  return (
    <div className="repos-screen security-screen">
      <main className="repos-main">
        <header className="repos-header">
          <div>
            {vm.scope && (
              <button className="link-button no-print" onClick={vm.back}>
                ← Todos os repositórios
              </button>
            )}
            <h1>{title}</h1>
            <p className="muted">
              {vm.scope
                ? 'Postura de segurança do repositório em 4 eixos, maturidade DevSecOps e análise escrita pelo LLM.'
                : 'Visão consolidada para quem gerencia: vulnerabilidades, pipeline DevSecOps, cadeia de suprimentos e governança de todos os repositórios analisados.'}
            </p>
          </div>
          <div className="row no-print">
            <button onClick={vm.reload} disabled={vm.loading}>
              Atualizar
            </button>
            <button onClick={vm.exportMarkdown} disabled={vm.loading} title="Baixa o relatório (postura + análise + dicas) em Markdown">
              Exportar Markdown
            </button>
            <button onClick={vm.print} disabled={vm.loading} title="Use “Salvar como PDF” na janela de impressão">
              Imprimir / PDF
            </button>
          </div>
        </header>

        {vm.error ? (
          <div className="card">
            <p className="field-error">Não foi possível carregar o relatório: {vm.error}</p>
            <button onClick={vm.reload}>Tentar de novo</button>
          </div>
        ) : vm.loading && !vm.portfolio && !vm.posture ? (
          <p className="muted">Calculando a postura de segurança…</p>
        ) : (
          <>
            {vm.scope ? <RepoPostureView vm={vm} /> : <PortfolioView vm={vm} />}
            {(vm.scope ? vm.posture : vm.portfolio?.analyzed) ? <ReportPanel vm={vm} /> : null}
          </>
        )}
      </main>
    </div>
  );
}
