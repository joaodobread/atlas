import type { ScoreHistoryPoint } from '../../../shared/types.ts';

/** Mini-gráfico das últimas notas (0–10). */
export function Sparkline({ values, width = 64, height = 18 }: { values: Array<number | null>; width?: number; height?: number }) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  if (pts.length < 2) return <span className="muted small">—</span>;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - (v / 10) * (height - 2);
  return (
    <svg className="sparkline" width={width} height={height} aria-hidden>
      <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} />
      <circle cx={x(pts.at(-1)!.i)} cy={y(pts.at(-1)!.v)} r={2} />
    </svg>
  );
}

/** Histórico da nota; a linha quebra (e marca) onde a versão das regras mudou. */
export function HistoryChart({ history }: { history: ScoreHistoryPoint[] }) {
  if (history.length < 2) return <p className="muted small">O histórico aparece a partir da segunda análise.</p>;
  const W = 420;
  const H = 110;
  const pad = { l: 22, r: 8, t: 8, b: 18 };
  const x = (i: number) => pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 10) * (H - pad.t - pad.b);
  // Segmentos contínuos dentro da mesma versão e com nota.
  const segments: Array<Array<{ i: number; v: number }>> = [];
  const boundaries: number[] = [];
  history.forEach((h, i) => {
    if (i > 0 && h.version !== history[i - 1]!.version) boundaries.push(i);
    const startNew = i === 0 || h.version !== history[i - 1]!.version || h.score == null || history[i - 1]!.score == null;
    if (h.score == null) return;
    if (startNew || !segments.length) segments.push([]);
    segments.at(-1)!.push({ i, v: h.score });
  });
  return (
    <svg className="history-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histórico da nota">
      {[0, 5, 10].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 4} y={y(v) + 3} className="axis" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {boundaries.map((i) => (
        <g key={i}>
          <line x1={x(i) - 0.5 * (x(1) - x(0))} x2={x(i) - 0.5 * (x(1) - x(0))} y1={pad.t} y2={H - pad.b} className="boundary" />
          <text x={x(i) - 0.5 * (x(1) - x(0)) + 3} y={pad.t + 8} className="axis">
            {history[i]!.version.replace('comm-graph-quality-', '')}
          </text>
        </g>
      ))}
      {segments.map((seg, k) => (seg.length > 1 ? <polyline key={k} points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} className="line" /> : null))}
      {history.map((h, i) =>
        h.score == null ? null : (
          <circle key={i} cx={x(i)} cy={y(h.score)} r={2.5} className="dot">
            <title>{`${h.createdAt}: ${h.score} (confiança ${Math.round(h.confidence * 100)}%, ${h.version})`}</title>
          </circle>
        ),
      )}
      <text x={pad.l} y={H - 4} className="axis">
        {history[0]!.createdAt.slice(0, 10)}
      </text>
      <text x={W - pad.r} y={H - 4} className="axis" textAnchor="end">
        {history.at(-1)!.createdAt.slice(0, 10)}
      </text>
    </svg>
  );
}
