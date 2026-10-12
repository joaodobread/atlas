import { AxisRadar } from './AxisRadar.tsx';
import type { SecurityVm } from './SecurityScreen.tsx';

const SOURCE_LABEL: Record<string, string> = { sast: 'SAST', dast: 'DAST', sca: 'SCA', secrets: 'Segredos' };

export function RepoPostureView({ vm }: { vm: SecurityVm }) {
  const p = vm.posture;
  if (!p)
    return (
      <div className="card">
        <p>Este repositório ainda não foi analisado.</p>
        <button className="primary" onClick={vm.openRepos}>
          Ir para Repositórios
        </button>
      </div>
    );
  const f = p.findings;
  const sources = Object.entries(f.bySource);
  return (
    <>
      <div className="stat-tiles security-tiles">
        <div className="tile">
          <span className="tile-label">Nota de segurança</span>
          <strong className={`score-big ${vm.band(p.score)}`}>{p.score ?? '—'}</strong>
          <span className="small muted">
            analisado {p.analyzedAt ? vm.when(p.analyzedAt) : '—'}
            {p.metricsAt ? ` · métricas do CI ${vm.when(p.metricsAt)}` : ' · CI não envia métricas'}
          </span>
        </div>
        <div className="tile">
          <span className="tile-label">Risco</span>
          <span className={`risk-badge big ${p.risk}`}>{vm.labels.risk[p.risk]}</span>
          {p.riskReasons.length > 0 && (
            <ul className="reason-list small">
              {p.riskReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="tile">
          <span className="tile-label">Maturidade DevSecOps</span>
          <div className="level-steps" aria-label={`Nível ${p.maturity.level} de 4`}>
            {vm.labels.maturity.slice(1).map((label, i) => (
              <span key={label} className={i + 1 <= p.maturity.level ? `on l${i + 1}` : ''} title={`Nível ${i + 1}: ${label}`} />
            ))}
          </div>
          <strong>
            Nível {p.maturity.level} · {p.maturity.label}
          </strong>
          {p.maturity.next && (
            <span className="small muted">
              Para o nível {p.maturity.next.level} ({p.maturity.next.label}): {p.maturity.next.missing.join(', ')}
            </span>
          )}
        </div>
        <div className="tile">
          <span className="tile-label">Achados abertos no CI</span>
          <strong className={f.total.critical ? 'bad-text' : f.total.high ? 'warn-text' : ''}>
            {f.total.critical} / {f.total.high}
          </strong>
          <span className="small muted">
            críticos / altos · {f.total.medium} médios · {f.total.low} baixos
            {f.vulnerableDependencies != null ? ` · ${f.vulnerableDependencies} dependência(s) vulnerável(is)` : ''}
          </span>
        </div>
      </div>

      <div className="security-grid">
        <section className="card">
          <h3>Eixos</h3>
          <AxisRadar labels={p.axes.map((a) => a.label)} values={p.axes.map((a) => a.score)} />
          <h3>Práticas DevSecOps</h3>
          <div className="practice-list">
            {p.practices.map((x) => (
              <span
                key={x.id}
                className={`practice ${!x.applicable ? 'na' : x.adopted == null ? 'unknown' : x.adopted ? 'pass' : 'fail'}`}
                title={!x.applicable ? 'Não se aplica' : x.adopted == null ? 'Não verificado' : x.adopted ? 'Adotada' : 'Não adotada'}
              >
                {x.label}
              </span>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Achados por origem</h3>
          {sources.length ? (
            <table className="repos-table severity-table">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Críticos</th>
                  <th>Altos</th>
                  <th>Médios</th>
                  <th>Baixos</th>
                </tr>
              </thead>
              <tbody>
                {sources.map(([k, c]) => (
                  <tr key={k}>
                    <td>{SOURCE_LABEL[k] ?? k}</td>
                    <td className={c.critical ? 'bad-text' : 'muted'}>{c.critical}</td>
                    <td className={c.high ? 'warn-text' : 'muted'}>{c.high}</td>
                    <td>{c.medium}</td>
                    <td className="muted">{c.low}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">O CI não enviou SARIF de SAST, DAST, SCA ou segredos.</p>
          )}
          {f.tools.length > 0 && <p className="small muted">Ferramentas: {f.tools.join(', ')}</p>}
          {f.sonar && (
            <div className="sonar-box">
              <h4>SonarQube</h4>
              <div className="sonar-grid">
                {f.sonar.qualityGate && (
                  <span>
                    Quality gate{' '}
                    <b className={f.sonar.qualityGate === 'OK' ? 'good-text' : f.sonar.qualityGate === 'WARN' ? 'warn-text' : 'bad-text'}>
                      {f.sonar.qualityGate}
                    </b>
                  </span>
                )}
                {(
                  [
                    ['Segurança', f.sonar.ratings.security],
                    ['Confiabilidade', f.sonar.ratings.reliability],
                    ['Manutenibilidade', f.sonar.ratings.maintainability],
                    ['Hotspots revisados', f.sonar.ratings.hotspotsReviewed],
                  ] as const
                ).map(([label, r]) =>
                  r ? (
                    <span key={label}>
                      {label} <b className={`rating r${r}`}>{r}</b>
                    </span>
                  ) : null,
                )}
                {f.sonar.vulnerabilities != null && <span>{f.sonar.vulnerabilities} vulnerabilidade(s)</span>}
                {f.sonar.hotspots != null && <span>{f.sonar.hotspots} hotspot(s)</span>}
                {f.sonar.bugs != null && <span>{f.sonar.bugs} bug(s)</span>}
                {f.sonar.codeSmells != null && <span>{f.sonar.codeSmells} code smell(s)</span>}
                {f.sonar.duplication != null && <span>{f.sonar.duplication}% duplicado</span>}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="axis-cards">
        {p.axes.map((a) => (
          <section key={a.axis} className="card">
            <div className="quality-head">
              <h3 title={vm.labels.axisHint[a.axis]}>{a.label}</h3>
              <span className={`score-badge ${vm.band(a.score)}`}>{a.score ?? '—'}</span>
            </div>
            <div className="quality-bar">
              <span className={vm.band(a.score)} style={{ width: `${a.score ?? 0}%` }} />
            </div>
            {a.items.map((i) => (
              <div key={i.id} className="quality-check">
                <span className={`check-status ${i.status}`}>{vm.labels.status[i.status]}</span>
                <div>
                  <div>{i.label}</div>
                  <div className="muted small">{i.detail}</div>
                  {i.fix && i.status !== 'pass' && <div className="small fix">→ {i.fix}</div>}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
