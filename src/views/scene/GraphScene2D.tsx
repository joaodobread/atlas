import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { VisibleEdge } from '../../domain/GraphIndex.ts';
import { snapToGrid, type GridSpec } from '../../domain/gridSnap.ts';
import type { GroupResult } from '../../domain/GroupLayout.ts';
import { buildPath, findJumps, jumpOverlays, labelPoint, routeAll, routeOrthogonal, type Point } from '../../domain/orthogonalRouting.ts';
import { useCanvasMenuViewModel } from '../../viewmodels/useCanvasMenuViewModel.ts';
import { useGraphSceneViewModel, type GraphSceneViewModel, type SceneNode } from '../../viewmodels/useGraphSceneViewModel.ts';
import { CanvasMenu } from './CanvasMenu.tsx';
import { NodeIcon } from '../icons/NodeIcon.tsx';

interface View {
  /** Deslocamento em px e escala (px por unidade do layout). */
  x: number;
  y: number;
  k: number;
}

type Gesture =
  | { type: 'pan'; startX: number; startY: number; view: View; moved: boolean }
  | { type: 'node'; id: number; startX: number; startY: number; moved: boolean };

const MIN_K = 0.6;
const MAX_K = 80;
const CLICK_TOLERANCE = 4;
/** Zoom mínimo ao enquadrar: abaixo disso os nós se sobrepõem; melhor exigir pan. */
const MIN_FIT_K = 7;
/** Vista usada na exportação (nós e textos no tamanho natural; a origem não importa, o recorte é pelo conteúdo). */
const EXPORT_VIEW: View = { x: 0, y: 0, k: 12 };
/** Acima disso, sem saltos nos cruzamentos (custo e ruído). */
const JUMP_EDGE_LIMIT = 250;
/** Acima disso, só as conexões em destaque têm o pulso animado. */
const PULSE_EDGE_LIMIT = 150;
/** Nível de detalhe (Infra/Camadas): escala mínima dos nós para rótulos e ícones; fonte mínima (px) dos títulos das caixas. */
const LOD = { labels: 0.45, icons: 0.18, titleFontPx: 5 };
/** Do círculo até o fim do subtítulo (rótulo em r+15, subtítulo em r+28, ~11px de altura) em unidades do nó. */
const LABEL_BELOW = 32;
/** Grade do ímã, em unidades do layout (mais alta que larga: rótulos ficam embaixo). */
const GRID: GridSpec = { cellX: 7, cellY: 6 };
const CORNER = 10;
const JUMP = 5;
/** Distância entre portas no mesmo lado de um nó e entre faixas paralelas, em px. */
const PORT_GAP = 8;
const LANE_GAP = 7;

/** Raio do nó em px: constante na tela, independente do zoom. */
const pxRadius = (n: SceneNode) => 12 + n.r * 9;

interface EdgeGeometry {
  edge: VisibleEdge;
  route: Point[];
  d: string;
  /** Pontes dos saltos, desenhadas acima de todas as linhas. */
  bridges: string[];
  label: Point;
}

export function GraphScene2D() {
  const vm = useGraphSceneViewModel(2);
  const menu = useCanvasMenuViewModel();
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewState, setView] = useState<View>({ x: 0, y: 0, k: 14 });
  /** Exportando: a cena é desenhada num zoom fixo de leitura (setas, linhas e textos têm tamanho em px). */
  const [exporting, setExporting] = useState<'png' | 'svg' | null>(null);
  const view = exporting ? EXPORT_VIEW : viewState;
  const [frame, setFrame] = useState(0);
  /** Nó sob o mouse: destaca as conexões dele (só visual). */
  const [hoverId, setHoverId] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pendingFit = useRef<'auto' | 'now' | null>('auto');
  const waited = useRef(0);
  /** O usuário mexeu na vista (zoom/pan) desde o último enquadramento: não reenquadra sozinho. */
  const userMoved = useRef(false);
  const draggingId = useRef<number | null>(null);
  const magnetRef = useRef(vm.magnet);
  magnetRef.current = vm.magnet;
  const layout = vm.layout;

  useEffect(() => {
    if (vm.fitRequest > 0) pendingFit.current = 'now';
  }, [vm.fitRequest]);

  // Exportar (pedido pela barra da cena): o diagrama inteiro, num zoom fixo de leitura (setas, linhas e textos
  // têm tamanho em px; exportar com a tela afastada deixaria tudo desproporcional). Depois volta a vista do usuário.
  const exportSeq = useRef(vm.exportRequest?.seq ?? 0);
  useEffect(() => {
    const req = vm.exportRequest;
    if (!req || req.seq === exportSeq.current) return;
    exportSeq.current = req.seq;
    setExporting(req.format);
  }, [vm.exportRequest]);
  useEffect(() => {
    if (!exporting || !svgRef.current) return;
    const svg = svgRef.current;
    // O DOM já está no zoom de exportação (este efeito roda depois do commit).
    void vm.exportDiagram(svg, exporting).finally(() => setExporting(null));
  }, [exporting]);

  const layeredRef = useRef(vm.layered);
  layeredRef.current = vm.layered;
  const groupedRef = useRef(vm.grouped);
  groupedRef.current = vm.grouped;

  /** Posições exibidas (unidades do layout): camadas (fixas + ajustes manuais) ou forças (com ímã opcional). */
  const worldPositions = (): Map<number, Point> => {
    const grouped = groupedRef.current;
    if (grouped) return new Map(grouped.positions);
    const layered = layeredRef.current;
    if (layered) {
      const out = new Map(layered.positions);
      for (const [id, p] of vm.manualPositions) if (out.has(id)) out.set(id, p);
      return out;
    }
    const raw = layout.all();
    if (!magnetRef.current) return new Map(raw.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    return snapToGrid(
      raw.map((n) => ({
        id: n.id,
        x: n.x ?? 0,
        y: n.y ?? 0,
        // Fixados mantêm a célula; o arrastado escolhe por último (não empurra ninguém).
        priority: n.id === draggingId.current ? -1 : layout.isPinned(n.id) ? 1 : 0,
      })),
      GRID,
    );
  };

  // Loop de simulação: só re-renderiza enquanto algo se move.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const moving = layout.tick();
      const fit = pendingFit.current;
      // Infra/Camadas não usam a simulação: basta haver posições para enquadrar.
      if (fit && (groupedRef.current || layeredRef.current || layout.all().length) && svgRef.current) {
        waited.current++;
        if (fit === 'now' || !layout.isSettling() || waited.current > 180) {
          setView(fitView(svgRef.current, fitPoints(worldPositions(), groupedRef.current), fitMode(layeredRef.current, groupedRef.current)));
          // Se ainda está se acomodando, enquadra de novo depois.
          pendingFit.current = layout.isSettling() ? 'auto' : null;
          waited.current = 0;
          userMoved.current = false;
        }
      }
      if (moving) setFrame((f) => (f + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout]); // worldPositions só lê refs/layout

  // Área mudou (painel lateral abriu/fechou, janela redimensionada): sem ajuste manual, reenquadra;
  // com ajuste, mantém o mesmo ponto no centro.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    let last = svg.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const now = svg.getBoundingClientRect();
      const dw = now.width - last.width;
      const dh = now.height - last.height;
      last = now;
      if (Math.abs(dw) < 1 && Math.abs(dh) < 1) return;
      if (!userMoved.current) pendingFit.current = 'now';
      else setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Zoom com a roda, centrado no cursor (listener nativo para poder usar preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), MIN_K, MAX_K);
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- Geometria do frame ----------
  const world = useMemo(worldPositions, [frame, vm.magnet, vm.nodes, vm.layoutVersion, vm.layered, vm.grouped]); // worldPositions lê o layout mutável
  // No modo camadas tudo escala com o zoom (como um diagrama): nada se sobrepõe.
  const layeredMode = vm.layered != null;
  // Infra: caixas e nós são um desenho só, escalam juntos com o zoom (os nós cabem nas caixas em qualquer zoom).
  const groupedMode = vm.grouped != null;
  const diagramMode = layeredMode || groupedMode;
  const nodeScale = groupedMode ? clamp(view.k / 12, 0.05, 4) : layeredMode ? clamp(view.k / 12, 0.3, 1.6) : 1;
  const containers = useMemo(() => new Set(vm.grouped?.boxes.map((b) => b.id)), [vm.grouped]);
  const byId = useMemo(() => new Map(vm.nodes.map((n) => [n.id, n])), [vm.nodes]);
  // Nível de detalhe: afastado, rótulos (e depois ícones) somem — ilegíveis e caros de desenhar.
  const showLabels = !diagramMode || nodeScale >= LOD.labels;
  const showIcons = !diagramMode || nodeScale >= LOD.icons;
  const showTitleText = 1.45 * view.k >= LOD.titleFontPx;

  // Geometria em pixels de tela: recalcula só quando a vista, as posições ou as conexões mudam (não no hover).
  /** Caixas recebem as conexões no ícone do título. */
  const radius = (n: SceneNode) => (containers.has(n.id) ? 9 : pxRadius(n)) * nodeScale;
  /** Altura dos rótulos (nome + tipo) abaixo do nó, em px de tela: as linhas que chegam por baixo param antes deles. */
  const labelBelow = (n: SceneNode) => (showLabels && !layeredMode && !containers.has(n.id) ? LABEL_BELOW * nodeScale : 0);
  const { screen, edgeGeometry } = useMemo(() => {
    const screen = new Map<number, Point>();
    for (const [id, p] of world) screen.set(id, { x: p.x * view.k + view.x, y: p.y * view.k + view.y });
    // Com ímã, os trechos do meio correm nos canais entre as linhas/colunas da grade (não cortam nós).
    const channel = vm.magnet
      ? (v: number, axis: 'x' | 'y') => {
          const cell = (axis === 'x' ? GRID.cellX : GRID.cellY) * view.k;
          const origin = axis === 'x' ? view.x : view.y;
          // Em células: o +1e-6 evita que um meio exato (ex.: 2.5) caia ora num canal, ora no outro conforme o zoom.
          return origin + (Math.floor((v - origin) / cell + 1e-6) + 0.5) * cell;
        }
      : undefined;
    const requests = vm.edges.flatMap((e) => {
      const a = screen.get(e.source);
      const b = screen.get(e.target);
      const sn = byId.get(e.source);
      const tn = byId.get(e.target);
      return a && b && sn && tn
        ? [{ edge: e, source: e.source, target: e.target, a, b, ra: radius(sn) + 2, rb: radius(tn) + 3, la: labelBelow(sn), lb: labelBelow(tn) }]
        : [];
    });
    const routes = routeAll(requests, { portGap: PORT_GAP, laneGap: LANE_GAP, channel, bundle: diagramMode, bundleThreshold: 4 });
    const edgeGeometry: EdgeGeometry[] = requests
      .map((q, i) => ({ edge: q.edge, route: routes[i]!, d: '', bridges: [] as string[], label: labelPoint(routes[i]!) }))
      .filter((g) => g.route.length >= 2);
    // Saltos nos cruzamentos só em diagramas menores: em grafos grandes viram milhares de arcos (ruído e DOM pesado).
    const jumps =
      edgeGeometry.length <= JUMP_EDGE_LIMIT
        ? findJumps(
            edgeGeometry.map((g) => g.route),
            CORNER + JUMP,
          )
        : [];
    edgeGeometry.forEach((g, i) => {
      g.d = buildPath(g.route, jumps[i], CORNER, JUMP);
      g.bridges = jumpOverlays(g.route, jumps[i], JUMP);
    });
    return { screen, edgeGeometry };
  }, [world, view.x, view.y, view.k, vm.edges, vm.magnet, byId, containers, nodeScale, diagramMode, showLabels, layeredMode]);

  // Hover: o nó e seus vizinhos diretos ficam em destaque.
  const hoverNeighbors = hoverId != null && !gesture.current ? new Set<number>([hoverId]) : null;
  if (hoverNeighbors) {
    for (const e of vm.edges) {
      if (e.source !== hoverId && e.target !== hoverId) continue;
      hoverNeighbors.add(e.source);
      hoverNeighbors.add(e.target);
    }
  }
  const edgeState = (e: VisibleEdge): 'hi' | 'normal' | 'dim' => {
    if (hoverId != null && hoverNeighbors) return e.source === hoverId || e.target === hoverId ? 'hi' : 'dim';
    if (!vm.highlight) return 'normal';
    return vm.isEdgeHighlighted(e) ? 'hi' : 'dim';
  };

  // ---------- Interação ----------
  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // Só o botão principal arrasta/seleciona; o direito abre o menu (onContextMenu).
    if (e.button !== 0) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    gesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, view, moved: false };
  };

  const onNodeDown = (id: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    gesture.current = { type: 'node', id, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) return;
    g.moved = true;
    if (g.type === 'pan') {
      userMoved.current = true;
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else {
      draggingId.current = g.id;
      const rect = svgRef.current!.getBoundingClientRect();
      const p = { x: (e.clientX - rect.left - view.x) / view.k, y: (e.clientY - rect.top - view.y) / view.k };
      if (groupedMode) return; // posições fixas: a caixa define o lugar
      if (layeredMode) vm.manualPositions.set(g.id, p);
      else layout.pin(g.id, p);
      setFrame((f) => f + 1);
    }
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    draggingId.current = null;
    if (!g) return;
    if (g.type === 'pan' && !g.moved) vm.clearSelection();
    if (g.type === 'node') {
      if (g.moved) {
        // Fica onde foi solto (na célula do ímã, se ligado). "Reorganizar" solta todos.
        const p = world.get(g.id);
        if (p && !layeredMode) layout.pin(g.id, p);
      } else vm.activateNode(g.id);
    }
  };

  /**
   * Clique direito: cria um nó. Sobre um nó (ou título de caixa), como filho dele; numa área de caixa do modo Infra,
   * dentro da caixa mais funda sob o cursor; no vazio, na raiz.
   */
  const onContextMenu = (e: ReactMouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!menu.canCreate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = (e.target as Element).closest('[data-node-id]');
    let parentId = hit ? Number(hit.getAttribute('data-node-id')) : null;
    if (parentId == null && vm.grouped) {
      const wx = (at.x - view.x) / view.k;
      const wy = (at.y - view.y) / view.k;
      const box = vm.grouped.boxes.filter((b) => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h).sort((a, b) => b.depth - a.depth)[0];
      parentId = box?.id ?? null;
    }
    menu.open(at, parentId);
  };

  return (
    <div className="scene-2d-wrap">
      <svg
        ref={svgRef}
        className="scene-2d"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={onContextMenu}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3a4766" />
          </marker>
          <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#8ab4ff" />
          </marker>
          {/* Grade alinhada ao mundo: os pontos são as células do ímã. */}
          <pattern
            id="grid"
            width={GRID.cellX * view.k}
            height={GRID.cellY * view.k}
            patternUnits="userSpaceOnUse"
            x={view.x - (GRID.cellX * view.k) / 2}
            y={view.y - (GRID.cellY * view.k) / 2}
          >
            <circle cx={(GRID.cellX * view.k) / 2} cy={(GRID.cellY * view.k) / 2} r={vm.magnet ? 1.6 : 1} fill={vm.magnet ? '#222c40' : '#161c28'} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" data-export="skip" />

        {vm.grouped && (
          <g className="group-boxes">
            {vm.grouped.boxes.map((b) => {
              const n = byId.get(b.id);
              if (!n) return null;
              return (
                <g key={b.id} className={`group-box depth-${Math.min(b.depth, 4)}${vm.selectedNodeId === n.id ? ' selected' : ''}`}>
                  <rect
                    x={b.x * view.k + view.x}
                    y={b.y * view.k + view.y}
                    width={b.w * view.k}
                    height={b.h * view.k}
                    rx={0.8 * view.k}
                    stroke={n.color}
                    fill={n.color}
                    className="frame"
                  />
                </g>
              );
            })}
          </g>
        )}

        {vm.layered && (
          <g className="layer-titles">
            {vm.layered.columns.map((c) => (
              <text key={c.title} x={c.x * view.k + view.x - 20 * nodeScale} y={c.top * view.k + view.y} style={{ fontSize: 13 * nodeScale }}>
                {c.title.toUpperCase()}
              </text>
            ))}
          </g>
        )}

        <g className="tree-links">
          {!groupedMode &&
            vm.nodes.map((n) => {
              if (n.parentId == null) return null;
              const a = screen.get(n.parentId);
              const b = screen.get(n.id);
              const pn = byId.get(n.parentId);
              if (!a || !b || !pn) return null;
              return <path key={n.id} d={buildPath(routeOrthogonal(a, b, radius(pn), radius(n)), undefined, CORNER)} />;
            })}
        </g>

        {/* Destacadas por último: ficam por cima das demais. */}
        {[...edgeGeometry]
          .sort((a, b) => Number(edgeState(a.edge) === 'hi') - Number(edgeState(b.edge) === 'hi'))
          .map((g) => (
            <Edge2D
              key={g.edge.key}
              geometry={g}
              vm={vm}
              state={edgeState(g.edge)}
              // Pulso animado em todas só em grafos pequenos (muitas animações SMIL travam a página).
              showPulse={edgeState(g.edge) === 'hi' || (!diagramMode && edgeGeometry.length <= PULSE_EDGE_LIMIT)}
            />
          ))}

        {/* Pontes dos saltos por cima de todas as linhas. */}
        <g className="edge-bridges">
          {edgeGeometry.flatMap((g) =>
            g.bridges.map((d, i) => (
              <g key={`${g.edge.key}:${i}`} className={edgeState(g.edge)}>
                <path d={d} className="halo" />
                <path d={d} className="line" />
              </g>
            )),
          )}
        </g>

        {/* Títulos das caixas por cima das linhas (com fundo opaco) para continuarem legíveis. */}
        {vm.grouped && (
          <g className="group-titles">
            {vm.grouped.boxes.map((b) => {
              const n = byId.get(b.id);
              if (!n) return null;
              const x = b.x * view.k + view.x;
              const y = b.y * view.k + view.y;
              const font = 1.45 * view.k;
              const icon = 2 * view.k;
              const width = b.w * view.k - 1.8 * view.k;
              return (
                <g
                  key={b.id}
                  data-node-id={n.id}
                  className="group-title"
                  transform={`translate(${x + 0.9 * view.k},${y + 0.6 * view.k})`}
                  onPointerDown={onNodeDown(n.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    vm.toggleExpanded(n.id);
                  }}
                >
                  <title>{`${n.path}\n${n.kindLabel}${n.tech ? ` · ${n.tech}` : ''}\nDuplo clique: recolher`}</title>
                  <rect width={width} height={3.2 * view.k} rx={0.5 * view.k} className="title-base" />
                  <rect width={width} height={3.2 * view.k} rx={0.5 * view.k} className="title-bg" fill={n.color} />
                  {showTitleText && (
                    <>
                      <NodeIcon id={n.icon} size={icon} color={n.color} x={0.4 * view.k} y={0.6 * view.k} />
                      <text x={icon + 0.9 * view.k} y={1.6 * view.k} style={{ fontSize: font }}>
                        {truncate(n.name, Math.max(6, Math.floor((b.w - 6) / 0.85)))}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {vm.nodes.map((n) => {
          const p = screen.get(n.id);
          if (!p || containers.has(n.id)) return null;
          const r = pxRadius(n);
          const sideLabel = layeredMode;
          const selected = vm.selectedNodeId === n.id;
          const dimmed = hoverNeighbors ? !hoverNeighbors.has(n.id) : !vm.isNodeHighlighted(n.id);
          const iconSize = r * 1.05;
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              className={`node-2d${dimmed ? ' dim' : ''}${n.isContext ? ' context' : ''}`}
              transform={`translate(${p.x},${p.y}) scale(${nodeScale})`}
              onPointerDown={onNodeDown(n.id)}
              onPointerEnter={() => setHoverId(n.id)}
              onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              onDoubleClick={(e) => {
                e.stopPropagation();
                vm.toggleExpanded(n.id);
              }}
            >
              <title>{`${n.path}\n${n.kindLabel}${n.tech ? ` · ${n.tech}` : ''}`}</title>
              {selected && <circle r={r + 6} className="ring" />}
              {n.hiddenCount > 0 && <circle r={r + 3.5} className="collapsed" stroke={n.color} />}
              {/* pathLength fixo: o tracejado (nós de contexto) fecha a volta sem emendar dois traços. */}
              <circle r={r} className="body" stroke={n.color} pathLength={n.isContext ? 60 : undefined} />
              {showIcons && <NodeIcon id={n.icon} size={iconSize} color={n.color} x={-iconSize / 2} y={-iconSize / 2} />}
              {n.hiddenCount > 0 && (
                <g transform={`translate(${r * 0.75},${-r * 0.75})`}>
                  <circle r={8} className="badge-bg" />
                  <text className="badge-text" dy="3">
                    +{n.hiddenCount}
                  </text>
                </g>
              )}
              {showLabels && (
                <>
                  <text className={`label${sideLabel ? ' side' : ''}`} x={sideLabel ? r + 8 : 0} y={sideLabel ? -2 : r + 15}>
                    {truncate(n.name, sideLabel ? 34 : groupedMode ? 24 : 40)}
                  </text>
                  <text className={`sublabel${sideLabel ? ' side' : ''}`} x={sideLabel ? r + 8 : 0} y={sideLabel ? 12 : r + 28}>
                    {truncate(n.tech ? `${n.kindLabel} · ${n.tech}` : n.kindLabel, groupedMode ? 30 : 40)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <CanvasMenu vm={menu} />
    </div>
  );
}

interface Edge2DProps {
  geometry: EdgeGeometry;
  vm: GraphSceneViewModel;
  state: 'hi' | 'normal' | 'dim';
  showPulse: boolean;
}

function Edge2D({ geometry, vm, state, showPulse }: Edge2DProps) {
  const { edge, d, label: at } = geometry;
  const hi = state === 'hi';
  const showLabel = hi && (vm.highlight != null || state === 'hi');
  const label = vm.edgeLabel(edge);

  return (
    <g
      className={`edge-2d ${state}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        vm.selectEdge(edge);
      }}
    >
      <path d={d} className="hit" />
      <path d={d} className="halo" />
      <path d={d} className="line" markerEnd={`url(#${hi ? 'arrow-hi' : 'arrow'})`} />
      {showPulse && (
        <circle r={hi ? 3 : 2.2} className="pulse" data-export="skip">
          <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
        </circle>
      )}
      {showLabel && label && (
        <g transform={`translate(${at.x},${at.y})`}>
          <rect x={-label.length * 3.4 - 6} y={-9} width={label.length * 6.8 + 12} height={18} rx={9} className="edge-label-bg" />
          <text className="edge-label-text" dy="4">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

type FitMode = 'free' | 'layered' | 'grouped';
const fitMode = (layered: unknown, grouped: unknown): FitMode => (grouped ? 'grouped' : layered ? 'layered' : 'free');

/** Pontos a enquadrar: posições dos nós e, no modo infra, os cantos das caixas. */
function fitPoints(world: Map<number, Point>, grouped: GroupResult | null): Point[] {
  const points = [...world.values()];
  for (const b of grouped?.boxes ?? []) points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  return points;
}

/** Enquadra todos os nós no SVG, com margem para rótulos. */
function fitView(svg: SVGSVGElement, points: readonly Point[], mode: FitMode = 'free'): View {
  if (mode === 'grouped') {
    const { width: w, height: h } = svg.getBoundingClientRect();
    if (!points.length) return { x: w / 2, y: h / 2, k: 12 };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 24;
    const k = clamp(Math.min((w - pad * 2) / Math.max(maxX - minX, 1), (h - pad * 2 - 40) / Math.max(maxY - minY, 1)), MIN_K, 14);
    return { k, x: (w - (maxX - minX) * k) / 2 - minX * k, y: pad - minY * k };
  }
  const layered = mode === 'layered';
  const { width: w, height: h } = svg.getBoundingClientRect();
  if (!points.length) return { x: w / 2, y: h / 2, k: 14 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Camadas: rótulos à direita (reserva ~22 unidades) e zoom mínimo menor, pois tudo escala junto.
  const extraRight = layered ? 22 : 0;
  const pad = { x: layered ? 40 : 90, top: 80, bottom: layered ? 60 : 90 };
  const k = clamp(
    Math.min((w - pad.x * 2) / Math.max(maxX + extraRight - minX, 1), (h - pad.top - pad.bottom) / Math.max(maxY - minY, 1)),
    layered ? 3 : MIN_FIT_K,
    layered ? 18 : 30,
  );
  return {
    k,
    x: pad.x - minX * k + Math.max(0, (w - pad.x * 2 - (maxX + extraRight - minX) * k) / 2),
    y: pad.top + (h - pad.top - pad.bottom) / 2 - ((minY + maxY) / 2) * k,
  };
}
