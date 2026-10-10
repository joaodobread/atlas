import type { CallSite, Connection, GraphData, GraphNode, NodeInterface } from '../../shared/types.ts';

/** Aresta exibida na cena: uma ou mais conexões agregadas entre nós visíveis. */
export interface VisibleEdge {
  key: string;
  source: number;
  target: number;
  connectionIds: number[];
  /** Existe aresta no sentido oposto (desenha curvada). */
  hasReverse: boolean;
}

/** Nó presente na cena atual. */
export interface SceneEntry {
  node: GraphNode;
  /** Pai visível na cena (para a linha de hierarquia). */
  parentId: number | null;
  /** Nó fora do foco, exibido só porque se comunica com ele. */
  isContext: boolean;
}

export interface SceneGraph {
  entries: SceneEntry[];
  edges: VisibleEdge[];
}

/** Visão indexada e imutável do grafo, com consultas usadas pelas ViewModels. */
export class GraphIndex {
  readonly nodes: GraphNode[];
  readonly connections: Connection[];
  private readonly nodeById = new Map<number, GraphNode>();
  private readonly childrenOf = new Map<number | null, GraphNode[]>();
  private readonly depthOf = new Map<number, number>();
  private readonly pathOf = new Map<number, string>();
  private readonly interfacesOf = new Map<number, NodeInterface[]>();
  private readonly interfaceById = new Map<number, NodeInterface>();
  private readonly connectionById = new Map<number, Connection>();
  private readonly callSitesOf = new Map<number, CallSite[]>();

  constructor(data: GraphData) {
    this.nodes = data.nodes;
    this.connections = data.connections;
    for (const n of data.nodes) {
      this.nodeById.set(n.id, n);
      push(this.childrenOf, n.parent_id, n);
    }
    for (const i of data.interfaces) {
      this.interfaceById.set(i.id, i);
      push(this.interfacesOf, i.node_id, i);
    }
    for (const c of data.connections) this.connectionById.set(c.id, c);
    for (const s of data.callSites) push(this.callSitesOf, s.connection_id, s);
    for (const n of data.nodes) this.computePath(n.id);
  }

  static empty(): GraphIndex {
    return new GraphIndex({ nodes: [], interfaces: [], connections: [], callSites: [] });
  }

  node(id: number): GraphNode | undefined {
    return this.nodeById.get(id);
  }

  connection(id: number): Connection | undefined {
    return this.connectionById.get(id);
  }

  iface(id: number | null): NodeInterface | undefined {
    return id == null ? undefined : this.interfaceById.get(id);
  }

  roots(): GraphNode[] {
    return this.childrenOf.get(null) ?? [];
  }

  children(id: number): GraphNode[] {
    return this.childrenOf.get(id) ?? [];
  }

  hasChildren(id: number): boolean {
    return this.children(id).length > 0;
  }

  depth(id: number): number {
    return this.depthOf.get(id) ?? 0;
  }

  path(id: number): string {
    return this.pathOf.get(id) ?? '?';
  }

  interfaces(nodeId: number): NodeInterface[] {
    return this.interfacesOf.get(nodeId) ?? [];
  }

  callSites(connectionId: number): CallSite[] {
    return this.callSitesOf.get(connectionId) ?? [];
  }

  /** Ancestrais do mais próximo ao mais distante. */
  ancestors(id: number): GraphNode[] {
    const out: GraphNode[] = [];
    let cur = this.node(id)?.parent_id ?? null;
    while (cur != null) {
      const n = this.node(cur);
      if (!n) break;
      out.push(n);
      cur = n.parent_id;
    }
    return out;
  }

  /** O próprio nó e todos os descendentes. */
  subtree(id: number): Set<number> {
    const out = new Set<number>([id]);
    const stack = [id];
    while (stack.length) {
      for (const c of this.children(stack.pop()!)) {
        if (out.has(c.id)) continue;
        out.add(c.id);
        stack.push(c.id);
      }
    }
    return out;
  }

  outgoing(id: number): Connection[] {
    return this.connections.filter((c) => c.source_id === id);
  }

  incoming(id: number): Connection[] {
    return this.connections.filter((c) => c.target_id === id);
  }

  /** Conexões que implementam (refinam) a conexão informada. */
  implementations(connectionId: number): Connection[] {
    return this.connections.filter((c) => c.parent_connection_id === connectionId);
  }

  /** Saídas dos ancestrais: candidatas a serem "herdadas" por um módulo. */
  inheritedOutputs(id: number): Connection[] {
    const anc = new Set(this.ancestors(id).map((a) => a.id));
    return this.connections.filter((c) => anc.has(c.source_id));
  }

  /** Nós ordenados pelo caminho, para selects. */
  nodesByPath(): GraphNode[] {
    return [...this.nodes].sort((a, b) => this.path(a.id).localeCompare(this.path(b.id)));
  }

  isVisible(id: number, expanded: ReadonlySet<number>): boolean {
    return this.ancestors(id).every((a) => expanded.has(a.id));
  }

  /** Nós visíveis, pais antes dos filhos. */
  visibleNodes(expanded: ReadonlySet<number>): GraphNode[] {
    const out: GraphNode[] = [];
    const walk = (list: GraphNode[]) => {
      for (const n of list) {
        out.push(n);
        if (expanded.has(n.id)) walk(this.children(n.id));
      }
    };
    walk(this.roots());
    return out;
  }

  /** Ancestral visível mais próximo (ou o próprio nó). */
  visibleRepresentative(id: number, expanded: ReadonlySet<number>): number {
    let rep = id;
    for (const a of this.ancestors(id)) if (!expanded.has(a.id)) rep = a.id;
    return rep;
  }

  /**
   * Conexões "subidas" até os nós visíveis: se um módulo está recolhido,
   * suas conexões aparecem saindo/chegando no ancestral visível. Conexões internas somem.
   */
  visibleEdges(expanded: ReadonlySet<number>): VisibleEdge[] {
    const edges = new Map<string, VisibleEdge>();
    for (const c of this.connections) {
      const s = this.visibleRepresentative(c.source_id, expanded);
      const t = this.visibleRepresentative(c.target_id, expanded);
      if (s === t) continue;
      const key = `${s}->${t}`;
      const e = edges.get(key) ?? { key, source: s, target: t, connectionIds: [], hasReverse: false };
      e.connectionIds.push(c.id);
      edges.set(key, e);
    }
    for (const e of edges.values()) e.hasReverse = edges.has(`${e.target}->${e.source}`);
    return [...edges.values()];
  }

  /**
   * O que deve aparecer na cena.
   * - Sem foco: árvore inteira respeitando os nós expandidos.
   * - Com foco: só a subárvore do nó focado (respeitando expandidos) + os nós com que ela se comunica.
   */
  scene(expanded: ReadonlySet<number>, focusId: number | null): SceneGraph {
    const focus = focusId != null ? this.node(focusId) : undefined;
    if (!focus)
      return { entries: this.visibleNodes(expanded).map((n) => ({ node: n, parentId: n.parent_id, isContext: false })), edges: this.visibleEdges(expanded) };

    const inFocus = this.subtree(focus.id);
    const entries = new Map<number, SceneEntry>();
    const walk = (n: GraphNode, parentId: number | null) => {
      entries.set(n.id, { node: n, parentId, isContext: false });
      if (expanded.has(n.id)) for (const c of this.children(n.id)) walk(c, n.id);
    };
    walk(focus, null);

    // Representante dentro do foco: sobe até o focado ou até o primeiro ancestral recolhido.
    const repInFocus = (id: number): number => {
      if (id === focus.id) return id;
      let rep = id;
      for (const a of this.ancestors(id)) {
        if (a.id === focus.id) return expanded.has(a.id) ? rep : a.id;
        if (!expanded.has(a.id)) rep = a.id;
      }
      return rep;
    };
    const rep = (id: number) => (inFocus.has(id) ? repInFocus(id) : this.visibleRepresentative(id, expanded));

    const edges = new Map<string, VisibleEdge>();
    for (const c of this.connections) {
      if (!inFocus.has(c.source_id) && !inFocus.has(c.target_id)) continue;
      const s = rep(c.source_id);
      const t = rep(c.target_id);
      if (s === t) continue;
      for (const id of [s, t]) if (!entries.has(id)) entries.set(id, { node: this.node(id)!, parentId: null, isContext: true });
      const key = `${s}->${t}`;
      const e = edges.get(key) ?? { key, source: s, target: t, connectionIds: [], hasReverse: false };
      e.connectionIds.push(c.id);
      edges.set(key, e);
    }
    for (const e of edges.values()) e.hasReverse = edges.has(`${e.target}->${e.source}`);
    return { entries: [...entries.values()], edges: [...edges.values()] };
  }

  private computePath(id: number): string {
    const hit = this.pathOf.get(id);
    if (hit) return hit;
    const n = this.nodeById.get(id)!;
    const parent = n.parent_id != null && this.nodeById.has(n.parent_id) ? n.parent_id : null;
    const path = parent == null ? n.name : `${this.computePath(parent)} / ${n.name}`;
    this.depthOf.set(id, parent == null ? 0 : (this.depthOf.get(parent) ?? 0) + 1);
    this.pathOf.set(id, path);
    return path;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
