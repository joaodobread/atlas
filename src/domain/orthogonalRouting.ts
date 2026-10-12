// Geometria pura para arestas ortogonais (ângulos retos) com cantos arredondados e "saltos" nos cruzamentos.

export interface Point {
  x: number;
  y: number;
}

const EPS = 0.5;

export type Orientation = 'h' | 'v';

/** H-V-H quando a distância horizontal domina, senão V-H-V. */
export const orientationOf = (a: Point, b: Point): Orientation =>
  // Tolerância relativa: empates não podem alternar com o zoom por erro de ponto flutuante.
  Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) * (1 - 1e-6) ? 'h' : 'v';

export interface RouteOptions {
  /** Espaço ocupado abaixo de cada nó (rótulos): quem sai/chega por baixo começa/termina depois dele, sem riscar o texto. */
  belowA?: number;
  belowB?: number;
  /** Deslocamento do ponto de saída/chegada ao longo do lado do nó (portas). */
  startPort?: number;
  endPort?: number;
  /** Ajusta a coordenada do trecho do meio (ex.: encaixar no canal entre linhas da grade). */
  channel?: (value: number, axis: 'x' | 'y') => number;
}

/** Rota em "cotovelo" de `a` até `b` (centros dos nós), saindo/entrando pela borda dos círculos. */
export function routeOrthogonal(a: Point, b: Point, ra: number, rb: number, opts: RouteOptions = {}): Point[] {
  const sp = opts.startPort ?? 0;
  const ep = opts.endPort ?? 0;
  const channel = opts.channel ?? ((v: number) => v);
  let pts: Point[];
  if (orientationOf(a, b) === 'h') {
    const s = Math.sign(b.x - a.x) || 1;
    const midX = channel((a.x + b.x) / 2, 'x');
    pts = [
      { x: a.x + s * edgeOf(ra, sp), y: a.y + sp },
      { x: midX, y: a.y + sp },
      { x: midX, y: b.y + ep },
      { x: b.x - s * edgeOf(rb, ep), y: b.y + ep },
    ];
  } else {
    const s = Math.sign(b.y - a.y) || 1;
    // Descendo, `a` sai pela base (abaixo do rótulo); subindo, `b` é que recebe pela base.
    const startY = a.y + s * (edgeOf(ra, sp) + (s > 0 ? (opts.belowA ?? 0) : 0));
    const endY = b.y - s * (edgeOf(rb, ep) + (s < 0 ? (opts.belowB ?? 0) : 0));
    const midY = channel((startY + endY) / 2, 'y');
    pts = [
      { x: a.x + sp, y: startY },
      { x: a.x + sp, y: midY },
      { x: b.x + ep, y: midY },
      { x: b.x + ep, y: endY },
    ];
  }
  return simplify(pts);
}

export interface RouteRequest {
  source: number;
  target: number;
  a: Point;
  b: Point;
  ra: number;
  rb: number;
  /** Altura do rótulo abaixo de cada ponta (0 = sem rótulo embaixo). */
  la?: number;
  lb?: number;
}

/**
 * Roteia várias arestas evitando sobreposição:
 * - portas: arestas no mesmo lado de um nó saem/chegam em pontos diferentes, ordenadas pela outra ponta;
 * - faixas: segmentos colineares que se sobrepõem são afastados em paralelo.
 */
export function routeAll(
  requests: readonly RouteRequest[],
  opts: {
    portGap: number;
    laneGap: number;
    channel?: RouteOptions['channel'];
    /** Agrupa (bundling): arestas do mesmo nó/lado dividem porta e tronco em vez de trilhos paralelos. */
    bundle?: boolean;
    /** A partir de quantas arestas no mesmo lado elas passam a dividir a porta. */
    bundleThreshold?: number;
  },
): Point[][] {
  // Portas por (nó, lado).
  const sides = new Map<string, Array<{ req: number; end: 'start' | 'end'; key: number; r: number }>>();
  requests.forEach((q, i) => {
    const o = orientationOf(q.a, q.b);
    const sideA = o === 'h' ? (q.b.x >= q.a.x ? 'R' : 'L') : q.b.y >= q.a.y ? 'B' : 'T';
    const sideB = o === 'h' ? (q.b.x >= q.a.x ? 'L' : 'R') : q.b.y >= q.a.y ? 'T' : 'B';
    // Ordena pela coordenada perpendicular da outra ponta, para as linhas não se cruzarem na saída.
    const perpA = o === 'h' ? q.b.y : q.b.x;
    const perpB = o === 'h' ? q.a.y : q.a.x;
    push(sides, `${q.source}:${sideA}`, { req: i, end: 'start', key: perpA, r: q.ra });
    push(sides, `${q.target}:${sideB}`, { req: i, end: 'end', key: perpB, r: q.rb });
  });
  const ports = requests.map(() => ({ start: 0, end: 0 }));
  for (const list of sides.values()) {
    if (list.length < 2) continue;
    if (opts.bundle && list.length >= (opts.bundleThreshold ?? 4)) continue; // todos saem pela mesma porta
    list.sort((x, y) => x.key - y.key);
    const gap = Math.min(opts.portGap, (list[0]!.r * 1.4) / (list.length - 1));
    list.forEach((p, idx) => (ports[p.req]![p.end] = (idx - (list.length - 1) / 2) * gap));
  }

  const routes = requests.map((q, i) =>
    routeOrthogonal(q.a, q.b, q.ra, q.rb, { startPort: ports[i]!.start, endPort: ports[i]!.end, channel: opts.channel, belowA: q.la, belowB: q.lb }),
  );
  // Trechos do mesmo nó ficam na mesma faixa (tronco); os de nós diferentes, em faixas paralelas.
  separateLanes(routes, opts.laneGap, opts.bundle ? (ri, i, len) => (i < len / 2 ? `s${requests[ri]!.source}` : `t${requests[ri]!.target}`) : undefined);
  return routes;
}

/**
 * Afasta em paralelo segmentos colineares que se sobrepõem (de rotas diferentes), em qualquer posição da rota.
 * Mover um segmento horizontal só altera o y dos seus dois pontos (e um vertical, só o x),
 * então as rotas continuam ortogonais.
 */
function separateLanes(routes: Point[][], gap: number, bundleKey?: (route: number, segment: number, segments: number) => string): void {
  type Seg = { route: number; i: number; axis: 'x' | 'y'; coord: number; lo: number; hi: number; key: string };
  const groups = new Map<string, Seg[]>();
  routes.forEach((r, ri) => {
    for (let i = 0; i < r.length - 1; i++) {
      const p = r[i]!;
      const q = r[i + 1]!;
      const key = bundleKey ? bundleKey(ri, i, r.length - 1) : `r${ri}`;
      const seg: Seg | null = isVertical(p, q)
        ? { route: ri, i, axis: 'x', coord: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y), key }
        : isHorizontal(p, q)
          ? { route: ri, i, axis: 'y', coord: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x), key }
          : null;
      if (seg) push(groups, `${seg.axis}:${Math.round(seg.coord / 2)}`, seg);
    }
  });
  for (const list of groups.values()) {
    if (new Set(list.map((s) => s.key)).size < 2) continue;
    list.sort((m, n) => m.lo - n.lo);
    // Coloração gulosa de intervalos; segmentos com a mesma chave (mesmo tronco) dividem a faixa.
    const laneEnds: number[] = [];
    const laneOfKey = new Map<string, number>();
    const lanes = list.map((m) => {
      const shared = laneOfKey.get(m.key);
      if (shared != null) {
        laneEnds[shared] = Math.max(laneEnds[shared]!, m.hi);
        return shared;
      }
      let lane = laneEnds.findIndex((end) => end < m.lo - gap);
      if (lane < 0) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = m.hi;
      laneOfKey.set(m.key, lane);
      return lane;
    });
    const count = laneEnds.length;
    if (count < 2) continue;
    list.forEach((m, k) => {
      const delta = (lanes[k]! - (count - 1) / 2) * gap;
      const route = routes[m.route]!;
      route[m.i]![m.axis] = m.coord + delta;
      route[m.i + 1]![m.axis] = m.coord + delta;
    });
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Distância do centro até a borda do círculo, na linha deslocada por `offset`. */
function edgeOf(r: number, offset: number): number {
  return Math.sqrt(Math.max(r * r - offset * offset, 0));
}

/** Remove pontos repetidos e colineares. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    const prev = out[out.length - 2];
    if (
      last &&
      prev &&
      ((Math.abs(prev.x - last.x) < EPS && Math.abs(last.x - p.x) < EPS) || (Math.abs(prev.y - last.y) < EPS && Math.abs(last.y - p.y) < EPS))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

const isHorizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < EPS;
const isVertical = (p: Point, q: Point) => Math.abs(p.x - q.x) < EPS;

/**
 * Pontos de salto: onde um segmento horizontal de uma rota cruza um vertical de outra.
 * Convenção: só o horizontal salta, então cada cruzamento é desenhado uma única vez.
 * @returns para cada rota, um mapa índiceDoSegmento -> lista de x dos saltos.
 */
export function findJumps(routes: Point[][], margin: number): Array<Map<number, number[]>> {
  const verticals: Array<{ route: number; x: number; y1: number; y2: number }> = [];
  routes.forEach((r, ri) => {
    for (let i = 0; i < r.length - 1; i++) {
      const p = r[i]!;
      const q = r[i + 1]!;
      if (isVertical(p, q)) verticals.push({ route: ri, x: p.x, y1: Math.min(p.y, q.y), y2: Math.max(p.y, q.y) });
    }
  });

  // Ordenadas por x: cada horizontal só olha as verticais dentro do seu intervalo (busca binária), não todas.
  verticals.sort((a, b) => a.x - b.x);
  const firstAbove = (x: number) => {
    let lo = 0;
    let hi = verticals.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (verticals[mid]!.x <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  return routes.map((r, ri) => {
    const jumps = new Map<number, number[]>();
    for (let i = 0; i < r.length - 1; i++) {
      const p = r[i]!;
      const q = r[i + 1]!;
      if (!isHorizontal(p, q)) continue;
      const x1 = Math.min(p.x, q.x) + margin;
      const x2 = Math.max(p.x, q.x) - margin;
      const xs: number[] = [];
      for (let k = firstAbove(x1); k < verticals.length && verticals[k]!.x < x2; k++) {
        const v = verticals[k]!;
        if (v.route !== ri && p.y > v.y1 + margin && p.y < v.y2 - margin) xs.push(v.x);
      }
      if (xs.length) jumps.set(i, dedupe(xs, margin));
    }
    return jumps;
  });
}

/** Saltos muito próximos viram um só. */
function dedupe(xs: number[], minGap: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1]! >= minGap);
}

/**
 * Converte a polilinha em `d` de SVG, com cantos arredondados (raio `corner`)
 * e semicírculos de raio `jump` nos saltos dos segmentos horizontais.
 */
export function buildPath(pts: Point[], jumps: Map<number, number[]> = new Map(), corner = 8, jump = 5): string {
  if (pts.length < 2) return '';
  const len = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  const toward = (p: Point, q: Point, d: number): Point => {
    const l = len(p, q) || 1;
    return { x: p.x + ((q.x - p.x) / l) * d, y: p.y + ((q.y - p.y) / l) * d };
  };
  const fmt = (p: Point) => `${round(p.x)},${round(p.y)}`;

  let d = `M${fmt(pts[0]!)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const next = pts[i + 2];
    const r = next ? Math.min(corner, len(p, q) / 2, len(q, next) / 2) : 0;
    const end = next ? toward(q, p, r) : q;

    const xs = jumps.get(i);
    if (xs && isHorizontal(p, q)) {
      const dir = Math.sign(q.x - p.x) || 1;
      const ordered = [...xs].sort((a, b) => (a - b) * dir);
      for (const x of ordered) {
        // Semicírculo por cima: sentido horário indo para a direita, anti-horário para a esquerda.
        d += ` L${fmt({ x: x - dir * jump, y: p.y })} A${jump},${jump} 0 0 ${dir > 0 ? 1 : 0} ${fmt({ x: x + dir * jump, y: p.y })}`;
      }
    }
    d += ` L${fmt(end)}`;
    if (next && r > 0) d += ` Q${fmt(q)} ${fmt(toward(q, next, r))}`;
  }
  return d;
}

/**
 * Pedaços curtos de path só com as "pontes" dos saltos, para desenhar numa camada acima de todas as linhas
 * (assim a linha que salta fica por cima da que é cruzada, independente da ordem de desenho).
 */
export function jumpOverlays(pts: Point[], jumps: Map<number, number[]> = new Map(), jump = 5, pad = 3): string[] {
  const out: string[] = [];
  for (const [i, xs] of jumps) {
    const p = pts[i];
    const q = pts[i + 1];
    if (!p || !q || !isHorizontal(p, q)) continue;
    const dir = Math.sign(q.x - p.x) || 1;
    for (const x of xs) {
      const y = round(p.y);
      out.push(
        `M${round(x - dir * (jump + pad))},${y} L${round(x - dir * jump)},${y} ` +
          `A${jump},${jump} 0 0 ${dir > 0 ? 1 : 0} ${round(x + dir * jump)},${y} L${round(x + dir * (jump + pad))},${y}`,
      );
    }
  }
  return out;
}

/** Ponto central do segmento mais longo (para o rótulo da aresta). */
export function labelPoint(pts: Point[]): Point {
  let best = { i: 0, l: -1 };
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    if (l > best.l) best = { i, l };
  }
  const p = pts[best.i]!;
  const q = pts[best.i + 1] ?? p;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

const round = (n: number) => Math.round(n * 10) / 10;
