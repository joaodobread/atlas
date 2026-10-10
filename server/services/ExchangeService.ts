import type { IEventBus } from '../core/events/EventBus.ts';
import type { IDatabase } from '../infra/database/IDatabase.ts';
import type { ICallSiteRepository } from '../repositories/contracts/ICallSiteRepository.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { GraphNode, ImportResult } from '../../shared/types.ts';
import type { ExchangeConnection, ExchangeDocument, ExchangeNode } from '../../shared/schemas.ts';
import type { IExchangeService, IGraphService } from './contracts/index.ts';

/** Converte null em undefined para o formato de troca. */
const opt = <T>(v: T | null): T | undefined => v ?? undefined;

/**
 * Import/export do grafo num formato textual pensado para ser gerado por um LLM.
 * Em modo "merge" o import é idempotente: nós casam por (pai, nome), interfaces por (nó, nome)
 * e conexões por (origem, destino, interface).
 */
export class ExchangeService implements IExchangeService {
  constructor(
    private readonly db: IDatabase,
    private readonly graph: IGraphService,
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    private readonly connections: IConnectionRepository,
    private readonly callSites: ICallSiteRepository,
    private readonly events: IEventBus,
  ) {}

  async exportDocument(graphId: number): Promise<ExchangeDocument> {
    const g = await this.graph.getGraph(graphId);
    const paths = ExchangeService.buildPaths(g.nodes);
    const ifaceById = new Map(g.interfaces.map((i) => [i.id, i]));

    const nodes: ExchangeNode[] = g.nodes
      .map((n) => ({
        ref: paths.get(n.id)!,
        name: n.name,
        kind: n.kind,
        tech: opt(n.tech),
        icon: opt(n.icon),
        description: opt(n.description),
        parent: n.parent_id == null ? null : paths.get(n.parent_id)!,
        interfaces: g.interfaces
          .filter((i) => i.node_id === n.id)
          .map((i) => ({ name: i.name, type: opt(i.type), spec: opt(i.spec), description: opt(i.description) })),
      }))
      .sort((a, b) => a.ref.split('/').length - b.ref.split('/').length || a.ref.localeCompare(b.ref));

    const connections: ExchangeConnection[] = g.connections.map((c) => ({
      ref: `c${c.id}`,
      from: paths.get(c.source_id)!,
      to: paths.get(c.target_id)!,
      interface: c.target_interface_id ? ifaceById.get(c.target_interface_id)?.name : undefined,
      protocol: opt(c.protocol),
      description: opt(c.description),
      implements: c.parent_connection_id ? `c${c.parent_connection_id}` : undefined,
      callSites: g.callSites
        .filter((s) => s.connection_id === c.id)
        .map((s) => ({
          file_path: s.file_path,
          line: opt(s.line),
          symbol: opt(s.symbol),
          snippet: opt(s.snippet),
          notes: opt(s.notes),
          end_line: opt(s.end_line),
          code: opt(s.code),
        })),
    }));

    return { mode: 'merge', nodes, connections };
  }

  async importDocument(doc: ExchangeDocument, graphId: number): Promise<ImportResult> {
    const result = await this.db.transaction(() => new ImportRun(graphId, this.nodes, this.interfaces, this.connections, this.callSites).execute(doc));
    this.events.emit('graph.changed');
    return result;
  }

  private static buildPaths(nodes: GraphNode[]): Map<number, string> {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const cache = new Map<number, string>();
    const pathOf = (id: number): string => {
      const hit = cache.get(id);
      if (hit) return hit;
      const n = byId.get(id)!;
      const p = n.parent_id == null ? n.name : `${pathOf(n.parent_id)}/${n.name}`;
      cache.set(id, p);
      return p;
    };
    for (const n of nodes) pathOf(n.id);
    return cache;
  }
}

/** Estado de uma execução de import (refs locais -> ids). */
class ImportRun {
  private readonly nodeRefs = new Map<string, number>();
  private readonly connectionRefs = new Map<string, number>();
  private readonly result: ImportResult = {
    nodesCreated: 0,
    nodesUpdated: 0,
    interfacesCreated: 0,
    connectionsCreated: 0,
    connectionsUpdated: 0,
    callSitesCreated: 0,
    warnings: [],
  };

  constructor(
    private readonly graphId: number,
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    private readonly connections: IConnectionRepository,
    private readonly callSites: ICallSiteRepository,
  ) {}

  async execute(doc: ExchangeDocument): Promise<ImportResult> {
    // Substituir apaga só este grafo (conexões, interfaces e locais caem em cascata com os nós).
    if (doc.mode === 'replace') await this.nodes.deleteByGraph(this.graphId);
    await this.importNodes(doc.nodes);
    const implementsLinks: Array<[number, string]> = [];
    for (const c of doc.connections) implementsLinks.push(...(await this.importConnection(c)));
    for (const [id, ref] of implementsLinks) await this.linkImplements(id, ref);
    return this.result;
  }

  /** Resolve um ref do documento ou, se não houver, um caminho "A/B/C" de nós existentes. */
  private async resolveNode(ref: string): Promise<number | undefined> {
    const local = this.nodeRefs.get(ref);
    if (local != null) return local;
    let parent: number | null = null;
    for (const name of ref.split('/')) {
      const node = await this.nodes.findByParentAndName(this.graphId, parent, name);
      if (!node) return undefined;
      parent = node.id;
    }
    return parent ?? undefined;
  }

  /** Processa em ondas até que todos os pais estejam resolvidos. */
  private async importNodes(list: ExchangeNode[]): Promise<void> {
    let pending = list;
    while (pending.length) {
      const deferred: ExchangeNode[] = [];
      for (const n of pending) if (!(await this.importNode(n))) deferred.push(n);
      if (deferred.length === pending.length) {
        for (const n of deferred) this.result.warnings.push(`Pai "${n.parent}" não encontrado para ${n.ref}`);
        return;
      }
      pending = deferred;
    }
  }

  /** @returns false quando o pai ainda não foi resolvido. */
  private async importNode(n: ExchangeNode): Promise<boolean> {
    let parentId: number | null = null;
    if (n.parent) {
      const pid = await this.resolveNode(n.parent);
      if (pid == null) return false;
      parentId = pid;
    }

    const existing = await this.nodes.findByParentAndName(this.graphId, parentId, n.name);
    let id: number;
    if (existing) {
      id = (await this.nodes.update(existing.id, { kind: n.kind, tech: n.tech, icon: n.icon, description: n.description })).id;
      this.result.nodesUpdated++;
    } else {
      const kind = n.kind ?? (parentId == null ? 'project' : 'module');
      id = (
        await this.nodes.create({ graph_id: this.graphId, parent_id: parentId, name: n.name, kind, tech: n.tech, icon: n.icon, description: n.description })
      ).id;
      this.result.nodesCreated++;
    }
    this.nodeRefs.set(n.ref, id);

    for (const i of n.interfaces ?? []) {
      const ex = await this.interfaces.findByNodeAndName(id, i.name);
      if (ex) {
        await this.interfaces.update(ex.id, { type: i.type, spec: i.spec, description: i.description });
      } else {
        await this.interfaces.create({ node_id: id, ...i });
        this.result.interfacesCreated++;
      }
    }
    return true;
  }

  /** @returns pares [connectionId, implementsRef] a serem ligados depois. */
  private async importConnection(c: ExchangeConnection): Promise<Array<[number, string]>> {
    const source = await this.resolveNode(c.from);
    const target = await this.resolveNode(c.to);
    if (source == null || target == null) {
      this.result.warnings.push(`Conexão ignorada, nó não encontrado: ${c.from} -> ${c.to}`);
      return [];
    }
    if (source === target) {
      this.result.warnings.push(`Conexão ignorada (auto-referência): ${c.from}`);
      return [];
    }

    let ifaceId: number | null = null;
    if (c.interface) {
      let iface = await this.interfaces.findByNodeAndName(target, c.interface);
      if (!iface) {
        iface = await this.interfaces.create({ node_id: target, name: c.interface, type: c.protocol });
        this.result.interfacesCreated++;
      }
      ifaceId = iface.id;
    }

    const existing = await this.connections.findByEndpoints(source, target, ifaceId);
    let id: number;
    if (existing) {
      id = (await this.connections.update(existing.id, { protocol: c.protocol, description: c.description })).id;
      this.result.connectionsUpdated++;
    } else {
      id = (
        await this.connections.create({
          source_id: source,
          target_id: target,
          target_interface_id: ifaceId,
          protocol: c.protocol,
          description: c.description,
        })
      ).id;
      this.result.connectionsCreated++;
    }
    if (c.ref) this.connectionRefs.set(c.ref, id);

    for (const s of c.callSites ?? []) {
      if (await this.callSites.existsAt(id, s.file_path, s.line ?? null)) continue;
      await this.callSites.create({ connection_id: id, ...s });
      this.result.callSitesCreated++;
    }
    return c.implements ? [[id, c.implements]] : [];
  }

  private async linkImplements(id: number, ref: string): Promise<void> {
    const parentId = this.connectionRefs.get(ref);
    if (parentId == null || parentId === id) {
      this.result.warnings.push(`implements "${ref}" não encontrado`);
      return;
    }
    // Não grava ciclos (x implementa y que implementa x…): sobe a cadeia do pai procurando a própria conexão.
    let cursor: number | null = parentId;
    for (let guard = 0; cursor != null && guard < 1000; guard++) {
      if (cursor === id) {
        this.result.warnings.push(`implements "${ref}" criaria um ciclo; ignorado`);
        return;
      }
      cursor = (await this.connections.findById(cursor))?.parent_connection_id ?? null;
    }
    await this.connections.update(id, { parent_connection_id: parentId });
  }
}
