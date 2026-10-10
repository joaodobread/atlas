import { X } from 'lucide-react';
import type { RepoIntrospectionDetail } from '../../../shared/types.ts';
import type { ReposViewModel } from '../../viewmodels/useReposViewModel.ts';
import { HistoryChart } from './charts.tsx';

const STALE_DAYS = 2;

export function RepoDetailPanel({ vm, d }: { vm: ReposViewModel; d: RepoIntrospectionDetail }) {
  const q = d.quality;
  const m = d.metrics;
  const p = d.process;
  const staleDays = d.analyzedAt ? (Date.now() - Date.parse(`${d.analyzedAt.replace(' ', 'T')}Z`)) / 86_400_000 : null;
  return (
    <aside className="repo-drawer">
      <button className="tool panel-close" onClick={vm.closeDetail} aria-label="Fechar">
        <X size={14} />
      </button>
      <p className="muted small">GITHUB{d.system ? ` · ${d.system}` : ''}</p>
      <h3 className="repo-title">
        {d.owner}/{d.name}
      </h3>
      <div className="score-row">
        <span className={`score-big ${vm.bandOf(d.score)}`}>{d.score ?? '—'}</span>
        <span className="muted small mono">
          {q ? `confiança ${Math.round(q.confidence * 100)}%` : 'sem análise'}
          <br />
          {d.analyzedAt ? `coletado ${d.analyzedAt.slice(0, 10)}` : ''} {q ? `· ${q.version}` : ''}
        </span>
      </div>
      {staleDays != null && staleDays > STALE_DAYS && (
        <p className="warn-text small">
          Dados de {Math.floor(staleDays)} dias atrás{d.stale ? ' e há commits novos' : ''}: reanalise.
        </p>
      )}
      <div className="row">
        {d.htmlUrl && (
          <a href={d.htmlUrl} target="_blank" rel="noreferrer">
            abrir no github ↗
          </a>
        )}
        {d.documentId && <button onClick={vm.openDocument}>Abrir documento</button>}
      </div>
      {d.error && <p className="field-error">{d.status === 'done' ? `Aviso: ${d.error}` : `Erro na última análise: ${d.error}`}</p>}
      {vm.canResume(d) && (
        <div className="row">
          <button className="primary" disabled={vm.busy} onClick={() => void vm.resume(d)}>
            Retomar análise
          </button>
          <span className="muted small">{vm.describeResumable(d.resumable!)}</span>
        </div>
      )}

      <section className="repo-section">
        <h4>Saúde</h4>
        <p className="small">
          <span className={`attention-badge ${d.attention.level}`}>{vm.attentionLabel[d.attention.level]}</span> · último push{' '}
          <span className={vm.idleClass(d.pushedAt)}>{vm.ageLabel(d.pushedAt)}</span>
          {d.archived ? ' · arquivado' : ''}
        </p>
        {d.attention.reasons.length > 0 && (
          <ul className="small">
            {d.attention.reasons.map((why) => (
              <li key={why}>{why}</li>
            ))}
          </ul>
        )}
        {d.activity && (
          <>
            <p className="small muted">
              {d.activity.openPrs == null
                ? `Não foi possível ler os PRs: ${d.activity.error ?? 'erro'}`
                : `${d.activity.openPrs} PR(s) aberto(s) · ${d.activity.draftPrs} rascunho(s) · coletado ${vm.ageLabel(d.activity.collectedAt)}`}
            </p>
            {d.activity.pulls.length > 0 && (
              <ul className="pr-list small">
                {d.activity.pulls.map((pr) => (
                  <li key={pr.number}>
                    <span className={`mono ${vm.idleClass(pr.createdAt)}`}>{vm.ageLabel(pr.createdAt)}</span>
                    <span className="grow" title={pr.title}>
                      {pr.url ? (
                        <a href={pr.url} target="_blank" rel="noreferrer">
                          #{pr.number} {pr.title}
                        </a>
                      ) : (
                        `#${pr.number} ${pr.title}`
                      )}
                    </span>
                    <span className="muted">{pr.author ?? '?'}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {d.history.length > 0 && (
        <section className="repo-section">
          <h4>Histórico</h4>
          <HistoryChart history={d.history} />
        </section>
      )}

      {d.analysis && (
        <section className="repo-section">
          <h4>O que é</h4>
          <p>{d.analysis.purpose}</p>
          <p className="muted small">
            {d.analysis.stack} · {d.analysis.deploy} · análise {d.analysis.method === 'llm' ? 'por LLM' : 'heurística'}
          </p>
        </section>
      )}

      {m && (
        <section className="repo-section">
          <h4>Métricas do CI</h4>
          <p className="small">
            {m.coverage?.lines != null && <>Cobertura {m.coverage.lines}% · </>}
            {Object.entries(m.tests).map(([k, t]) => (
              <span key={k}>
                {k}: {t.passed}/{t.total} ·{' '}
              </span>
            ))}
            {Object.entries(m.security).map(([k, c]) => (
              <span key={k}>
                {k.toUpperCase()}: {c.critical}C {c.high}H {c.medium}M {c.low}L ·{' '}
              </span>
            ))}
            <span className="muted">
              recebido {m.receivedAt} ({m.sha.slice(0, 7)})
            </span>
            {m.runUrl && (
              <>
                {' · '}
                <a href={m.runUrl} target="_blank" rel="noreferrer">
                  execução ↗
                </a>
              </>
            )}
          </p>
          {m.warnings.map((w) => (
            <p key={w} className="field-error small">
              {w}
            </p>
          ))}
        </section>
      )}

      {p && (
        <section className="repo-section">
          <h4>Processo ({p.windowDays} dias)</h4>
          <p className="small">
            {p.mergedPrs} PR(s) mesclado(s) · {p.reviewedPrs} revisado(s) · {p.linkedPrs} com issue · {p.commits} commit(s)
            {p.directPushes ? ` · ${p.directPushes.direct}/${p.directPushes.sampled} push(es) direto(s)` : ''} · {p.openPrs} PR(s) aberto(s)
          </p>
          {p.errors.map((e) => (
            <p key={e} className="field-error small">
              {e}
            </p>
          ))}
        </section>
      )}

      {q && (
        <section className="repo-section">
          <h4>Por que esta nota</h4>
          {q.categories.map((c) => (
            <div key={c.category} className="quality-category">
              <div className="quality-head">
                <strong>
                  {c.label} <span className="muted small">×{c.weight}</span>
                </strong>
                <span className="mono">{c.score ?? '—'}</span>
              </div>
              <div className="quality-bar">
                <span style={{ width: `${(c.score ?? 0) * 10}%` }} className={vm.bandOf(c.score)} />
              </div>
              {c.checks.map((ch) => (
                <div key={ch.id} className={`quality-check${ch.impact === 'signal' ? ' signal' : ''}`}>
                  <span className={`check-status ${ch.status}`}>{ch.status === 'warn' && ch.score != null ? ch.score : vm.statusLabel[ch.status]}</span>
                  <div>
                    <span className="mono muted">{ch.id}</span> {ch.detail}
                    {ch.impact === 'signal' && <span className="tag subtle">sinal</span>}
                    {ch.fix && <div className="muted small">correção: {ch.fix}</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {d.proposal && (
        <section className="repo-section">
          <h4>Proposta para o grafo</h4>
          <ul className="list small">
            {d.proposal.nodes
              .filter((n) => n.key !== 'group')
              .map((n) => (
                <li key={n.key}>
                  {n.existingId != null ? '↔ existente' : '+ novo'} · {n.name} <span className="muted">({n.kind})</span>
                </li>
              ))}
            {d.proposal.connections.map((c) => {
              const name = (k: string) => d.proposal!.nodes.find((n) => n.key === k)?.name ?? k;
              return (
                <li key={`${c.fromKey}->${c.toKey}`}>
                  → {name(c.fromKey)} chama {name(c.toKey)}{' '}
                  <span className="muted">
                    {c.protocol ?? ''} {c.description ?? ''}
                  </span>
                </li>
              );
            })}
          </ul>
          {vm.canRun && (
            <div className="row">
              <button className="primary" disabled={vm.busy} onClick={() => void vm.apply()}>
                Aplicar em “{vm.currentGraphName}”
              </button>
              {d.appliedAt && <span className="muted small">aplicada em {d.appliedAt}</span>}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
