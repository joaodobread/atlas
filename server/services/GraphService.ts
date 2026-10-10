import type { ICallSiteRepository } from '../repositories/contracts/ICallSiteRepository.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { GraphData } from '../../shared/types.ts';
import type { IGraphService } from './contracts/index.ts';

export class GraphService implements IGraphService {
  constructor(
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    private readonly connections: IConnectionRepository,
    private readonly callSites: ICallSiteRepository,
  ) {}

  /** Um grafo (diagrama) ou, sem id, todos (modelo usado na busca/RAG). */
  async getGraph(graphId?: number): Promise<GraphData> {
    if (graphId == null) {
      return {
        nodes: await this.nodes.findAll(),
        interfaces: await this.interfaces.findAll(),
        connections: await this.connections.findAll(),
        callSites: await this.callSites.findAll(),
      };
    }
    const nodes = await this.nodes.findByGraph(graphId);
    const ids = new Set(nodes.map((n) => n.id));
    const connections = (await this.connections.findAll()).filter((c) => ids.has(c.source_id));
    const connIds = new Set(connections.map((c) => c.id));
    return {
      nodes,
      interfaces: (await this.interfaces.findAll()).filter((i) => ids.has(i.node_id)),
      connections,
      callSites: (await this.callSites.findAll()).filter((s) => connIds.has(s.connection_id)),
    };
  }
}
