import type { SecurityReportRecord } from '../../../shared/types.ts';
import type { SecurityVm } from './SecurityScreen.tsx';

function Meta({ vm, r }: { vm: SecurityVm; r: SecurityReportRecord }) {
  return (
    <p className="small muted">
      {vm.when(r.createdAt)} · {r.method === 'llm' ? `LLM${r.model ? ` (${r.model})` : ''}` : 'heurística, sem LLM'}
      {r.createdBy ? ` · por ${r.createdBy}` : ''}
      {r.focus ? ` · foco: ${r.focus}` : ''}
      {r.llmError && <span className="warn-text"> · o LLM falhou ({r.llmError})</span>}
    </p>
  );
}

/** Análise escrita (resumo executivo, riscos, plano) e dicas, geradas sob demanda e guardadas com histórico. */
export function ReportPanel({ vm }: { vm: SecurityVm }) {
  const n = vm.report?.narrative;
  const tips = vm.tips?.tips ?? [];
  return (
    <section className="card report-panel">
      <div className="quality-head">
        <h3>Análise e dicas</h3>
        <span className="small muted">
          {vm.llm?.configured ? `LLM: ${vm.llm.model ?? 'configurado'}` : 'Sem LLM configurado: o texto é montado pela heurística'}
        </span>
      </div>

      {vm.canGenerate && (
        <div className="row report-actions no-print">
          <input
            className="grow"
            placeholder="Foco opcional (ex.: pipeline, segredos, preparar auditoria, o que fazer neste trimestre)"
            value={vm.focus}
            maxLength={500}
            onChange={(e) => vm.setFocus(e.target.value)}
          />
          <button className="primary" disabled={!!vm.generating} onClick={() => vm.generate('report')}>
            {vm.generating === 'report' ? 'Gerando relatório…' : 'Gerar relatório'}
          </button>
          <button disabled={!!vm.generating} onClick={() => vm.generate('tips')}>
            {vm.generating === 'tips' ? 'Gerando dicas…' : 'Gerar dicas'}
          </button>
        </div>
      )}
      {vm.generating && (
        <div className="progress-bar indeterminate no-print" role="progressbar" aria-label="Gerando">
          <span />
        </div>
      )}

      {!vm.report && !vm.tips && (
        <p className="muted">
          Nenhuma análise gerada ainda.{' '}
          {vm.canGenerate ? 'Gere o relatório para ter um resumo executivo, riscos priorizados e um plano de ação.' : 'Peça a um editor para gerar.'}
        </p>
      )}

      {n && vm.report && (
        <article className="narrative">
          <h4>Resumo executivo</h4>
          <Meta vm={vm} r={vm.report} />
          <p className="summary">{n.summary}</p>
          {n.highlights.length > 0 && (
            <>
              <h4>Pontos fortes</h4>
              <ul>
                {n.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </>
          )}
          {n.risks.length > 0 && (
            <>
              <h4>Riscos</h4>
              <div className="risk-list">
                {n.risks.map((r, i) => (
                  <div key={i} className={`risk-item ${r.severity}`}>
                    <div className="risk-title">
                      <span className={`risk-badge ${r.severity}`}>{vm.labels.risk[r.severity]}</span>
                      <b>{r.title}</b>
                      <span className="muted small">{vm.labels.axis[r.axis]}</span>
                    </div>
                    {r.evidence && <div className="small muted">{r.evidence}</div>}
                    <div className="small fix">→ {r.recommendation}</div>
                    {r.repos.length > 0 && <div className="small muted">Repositórios: {r.repos.join(', ')}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {n.roadmap.length > 0 && (
            <>
              <h4>Plano de ação</h4>
              <div className="roadmap">
                {(['now', 'next', 'later'] as const).map((h) => {
                  const items = n.roadmap.filter((r) => r.horizon === h);
                  return items.length ? (
                    <div key={h} className="roadmap-col">
                      <h5>{vm.labels.horizon[h]}</h5>
                      {items.map((r, i) => (
                        <div key={i} className="roadmap-item">
                          <b>{r.action}</b>
                          <span className="small muted">{r.impact}</span>
                          <span className="small">
                            {vm.labels.effort[r.effort]} · {vm.labels.axis[r.axis]}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })}
              </div>
            </>
          )}
        </article>
      )}

      {tips.length > 0 && vm.tips && (
        <article className="tips">
          <h4>Dicas{vm.tips.focus ? ` · ${vm.tips.focus}` : ''}</h4>
          <Meta vm={vm} r={vm.tips} />
          <ol>
            {tips.map((t, i) => (
              <li key={i}>
                <b>{t.title}</b>{' '}
                <span className="muted small">
                  {vm.labels.axis[t.axis]} · {vm.labels.effort[t.effort]}
                </span>
                <div className="small">
                  <i>Por quê:</i> {t.why}
                </div>
                <div className="small tip-how">{t.how}</div>
              </li>
            ))}
          </ol>
        </article>
      )}

      {vm.reports.length > 1 && (
        <details className="report-history no-print">
          <summary>Histórico ({vm.reports.length})</summary>
          {vm.pickedId != null && (
            <button className="link-button" onClick={() => vm.pick(null)}>
              Voltar aos mais recentes
            </button>
          )}
          <ul>
            {vm.reports.map((r) => (
              <li key={r.id}>
                <button className={`link-button${vm.pickedId === r.id ? ' active' : ''}`} onClick={() => vm.pick(r.id)}>
                  {vm.when(r.createdAt)} · {r.kind === 'tips' ? 'dicas' : 'relatório'} · {r.method === 'llm' ? 'LLM' : 'heurística'}
                  {r.focus ? ` · ${r.focus}` : ''}
                  {r.score != null ? ` · nota ${r.score}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
