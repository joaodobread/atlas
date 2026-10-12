import type { RiskLevel } from '../../../shared/types.ts';
import { AxisRadar } from './AxisRadar.tsx';
import type { SecurityVm } from './SecurityScreen.tsx';

export function PortfolioView({ vm }: { vm: SecurityVm }) {
  const p = vm.portfolio;
  if (!p) return null;
  if (!p.analyzed)
    return (
      <div className="card">
        <p>Nenhum repositório analisado ainda{p.repos ? ` (${p.repos} na lista)` : ''}.</p>
        <p className="muted small">O relatório usa o scorecard da análise e as métricas que o CI envia (SARIF, SonarQube, cobertura…).</p>
        <button className="primary" onClick={vm.openRepos}>
          Ir para Repositórios
        </button>
      </div>
    );
  const levelTotal = Math.max(1, p.analyzed);
  return (
    <>
      <div className="stat-tiles security-tiles">
        <div className="tile">
          <span className="tile-label">Nota média de segurança</span>
          <strong className={`score-big ${vm.band(p.score)}`}>{p.score ?? '—'}</strong>
          <span className="small muted">
            {p.analyzed} de {p.repos} repositório(s) analisado(s)
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Risco</span>
          <div className="risk-counts">
            {vm.riskLevels.map((r) => (
              <button
                key={r}
                className={`risk-badge ${r}${vm.risk === r ? ' active' : ''}`}
                onClick={() => vm.setRisk(vm.risk === r ? '' : r)}
                title="Filtrar a tabela"
              >
                {p.byRisk[r]} {vm.labels.risk[r].toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="tile">
          <span className="tile-label">Achados abertos no CI</span>
          <strong className={p.findings.critical ? 'bad-text' : p.findings.high ? 'warn-text' : ''}>
            {p.findings.critical} / {p.findings.high}
          </strong>
          <span className="small muted">
            críticos / altos · {p.findings.medium} médios · {p.vulnerableDependencies} dependência(s) vulnerável(is)
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Maturidade DevSecOps</span>
          <div className="level-bar">
            {p.byLevel.map((n, level) =>
              n ? (
                <span
                  key={level}
                  className={`l${level}`}
                  style={{ width: `${(n / levelTotal) * 100}%` }}
                  title={`Nível ${level} (${vm.labels.maturity[level]}): ${n}`}
                />
              ) : null,
            )}
          </div>
          <span className="small muted">{p.byLevel.map((n, level) => `${n} nível ${level}`).join(' · ')}</span>
        </div>
      </div>

      <div className="security-grid">
        <section className="card">
          <h3>Eixos (média)</h3>
          <AxisRadar labels={vm.axes.map((a) => vm.labels.axis[a])} values={vm.axes.map((a) => p.axes[a])} />
          {vm.axes.map((a) => (
            <div key={a} className="axis-line" title={vm.labels.axisHint[a]}>
              <span>{vm.labels.axis[a]}</span>
              <div className="quality-bar">
                <span className={vm.band(p.axes[a])} style={{ width: `${p.axes[a] ?? 0}%` }} />
              </div>
              <span className="mono">{p.axes[a] ?? '—'}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Adoção das práticas DevSecOps</h3>
          {p.adoption.map((a) => (
            <div key={a.id} className="adoption-line">
              <span>{a.label}</span>
              <div className="quality-bar">
                <span className={vm.band(a.measured ? vm.pct(a.adopted, a.measured) : null)} style={{ width: `${vm.pct(a.adopted, a.measured)}%` }} />
              </div>
              <span className="mono small">{a.measured ? `${a.adopted}/${a.measured}` : 'n/v'}</span>
            </div>
          ))}
          <p className="hint">Entre os repositórios em que a prática se aplica e pôde ser verificada (n/v = nenhum verificado).</p>
        </section>
      </div>

      <section className="card">
        <h3>Repositórios por risco</h3>
        <div className="repos-filters row">
          <input className="grow" placeholder="Filtrar repositório" value={vm.filter} onChange={(e) => vm.setFilter(e.target.value)} />
          <select value={vm.risk} onChange={(e) => vm.setRisk(e.target.value as RiskLevel | '')}>
            <option value="">Qualquer risco</option>
            {vm.riskLevels.map((r) => (
              <option key={r} value={r}>
                Risco {vm.labels.risk[r].toLowerCase()}
              </option>
            ))}
          </select>
          <span className="muted small">{vm.rows.length} repositório(s)</span>
        </div>
        <div className="repos-table-wrap">
          <table className="repos-table">
            <thead>
              <tr>
                <th>Repositório</th>
                <th>Risco</th>
                <th>Nota</th>
                <th>Nível</th>
                {vm.axes.map((a) => (
                  <th key={a} title={vm.labels.axisHint[a]}>
                    {vm.labels.axis[a]}
                  </th>
                ))}
                <th title="Achados críticos / altos no CI">Crít./altos</th>
                <th title="Dependências com vulnerabilidade conhecida (OSV)">Dep. vuln.</th>
                <th>Motivos</th>
              </tr>
            </thead>
            <tbody>
              {vm.rows.map((r) => (
                <tr key={`${r.owner}/${r.name}`} onClick={() => vm.openRepo(r.owner, r.name)}>
                  <td className="nowrap">{r.name}</td>
                  <td>
                    <span className={`risk-badge ${r.risk}`}>{vm.labels.risk[r.risk]}</span>
                  </td>
                  <td>
                    <span className={`score-badge ${vm.band(r.score)}`}>{r.score ?? '—'}</span>
                  </td>
                  <td title={vm.labels.maturity[r.level]}>{r.level}</td>
                  {vm.axes.map((a) => (
                    <td key={a} className={`mono ${vm.band(r.axes[a])}-text`}>
                      {r.axes[a] ?? '—'}
                    </td>
                  ))}
                  <td className={r.critical ? 'bad-text' : r.high ? 'warn-text' : 'muted'}>
                    {r.critical}/{r.high}
                  </td>
                  <td className={r.vulnerableDependencies ? 'warn-text' : 'muted'}>{r.vulnerableDependencies ?? '—'}</td>
                  <td className="small muted">{r.reasons.join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
