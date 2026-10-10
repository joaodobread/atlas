import { describe, expect, it } from 'vitest';
import { GraphIndex } from './GraphIndex.ts';

const node = (id: number, parent_id: number | null, name = `n${id}`) => ({
  id,
  graph_id: 1,
  parent_id,
  name,
  kind: 'service' as const,
  tech: null,
  icon: null,
  description: null,
  created_at: '',
  updated_at: '',
});

describe('GraphIndex', () => {
  it('monta caminhos e sobe conexões para o ancestral visível', () => {
    const index = new GraphIndex({
      nodes: [node(1, null, 'A'), node(2, 1, 'B'), node(3, null, 'C')],
      interfaces: [],
      connections: [
        { id: 10, source_id: 2, target_id: 3, target_interface_id: null, parent_connection_id: null, protocol: 'http', description: null, created_at: '' },
      ],
      callSites: [],
    });
    expect(index.path(2)).toBe('A / B');
    const edges = index.visibleEdges(new Set());
    expect(edges).toEqual([expect.objectContaining({ source: 1, target: 3, connectionIds: [10] })]);
  });
});

const conn = (id: number, source_id: number, target_id: number, parent_connection_id: number | null = null) => ({
  id,
  source_id,
  target_id,
  target_interface_id: null,
  parent_connection_id,
  protocol: null,
  description: null,
  created_at: '',
});

/**
 * 1 Org
 *   2 Api
 *     4 Auth
 *       6 Token
 *     5 Billing
 *   3 Web
 * 7 Db
 * 8 Ext
 */
const build = () =>
  new GraphIndex({
    nodes: [
      node(1, null, 'Org'),
      node(2, 1, 'Api'),
      node(3, 1, 'Web'),
      node(4, 2, 'Auth'),
      node(5, 2, 'Billing'),
      node(6, 4, 'Token'),
      node(7, null, 'Db'),
      node(8, null, 'Ext'),
    ],
    interfaces: [
      { id: 100, node_id: 7, name: 'users', type: 'table', spec: null, description: null },
      { id: 101, node_id: 7, name: 'orders', type: 'table', spec: null, description: null },
    ],
    connections: [conn(10, 2, 7), conn(11, 4, 7, 10), conn(12, 3, 2), conn(13, 5, 8), conn(14, 7, 6), conn(15, 4, 5), conn(16, 8, 7)],
    callSites: [
      { id: 1, connection_id: 11, file_path: 'a.ts', line: 1, symbol: null, snippet: null, notes: null },
      { id: 2, connection_id: 11, file_path: 'b.ts', line: null, symbol: null, snippet: null, notes: null },
    ],
  });

describe('GraphIndex — consultas', () => {
  it('índice vazio', () => {
    const e = GraphIndex.empty();
    expect(e.roots()).toEqual([]);
    expect(e.path(1)).toBe('?');
    expect(e.depth(1)).toBe(0);
    expect(e.scene(new Set(), null)).toEqual({ entries: [], edges: [] });
  });

  it('acessa nós, conexões, interfaces e locais', () => {
    const g = build();
    expect(g.node(2)?.name).toBe('Api');
    expect(g.node(99)).toBeUndefined();
    expect(g.connection(10)?.target_id).toBe(7);
    expect(g.connection(99)).toBeUndefined();
    expect(g.iface(100)?.name).toBe('users');
    expect(g.iface(null)).toBeUndefined();
    expect(g.iface(999)).toBeUndefined();
    expect(g.interfaces(7).map((i) => i.id)).toEqual([100, 101]);
    expect(g.interfaces(1)).toEqual([]);
    expect(g.callSites(11)).toHaveLength(2);
    expect(g.callSites(10)).toEqual([]);
  });

  it('hierarquia: raízes, filhos, profundidade, caminho, ancestrais e subárvore', () => {
    const g = build();
    expect(g.roots().map((n) => n.id)).toEqual([1, 7, 8]);
    expect(g.children(2).map((n) => n.id)).toEqual([4, 5]);
    expect(g.children(6)).toEqual([]);
    expect(g.hasChildren(4)).toBe(true);
    expect(g.hasChildren(6)).toBe(false);
    expect(g.depth(6)).toBe(3);
    expect(g.path(6)).toBe('Org / Api / Auth / Token');
    expect(g.ancestors(6).map((n) => n.id)).toEqual([4, 2, 1]);
    expect(g.ancestors(1)).toEqual([]);
    expect(g.ancestors(99)).toEqual([]);
    expect([...g.subtree(2)].sort((a, b) => a - b)).toEqual([2, 4, 5, 6]);
    expect([...g.subtree(7)]).toEqual([7]);
  });

  it('nó com pai inexistente vira raiz no caminho e para nos ancestrais', () => {
    const g = new GraphIndex({ nodes: [node(1, 50, 'Órfão')], interfaces: [], connections: [], callSites: [] });
    expect(g.path(1)).toBe('Órfão');
    expect(g.depth(1)).toBe(0);
    expect(g.ancestors(1)).toEqual([]);
  });

  it('caminho é calculado mesmo com filhos antes dos pais', () => {
    const g = new GraphIndex({ nodes: [node(3, 2, 'C'), node(2, 1, 'B'), node(1, null, 'A')], interfaces: [], connections: [], callSites: [] });
    expect(g.path(3)).toBe('A / B / C');
    expect(g.depth(3)).toBe(2);
  });

  it('entradas, saídas, implementações e saídas herdadas', () => {
    const g = build();
    expect(g.outgoing(4).map((c) => c.id)).toEqual([11, 15]);
    expect(g.incoming(7).map((c) => c.id)).toEqual([10, 11, 16]);
    expect(g.implementations(10).map((c) => c.id)).toEqual([11]);
    expect(g.implementations(11)).toEqual([]);
    expect(g.inheritedOutputs(4).map((c) => c.id)).toEqual([10]);
    expect(g.inheritedOutputs(6).map((c) => c.id)).toEqual([10, 11, 15]);
    expect(g.inheritedOutputs(1)).toEqual([]);
  });

  it('nodesByPath ordena pelo caminho', () => {
    expect(
      build()
        .nodesByPath()
        .map((n) => n.name),
    ).toEqual(['Db', 'Ext', 'Org', 'Api', 'Auth', 'Token', 'Billing', 'Web']);
  });

  it('visibilidade respeita os expandidos', () => {
    const g = build();
    const exp = new Set([1]);
    expect(g.isVisible(2, exp)).toBe(true);
    expect(g.isVisible(4, exp)).toBe(false);
    expect(g.visibleNodes(exp).map((n) => n.id)).toEqual([1, 2, 3, 7, 8]);
    expect(g.visibleNodes(new Set([1, 2])).map((n) => n.id)).toEqual([1, 2, 4, 5, 3, 7, 8]);
    expect(g.visibleRepresentative(6, exp)).toBe(2);
    expect(g.visibleRepresentative(6, new Set())).toBe(1);
    expect(g.visibleRepresentative(6, new Set([1, 2, 4]))).toBe(6);
    // Ancestral recolhido no meio, mesmo com o avô expandido: sobe até o mais alto recolhido.
    expect(g.visibleRepresentative(6, new Set([1, 4]))).toBe(2);
  });

  it('visibleEdges agrega conexões e marca sentido oposto', () => {
    const g = build();
    const edges = g.visibleEdges(new Set());
    // Tudo recolhido: Org<->Db, Org->Ext, Ext->Db. Internas (15, 12) somem.
    expect(edges.map((e) => [e.key, e.connectionIds, e.hasReverse])).toEqual([
      ['1->7', [10, 11], true],
      ['1->8', [13], false],
      ['7->1', [14], true],
      ['8->7', [16], false],
    ]);
  });

  it('scene sem foco: árvore visível e arestas visíveis', () => {
    const g = build();
    const s = g.scene(new Set([1]), null);
    expect(s.entries.map((e) => [e.node.id, e.parentId, e.isContext])).toEqual([
      [1, null, false],
      [2, 1, false],
      [3, 1, false],
      [7, null, false],
      [8, null, false],
    ]);
    expect(s.edges.map((e) => e.key)).toContain('3->2');
    // Foco inexistente é ignorado.
    expect(g.scene(new Set([1]), 999)).toEqual(s);
  });

  it('scene com foco recolhido: só o nó focado e os vizinhos como contexto', () => {
    const g = build();
    const s = g.scene(new Set(), 2);
    expect(s.entries.map((e) => [e.node.id, e.parentId, e.isContext])).toEqual([
      [2, null, false],
      [7, null, true],
      [1, null, true],
      [8, null, true],
    ]);
    expect(s.edges.map((e) => [e.key, e.connectionIds, e.hasReverse])).toEqual([
      ['2->7', [10, 11], true],
      ['1->2', [12], false],
      ['2->8', [13], false],
      ['7->2', [14], true],
    ]);
  });

  it('scene com foco expandido: filhos no foco e contexto com representante visível', () => {
    const g = build();
    const s = g.scene(new Set([2]), 2);
    expect(s.entries.filter((e) => !e.isContext).map((e) => [e.node.id, e.parentId])).toEqual([
      [2, null],
      [4, 2],
      [5, 2],
    ]);
    expect(s.entries.filter((e) => e.isContext).map((e) => e.node.id)).toEqual([7, 1, 8]);
    const keys = s.edges.map((e) => e.key);
    expect(keys).toEqual(['2->7', '4->7', '1->2', '5->8', '7->4', '4->5']);
  });

  it('scene com foco e neto recolhido dentro do foco', () => {
    const g = build();
    // Foco em Org expandido, Api recolhido: Token (6) sobe para Api (2).
    const s = g.scene(new Set([1]), 1);
    expect(s.edges.map((e) => e.key)).toEqual(['2->7', '3->2', '2->8', '7->2']);
    // Foco em Org expandido, Api expandido e Auth recolhido: Token sobe para Auth.
    const s2 = g.scene(new Set([1, 2]), 1);
    expect(s2.edges.map((e) => e.key)).toContain('7->4');
  });
});
