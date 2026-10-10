import type { ProgressRow } from '../../viewmodels/introspectionProgress.ts';

/** Repositórios em análise: etapa, barra (indeterminada quando não dá para contar) e tempo decorrido. */
export function ProgressList({ rows }: { rows: ProgressRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="progress-list" aria-live="polite">
      {rows.map((r) => (
        <li key={r.repo}>
          <div className="progress-head">
            <strong>{r.repo}</strong>
            <span className="muted small mono">{r.elapsed}</span>
          </div>
          <div className="small">
            {r.label}
            {r.counter ? <span className="muted"> · {r.counter}</span> : null}
          </div>
          <div
            className={`progress-bar${r.percent == null ? ' indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={r.percent ?? undefined}
          >
            <span style={r.percent == null ? undefined : { width: `${r.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
