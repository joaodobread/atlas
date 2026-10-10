import type { AnalysisDepth } from '../../shared/constants.ts';
import type { CreateGraphInput, GraphFromReposInput, UpdateGraphInput } from '../../shared/schemas.ts';
import type { GraphInfo } from '../../shared/types.ts';
import { BusinessRuleError, NotFoundError } from '../core/errors/AppError.ts';
import type { IEventBus } from '../core/events/EventBus.ts';
import type { IDatabase } from '../infra/database/IDatabase.ts';
import type { ICallSiteRepository } from '../repositories/contracts/ICallSiteRepository.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { IGraphRepository } from '../repositories/contracts/IGraphRepository.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { IRepoIntrospectionRepository } from '../repositories/contracts/IRepoIntrospectionRepository.ts';
import type { IGraphService, IGraphsService, IIntrospectionService } from './contracts/index.ts';

const DEPTH_RANK: Record<AnalysisDepth, number> = { fast: 0, medium: 1, full: 2 };
const DEPTH_LABEL: Record<AnalysisDepth, string> = { fast: 'rápida', medium: 'média', full: 'completa' };
/** Na geração rápida só entram vizinhos "de infra": bancos, filas, infraestrutura e externos. */
const FAST_KINDS = new Set(['database', 'queue', 'infra', 'external']);

/** Grafos independentes (diagramas): cada um tem os próprios nós e conexões. */
export class GraphsService implements IGraphsService {
  constructor(
    private readonly graphs: IGraphRepository,
    private readonly graph: IGraphService,
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    private readonly connections: IConnectionRepository,
    private readonly callSites: ICallSiteRepository,
    private readonly repos: IRepoIntrospectionRepository,
    private readonly introspection: IIntrospectionService,
    private readonly db: IDatabase,
    private readonly events: IEventBus,
  ) {}

  async list(): Promise<GraphInfo[]> {
    return await this.graphs.list();
  }

  async get(id: number): Promise<GraphInfo> {
    const g = await this.graphs.findById(id);
    if (!g) throw new NotFoundError(`Grafo ${id} não encontrado`);
    return g;
  }

  async create(input: CreateGraphInput): Promise<GraphInfo> {
    await this.assertNameFree(input.name);
    return await this.graphs.create(input.name, input.description ?? null);
  }

  async update(id: number, input: UpdateGraphInput): Promise<GraphInfo> {
    await this.get(id);
    if (input.name) await this.assertNameFree(input.name, id);
    return await this.graphs.update(id, { name: input.name, description: input.description });
  }

  async delete(id: number): Promise<void> {
    await this.get(id);
    if ((await this.graphs.count()) <= 1) throw new BusinessRuleError('Não é possível excluir o único grafo');
    await this.graphs.delete(id);
    this.events.emit('graph.changed');
  }

  /**
   * Novo grafo com os repositórios escolhidos, copiados do grafo de origem com as caixas que os contêm (contas, VPCs…):
   * - rápida: o nó do repositório e só os bancos, filas, infra e externos ligados a ele;
   * - média: o repositório com seus módulos e tudo com que se comunica (1 salto), mais a proposta da análise por LLM;
   * - completa: a média + módulos e trechos de código das chamadas externas (análise completa).
   * Repositórios ainda sem nó entram só pela proposta da análise.
   */
  async generateFromRepos(input: GraphFromReposInput): Promise<GraphInfo> {
    await this.assertNameFree(input.name);
    const repos: Array<NonNullable<Awaited<ReturnType<IRepoIntrospectionRepository['findById']>>>> = [];
    for (const id of input.repoIds) {
      const r = await this.repos.findById(id);
      if (!r) throw new NotFoundError(`Repositório ${id} não encontrado`);
      repos.push(r);
    }
    if (input.depth !== 'fast') {
      const shallow = repos.filter((r) => !r.analysisDepth || DEPTH_RANK[r.analysisDepth] < DEPTH_RANK[input.depth]);
      if (shallow.length) {
        throw new BusinessRuleError(`Analise com profundidade ${DEPTH_LABEL[input.depth]} antes de gerar: ${shallow.map((r) => r.name).join(', ')}`);
      }
    }

    const created = await this.db.transaction(async () => {
      const target = await this.graphs.create(input.name, input.description ?? `Gerado a partir de: ${repos.map((r) => r.name).join(', ')}`);

      // Por grafo de origem: copia o recorte.
      const linked = repos.filter((r) => r.nodeId != null);
      const bySource = new Map<number, number[]>();
      for (const r of linked) {
        const g = await this.nodes.graphOf(r.nodeId!);
        if (g !== undefined) bySource.set(g, [...(bySource.get(g) ?? []), r.nodeId!]);
      }
      for (const [sourceGraph, seeds] of bySource) await this.copySlice(sourceGraph, seeds, target.id, input.depth);

      // Proposta da análise: completa os sem nó e, na média/completa, enriquece os demais (módulos, trechos…).
      for (const r of repos) {
        const unlinked = r.nodeId == null || (await this.nodes.graphOf(r.nodeId)) === undefined;
        if (r.proposal && (unlinked || input.depth !== 'fast')) await this.introspection.apply(r.id, target.id);
      }
      return target;
    });
    this.events.emit('graph.changed');
    return await this.get(created.id);
  }

  private async copySlice(sourceGraph: number, seeds: number[], targetGraph: number, depth: AnalysisDepth): Promise<void> {
    const g = await this.graph.getGraph(sourceGraph);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<number, number[]>();
    for (const n of g.nodes) if (n.parent_id != null) childrenOf.set(n.parent_id, [...(childrenOf.get(n.parent_id) ?? []), n.id]);
    const subtree = (id: number, out = new Set<number>()) => {
      out.add(id);
      for (const c of childrenOf.get(id) ?? []) subtree(c, out);
      return out;
    };

    // Repositórios + módulos; depois quem fala com eles; depois os ancestrais (caixas).
    // Conexões de módulos "sobem" para o repositório na rápida (sem módulos).
    const core = new Set<number>();
    const ownerOf = new Map<number, number>();
    for (const s of seeds) {
      for (const id of subtree(s)) {
        core.add(id);
        ownerOf.set(id, s);
      }
    }
    const keep = new Set(depth === 'fast' ? seeds : core);
    const allowed = (id: number) => depth !== 'fast' || FAST_KINDS.has(byId.get(id)?.kind ?? '');
    for (const c of g.connections) {
      if (core.has(c.source_id) && !core.has(c.target_id) && allowed(c.target_id)) keep.add(c.target_id);
      if (core.has(c.target_id) && !core.has(c.source_id) && allowed(c.source_id)) keep.add(c.source_id);
    }
    // Cópia: o laço acrescenta ancestrais ao conjunto.
    for (const id of Array.from(keep)) {
      let p = byId.get(id)?.parent_id ?? null;
      while (p != null && !keep.has(p)) {
        keep.add(p);
        p = byId.get(p)?.parent_id ?? null;
      }
    }

    // Pais antes dos filhos.
    const levelOf = (id: number): number => {
      const p = byId.get(id)?.parent_id;
      return p == null ? 0 : 1 + levelOf(p);
    };
    const newId = new Map<number, number>();
    for (const id of [...keep].sort((a, b) => levelOf(a) - levelOf(b))) {
      const n = byId.get(id)!;
      const parent = n.parent_id != null ? (newId.get(n.parent_id) ?? null) : null;
      const existing = await this.nodes.findByParentAndName(targetGraph, parent, n.name);
      newId.set(
        id,
        existing?.id ??
          (
            await this.nodes.create({
              graph_id: targetGraph,
              parent_id: parent,
              name: n.name,
              kind: n.kind,
              tech: n.tech,
              icon: n.icon,
              description: n.description,
            })
          ).id,
      );
    }
    const newIface = new Map<number, number>();
    for (const i of g.interfaces.filter((x) => newId.has(x.node_id))) {
      const nodeId = newId.get(i.node_id)!;
      const existing = await this.interfaces.findByNodeAndName(nodeId, i.name);
      newIface.set(
        i.id,
        existing?.id ?? (await this.interfaces.create({ node_id: nodeId, name: i.name, type: i.type, spec: i.spec, description: i.description })).id,
      );
    }
    // Só as conexões que tocam os repositórios (o que "fala com eles"), não toda a malha entre vizinhos.
    const newConn = new Map<number, number>();
    // Na rápida, módulo → repositório dono; conexões duplicadas se fundem.
    const mapEnd = (id: number) => newId.get(depth === 'fast' && core.has(id) ? ownerOf.get(id)! : id);
    for (const c of g.connections.filter(
      (x) => (core.has(x.source_id) || core.has(x.target_id)) && mapEnd(x.source_id) != null && mapEnd(x.target_id) != null,
    )) {
      const source = mapEnd(c.source_id)!;
      const target = mapEnd(c.target_id)!;
      if (source === target) continue;
      const iface = c.target_interface_id != null ? (newIface.get(c.target_interface_id) ?? null) : null;
      const existing = await this.connections.findByEndpoints(source, target, iface);
      newConn.set(
        c.id,
        existing?.id ??
          (
            await this.connections.create({
              source_id: source,
              target_id: target,
              target_interface_id: iface,
              protocol: c.protocol,
              description: c.description,
            })
          ).id,
      );
    }
    for (const c of g.connections) {
      if (c.parent_connection_id == null || !newConn.has(c.id) || !newConn.has(c.parent_connection_id)) continue;
      const child = newConn.get(c.id)!;
      const parent = newConn.get(c.parent_connection_id)!;
      // Na rápida, filho e pai podem ter virado a mesma conexão (módulos sobem para o repositório).
      if (child !== parent) await this.connections.update(child, { parent_connection_id: parent });
    }
    if (depth === 'fast') return; // sem trechos de código na rápida
    for (const s of g.callSites.filter((x) => newConn.has(x.connection_id))) {
      await this.callSites.create({
        connection_id: newConn.get(s.connection_id)!,
        file_path: s.file_path,
        line: s.line,
        symbol: s.symbol,
        snippet: s.snippet,
        notes: s.notes,
      });
    }
  }

  private async assertNameFree(name: string, exceptId?: number): Promise<void> {
    const other = await this.graphs.findByName(name);
    if (other && other.id !== exceptId) throw new BusinessRuleError(`Já existe um grafo chamado "${name}"`);
  }
}
