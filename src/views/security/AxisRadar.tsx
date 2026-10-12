import { radarPoints } from '../../domain/securityReport.ts';

const W = 400;
const H = 230;
const CX = W / 2;
const CY = H / 2;
const R = 72;

/** Radar dos eixos (0–100). */
export function AxisRadar({ labels, values }: { labels: string[]; values: Array<number | null> }) {
  const rings = [25, 50, 75, 100].map((v) =>
    radarPoints(
      labels.map(() => v),
      R,
      CX,
      CY,
    ),
  );
  const outer = rings.at(-1)!;
  const shape = radarPoints(values, R, CX, CY);
  const tip = radarPoints(
    labels.map(() => 100),
    R + 14,
    CX,
    CY,
  );
  return (
    <svg className="axis-radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Notas por eixo">
      {rings.map((ring, i) => (
        <polygon key={i} className="ring" points={ring.map((p) => p.join(',')).join(' ')} />
      ))}
      {outer.map(([x, y], i) => (
        <line key={i} className="spoke" x1={CX} y1={CY} x2={x} y2={y} />
      ))}
      <polygon className="shape" points={shape.map((p) => p.join(',')).join(' ')} />
      {shape.map(([x, y], i) => (
        <circle key={i} className="dot" cx={x} cy={y} r={2.5} />
      ))}
      {tip.map(([x, y], i) => (
        <text key={i} x={x} y={y} textAnchor={Math.abs(x - CX) < 4 ? 'middle' : x > CX ? 'start' : 'end'} dominantBaseline="middle">
          <tspan dy={y < CY - 1 ? '-1.2em' : y > CY + 1 ? '0' : '-0.6em'}>{labels[i]}</tspan>
          <tspan x={x} dy="1.2em" className="val">
            {values[i] ?? '—'}
          </tspan>
        </text>
      ))}
    </svg>
  );
}
