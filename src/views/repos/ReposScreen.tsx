import type { QualityCategory } from '../../../shared/types.ts';
import { useReposViewModel, type AttentionFilter, type Band, type IdleFilter } from '../../viewmodels/useReposViewModel.ts';
import { Sparkline } from './charts.tsx';
import { GenerateGraphDialog } from './GenerateGraphDialog.tsx';
import { ProgressList } from './ProgressList.tsx';
import { RepoDetailPanel } from './RepoDetailPanel.tsx';

const COLUMNS = [
  { key: 'name', label: 'Repositório' },
  { key: 'attention', label: 'Saúde' },
  { key: 'score', label: 'Nota' },
  { key: 'confidence', label: 'Confiança' },
  { key: 'coverage', label: 'Cobertura' },
  { key: 'security', label: 'Segurança' },
  { key: 'openPrs', label: 'PRs abertos' },
  { key: 'pushedAt', label: 'Último push' },
] as const;

export function ReposScreen() {
  const vm = useReposViewModel();
  const s = vm.stats;
  const bandTotal = Math.max(1, s.total);
  return (
    <div className={`repos-screen${vm.detail ? ' with-detail' : ''}`}>
      <main className="repos-main">
        <header className="repos-header">
          <div>
            <h1>Repositórios</h1>
            <p className="muted">Saúde dos repositórios do GitHub: CI, testes, segurança, guardrails, processo e documentação.</p>
          </div>
          <div className="row">
            {vm.canRun && (
              <>
                <button disabled={vm.busy} onClick={() => void vm.sync()} title="Busca a lista de repositórios no GitHub">
                  Sincronizar lista
                </button>
                <button disabled={vm.busy || !vm.checked.size} onClick={() => void vm.introspect(true)}>
                  Analisar selecionados ({vm.checked.size})
                </button>
                <button
                  disabled={vm.busy || !vm.checked.size}
                  onClick={vm.openGenerate}
                  title="Novo grafo com os repositórios selecionados e com quem eles se comunicam"
                >
                  Gerar grafo ({vm.checked.size})
                </button>
                <button className="primary" disabled={vm.busy || !s.total} onClick={() => void vm.introspect(false)}>
                  Analisar todos
                </button>
                <label className="check" title="Reanalisa mesmo sem commits novos">
                  <input type="checkbox" checked={vm.force} onChange={(e) => vm.setForce(e.target.checked)} />
                  Forçar
                </label>
              </>
            )}
            {vm.canConfigure && <button onClick={vm.openSettings}>Configurar</button>}
          </div>
        </header>

        {vm.state && (vm.state.running || vm.state.queued > 0) && (
          <>
            <p className="hint">
              {vm.state.queued} na fila, {vm.state.done} concluído(s), {vm.state.failed} com erro.
            </p>
            <ProgressList rows={vm.progressRows} />
          </>
        )}

        <div className="stat-tiles">
          <div className="tile">
            <span className="tile-label">Distribuição das notas</span>
            <div className="band-bar">
              {(['good', 'mid', 'bad', 'none'] as Band[]).map((b) =>
                s.bands[b] ? (
                  <span key={b} className={b} style={{ width: `${(s.bands[b] / bandTotal) * 100}%` }} title={`${vm.bandLabel[b]}: ${s.bands[b]}`} />
                ) : null,
              )}
            </div>
            <span className="small muted">
              {s.bands.good} bons · {s.bands.mid} atenção · {s.bands.bad} ruins · {s.bands.none} sem nota
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Analisados</span>
            <strong>
              {s.analyzed}/{s.total}
            </strong>
          </div>
          <div className="tile">
            <span className="tile-label">Enviam métricas do CI</span>
            <strong>{s.withMetrics == null ? '—' : `${s.withMetrics}%`}</strong>
          </div>
          <div className="tile">
            <span className="tile-label">Confiança mediana</span>
            <strong>{s.medianConfidence == null ? '—' : `${s.medianConfidence}%`}</strong>
          </div>
          <div className="tile">
            <span className="tile-label">Ligados ao grafo</span>
            <strong>
              {s.linked}/{s.total}
            </strong>
          </div>
        </div>

        <div className="stat-tiles health-tiles">
          <button
            className="tile clickable"
            onClick={vm.showAttention}
            title="Parados há muito tempo, PRs esquecidos, dependências vulneráveis, runtime sem suporte ou nota baixa"
          >
            <span className="tile-label">Precisam de atenção</span>
            <strong className={s.needAttention ? 'bad-text' : ''}>{s.needAttention}</strong>
            <span className="small muted">+ {s.watch} para observar</span>
          </button>
          <button className="tile clickable" onClick={vm.showIdleYear} title="Sem nenhum push há 12 meses ou mais (arquivados não contam)">
            <span className="tile-label">Parados há +12 meses</span>
            <strong className={s.idleYear ? 'warn-text' : ''}>{s.idleYear}</strong>
          </button>
          <button className="tile clickable" onClick={vm.showOldPrs} title="PRs (sem rascunhos e bots) abertos há mais de 30 dias">
            <span className="tile-label">PRs abertos há +30 dias</span>
            <strong className={s.oldPrs ? 'warn-text' : ''}>{s.oldPrs}</strong>
            <span className="small muted">
              em {s.reposWithOldPrs} repositório(s)
              {s.prsUnreadable ? ` · ${s.prsUnreadable} sem permissão para ler PRs` : ''}
            </span>
          </button>
        </div>

        <div className="repos-filters row">
          <input className="grow" placeholder="Filtrar por repositório ou sistema" value={vm.filter} onChange={(e) => vm.setFilter(e.target.value)} />
          <select value={vm.band} onChange={(e) => vm.setBand(e.target.value as Band | '')}>
            <option value="">Todas as notas</option>
            {(Object.keys(vm.bandLabel) as Band[]).map((b) => (
              <option key={b} value={b}>
                {vm.bandLabel[b]}
              </option>
            ))}
          </select>
          <select value={vm.failing} onChange={(e) => vm.setFailing(e.target.value as QualityCategory | '')}>
            <option value="">Qualquer categoria</option>
            {(Object.keys(vm.categoryLabel) as QualityCategory[]).map((c) => (
              <option key={c} value={c}>
                Reprovado em {vm.categoryLabel[c]}
              </option>
            ))}
          </select>
          <select value={vm.idle} onChange={(e) => vm.setIdle((e.target.value ? Number(e.target.value) : '') as IdleFilter)}>
            <option value="">Qualquer atividade</option>
            {vm.idleOptions.map((m) => (
              <option key={m} value={m}>
                Sem commits há {m}+ meses
              </option>
            ))}
          </select>
          <select value={vm.attention} onChange={(e) => vm.setAttention(e.target.value as AttentionFilter)}>
            <option value="">Qualquer saúde</option>
            <option value="attention">Precisam de atenção</option>
            <option value="watch">Atenção ou observar</option>
          </select>
          <span className="muted small">{vm.visibleCount} repositório(s)</span>
        </div>

        <div className="repos-table-wrap">
          <table className="repos-table">
            <thead>
              <tr>
                {vm.canRun && <th />}
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => vm.sortBy(c.key)} className={vm.sort.key === c.key ? 'sorted' : ''}>
                    {c.label}
                    {vm.sort.key === c.key ? (vm.sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th onClick={() => vm.sortBy('system')} className={vm.sort.key === 'system' ? 'sorted' : ''} title="Agrupar por sistema">
                  Tendência
                </th>
              </tr>
            </thead>
            {vm.groups.map((g) => (
              <tbody key={g.name ?? 'all'}>
                {g.name && (
                  <tr className="group-row">
                    <td colSpan={COLUMNS.length + (vm.canRun ? 2 : 1)}>
                      {g.name} <span className="muted small">{g.repos.length}</span>
                    </td>
                  </tr>
                )}
                {g.repos.map((r) => (
                  <tr key={r.id} className={vm.selectedId === r.id ? 'active' : ''} onClick={() => vm.select(r.id)}>
                    {vm.canRun && (
                      <td>
                        <input
                          type="checkbox"
                          checked={vm.checked.has(r.name)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => vm.toggleChecked(r.name)}
                        />
                      </td>
                    )}
                    <td>
                      <div className="repo-name">
                        <span>{r.name}</span>
                        <span className="muted small">
                          {r.language ?? ''}
                          {r.status === 'running' ? ' · analisando…' : ''}
                          {r.status === 'pending' && !r.analyzedAt ? ' · não analisado' : ''}
                          {r.status === 'error' ? ' · erro' : ''}
                          {r.stale ? ' · commits novos' : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`attention-badge ${r.attention.level}`} title={r.attention.reasons.join('\n') || 'Nada a apontar'}>
                        {r.attention.level === 'ok' ? '●' : `${vm.attentionLabel[r.attention.level]} · ${r.attention.reasons.length}`}
                      </span>
                    </td>
                    <td>
                      <span className={`score-badge ${vm.bandOf(r.score)}`}>{r.score ?? '—'}</span>
                    </td>
                    <td className="mono small">{r.confidence == null ? '—' : `${Math.round(r.confidence * 100)}%`}</td>
                    <td className={`mono small ${r.coverage == null ? 'muted' : r.coverage >= 80 ? 'ok-text' : r.coverage >= 60 ? 'warn-text' : 'bad-text'}`}>
                      {r.coverage == null ? '—' : `${r.coverage}%`}
                    </td>
                    <td
                      className={`mono small ${r.securityFindings == null ? 'muted' : r.securityFindings === 0 ? 'ok-text' : r.securityFindings <= 4 ? 'warn-text' : 'bad-text'}`}
                    >
                      {r.securityFindings ?? '—'}
                    </td>
                    <td
                      className={`mono small ${r.activity?.openPrs == null ? 'muted' : r.activity.oldPrs ? 'warn-text' : ''}`}
                      title={
                        r.activity?.error ?? (r.activity ? `${r.activity.draftPrs} rascunho(s); ${r.activity.oldPrs} há mais de 30 dias` : 'Sincronize a lista')
                      }
                    >
                      {r.activity?.openPrs ?? '—'}
                      {r.activity?.oldPrs ? ` (${r.activity.oldPrs} antigos)` : ''}
                    </td>
                    <td className={`small ${vm.idleClass(r.pushedAt)}`} title={r.pushedAt ?? ''}>
                      {vm.ageLabel(r.pushedAt)}
                      {r.archived ? ' · arquivado' : ''}
                    </td>
                    <td>
                      <Sparkline values={r.trend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {!s.total && <p className="muted">Nenhum repositório. Configure o GitHub e clique em “Sincronizar lista”.</p>}
        </div>
      </main>
      {vm.detail && <RepoDetailPanel vm={vm} d={vm.detail} />}
      {vm.generating && <GenerateGraphDialog repos={vm.selectedRepos} onClose={vm.closeGenerate} />}
    </div>
  );
}
