import { describe, expect, it } from 'vitest';
import {
  buildPath,
  findJumps,
  jumpOverlays,
  labelPoint,
  orientationOf,
  routeAll,
  routeOrthogonal,
  simplify,
  type Point,
  type RouteRequest,
} from './orthogonalRouting.ts';

const isOrthogonal = (pts: Point[]) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1e-9 || Math.abs(p.y - pts[i - 1].y) < 1e-9);

describe('orientationOf', () => {
  it('horizontal quando dx domina (empate também)', () => {
    expect(orientationOf({ x: 0, y: 0 }, { x: 10, y: 3 })).toBe('h');
    expect(orientationOf({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe('h');
    expect(orientationOf({ x: 0, y: 0 }, { x: 2, y: -9 })).toBe('v');
  });
});

describe('routeOrthogonal', () => {
  it('rótulo abaixo do nó: quem chega por baixo para antes do texto; quem sai por baixo começa depois dele', () => {
    // b acima de a: chega pela base de b, abaixo do rótulo de b (rb + lb); sai pelo topo de a (sem rótulo no caminho).
    expect(routeOrthogonal({ x: 0, y: 200 }, { x: 0, y: 0 }, 10, 10, { belowA: 30, belowB: 30 })).toEqual([
      { x: 0, y: 190 },
      { x: 0, y: 40 },
    ]);
    // a acima de b: sai pela base de a depois do rótulo (ra + la); chega pelo topo de b.
    expect(routeOrthogonal({ x: 0, y: 0 }, { x: 0, y: 200 }, 10, 10, { belowA: 30, belowB: 30 })).toEqual([
      { x: 0, y: 40 },
      { x: 0, y: 190 },
    ]);
    // Horizontal não muda.
    expect(routeOrthogonal({ x: 0, y: 0 }, { x: 200, y: 0 }, 10, 10, { belowA: 30, belowB: 30 })).toEqual([
      { x: 10, y: 0 },
      { x: 190, y: 0 },
    ]);
  });

  it('H-V-H saindo pela borda do círculo', () => {
    expect(routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 40 }, 5, 10)).toEqual([
      { x: 5, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 90, y: 40 },
    ]);
  });

  it('para a esquerda e alinhado vira uma reta', () => {
    expect(routeOrthogonal({ x: 100, y: 0 }, { x: 0, y: 0 }, 5, 5)).toEqual([
      { x: 95, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('V-H-V para cima, com portas e canal', () => {
    const pts = routeOrthogonal({ x: 0, y: 100 }, { x: 20, y: 0 }, 5, 5, {
      startPort: 3,
      endPort: -3,
      channel: (v, axis) => (axis === 'y' ? Math.round(v / 30) * 30 : v),
    });
    expect(pts[0]).toEqual({ x: 3, y: 96 });
    expect(pts[1]).toEqual({ x: 3, y: 60 });
    expect(pts[2]).toEqual({ x: 17, y: 60 });
    expect(pts[3]).toEqual({ x: 17, y: 4 });
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('porta maior que o raio sai do centro', () => {
    const pts = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 2, { startPort: 5 });
    expect(pts[0]).toEqual({ x: 0, y: 5 });
  });

  it('mesmo ponto não quebra (sinal 0 vira 1)', () => {
    const pts = routeOrthogonal({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 1);
    expect(pts.length).toBeGreaterThan(0);
  });
});

describe('simplify', () => {
  it('remove repetidos e colineares', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 10, y: 9 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 9 },
    ]);
    expect(simplify([])).toEqual([]);
  });
});

describe('routeAll — rótulos', () => {
  it('repassa a altura dos rótulos de cada ponta', () => {
    const [r] = routeAll([{ source: 1, target: 2, a: { x: 0, y: 200 }, b: { x: 0, y: 0 }, ra: 10, rb: 10, la: 5, lb: 25 }], { portGap: 7, laneGap: 8 });
    expect(r).toEqual([
      { x: 0, y: 190 },
      { x: 0, y: 35 },
    ]);
  });
});

describe('routeAll', () => {
  const req = (source: number, target: number, a: Point, b: Point): RouteRequest => ({ source, target, a, b, ra: 5, rb: 5 });

  it('arestas no mesmo lado recebem portas distintas ordenadas pela outra ponta', () => {
    const routes = routeAll([req(1, 2, { x: 0, y: 0 }, { x: 100, y: -30 }), req(1, 3, { x: 0, y: 0 }, { x: 100, y: 30 })], { portGap: 2, laneGap: 2 });
    expect(routes[0][0].y).toBe(-1);
    expect(routes[1][0].y).toBe(1);
    expect(routes.every(isOrthogonal)).toBe(true);
  });

  it('portas verticais (lados B/T) e gap limitado pelo raio', () => {
    const routes = routeAll(
      [req(1, 2, { x: 0, y: 0 }, { x: -10, y: 100 }), req(1, 3, { x: 0, y: 0 }, { x: 10, y: 100 }), req(4, 1, { x: 0, y: -100 }, { x: 0, y: 0 })],
      { portGap: 100, laneGap: 2 },
    );
    // gap = min(100, 5*1.4/1) = 7
    expect(routes[0][0].x).toBeCloseTo(-3.5);
    expect(routes[1][0].x).toBeCloseTo(3.5);
    expect(routes[2].at(-1)!.y).toBeCloseTo(-5);
  });

  it('segmentos colineares de rotas diferentes são afastados em faixas', () => {
    // Duas rotas com o mesmo trecho vertical no meio (x=50).
    const routes = routeAll([req(1, 2, { x: 0, y: 0 }, { x: 100, y: 100 }), req(3, 4, { x: 0, y: 20 }, { x: 100, y: 80 })], { portGap: 2, laneGap: 4 });
    const midX = routes.map((r) => r[1].x);
    expect(Math.abs(midX[0] - midX[1])).toBe(4);
    expect(routes.every(isOrthogonal)).toBe(true);
  });

  it('bundling: arestas do mesmo nó/lado dividem porta e tronco', () => {
    const targets = [-30, -10, 10, 30];
    const requests = targets.map((y, i) => req(1, 10 + i, { x: 0, y: 0 }, { x: 100, y }));
    const bundled = routeAll(requests, { portGap: 2, laneGap: 3, bundle: true });
    expect(new Set(bundled.map((r) => r[0].y))).toEqual(new Set([0]));
    // Primeira metade compartilha a faixa do tronco (mesma origem).
    expect(new Set(bundled.map((r) => r[1].x)).size).toBe(1);
    const unbundled = routeAll(requests, { portGap: 2, laneGap: 3 });
    expect(new Set(unbundled.map((r) => r[0].y)).size).toBe(4);
    // Abaixo do limiar, continua usando portas.
    const few = routeAll(requests.slice(0, 2), { portGap: 2, laneGap: 3, bundle: true, bundleThreshold: 3 });
    expect(few[0][0].y).not.toBe(few[1][0].y);
  });

  it('bundling: tronco compartilhado divide a faixa com outro nó no mesmo canal', () => {
    const requests = [-30, -10, 10, 30].map((y, i) => req(1, 10 + i, { x: 0, y: 0 }, { x: 100, y }));
    requests.push(req(9, 30, { x: -50, y: 0 }, { x: -200, y: 0 }));
    const routes = routeAll(requests, { portGap: 2, laneGap: 3, bundle: true });
    // As quatro saídas do nó 1 ficam juntas na mesma faixa.
    expect(new Set(routes.slice(0, 4).map((r) => r[0].y)).size).toBe(1);
    expect(routes.every(isOrthogonal)).toBe(true);
  });

  it('bundling com destinos diferentes no mesmo canal ainda separa as faixas', () => {
    const requests = [req(1, 2, { x: 0, y: 0 }, { x: 100, y: 100 }), req(3, 4, { x: 0, y: 20 }, { x: 100, y: 80 })];
    const routes = routeAll(requests, { portGap: 2, laneGap: 4, bundle: true });
    expect(routes[0][1].x).not.toBe(routes[1][1].x);
  });
});

describe('findJumps', () => {
  it('só o horizontal salta sobre verticais de outras rotas', () => {
    const h: Point[] = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ];
    const v: Point[] = [
      { x: 40, y: 0 },
      { x: 40, y: 100 },
    ];
    const v2: Point[] = [
      { x: 41, y: 0 },
      { x: 41, y: 100 },
    ];
    const near: Point[] = [
      { x: 99, y: 0 },
      { x: 99, y: 100 },
    ];
    const jumps = findJumps([h, v, v2, near], 2);
    expect(jumps[0].get(0)).toEqual([40]);
    expect(jumps[1].size).toBe(0);
    expect(findJumps([h], 1)[0].size).toBe(0);
  });
});

describe('buildPath', () => {
  it('menos de 2 pontos: vazio', () => {
    expect(buildPath([{ x: 0, y: 0 }])).toBe('');
  });

  it('reta simples', () => {
    expect(
      buildPath([
        { x: 0, y: 0 },
        { x: 10.04, y: 0 },
      ]),
    ).toBe('M0,0 L10,0');
  });

  it('cantos arredondados com curva Q', () => {
    expect(
      buildPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        new Map(),
        8,
      ),
    ).toBe('M0,0 L92,0 Q100,0 100,8 L100,100');
  });

  it('saltos para a direita e para a esquerda', () => {
    const right = buildPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      new Map([[0, [60, 30]]]),
      8,
      5,
    );
    expect(right).toBe('M0,0 L25,0 A5,5 0 0 1 35,0 L55,0 A5,5 0 0 1 65,0 L100,0');
    const left = buildPath(
      [
        { x: 100, y: 0 },
        { x: 0, y: 0 },
      ],
      new Map([[0, [30, 60]]]),
    );
    expect(left).toBe('M100,0 L65,0 A5,5 0 0 0 55,0 L35,0 A5,5 0 0 0 25,0 L0,0');
  });

  it('ignora saltos em segmento vertical e cantos de raio zero', () => {
    const d = buildPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ],
      new Map([[1, [10]]]),
    );
    expect(d).toBe('M0,0 L0,0 L0,50');
  });
});

describe('jumpOverlays', () => {
  it('gera pontes só para segmentos horizontais existentes', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const out = jumpOverlays(
      pts,
      new Map([
        [0, [40]],
        [1, [10]],
        [2, [60]],
        [9, [1]],
      ]),
      5,
      3,
    );
    expect(out).toEqual(['M32,0 L35,0 A5,5 0 0 1 45,0 L48,0', 'M68,50 L65,50 A5,5 0 0 0 55,50 L52,50']);
    expect(jumpOverlays(pts)).toEqual([]);
  });

  it('segmento horizontal de comprimento zero usa direção positiva', () => {
    const out = jumpOverlays(
      [
        { x: 10, y: 0 },
        { x: 10, y: 0 },
      ],
      new Map([[0, [10]]]),
    );
    expect(out[0]).toContain('A5,5 0 0 1');
  });
});

describe('labelPoint', () => {
  it('meio do segmento mais longo', () => {
    expect(
      labelPoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 100 },
      ]),
    ).toEqual({ x: 10, y: 50 });
  });

  it('um ponto só', () => {
    expect(labelPoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});
