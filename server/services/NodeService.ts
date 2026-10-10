import { BusinessRuleError, NotFoundError, ValidationError } from '../core/errors/AppError.ts';
import type { IEventBus } from '../core/events/EventBus.ts';
import type { IGraphRepository } from '../repositories/contracts/IGraphRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { GraphNode } from '../../shared/types.ts';
import type { CreateNodeInput, UpdateNodeInput } from '../../shared/schemas.ts';
import type { INodeService } from './contracts/index.ts';

export class NodeService implements INodeService {
  constructor(
    private readonly nodes: INodeRepository,
    private readonly graphs: IGraphRepository,
    private readonly events: IEventBus,
  ) {}

  async list(): Promise<GraphNode[]> {
    return await this.nodes.findAll();
  }

  async get(id: number): Promise<GraphNode> {
    const node = await this.nodes.findById(id);
    if (!node) throw new NotFoundError(`Nó ${id} não encontrado`);
    return node;
  }

  async create(input: CreateNodeInput): Promise<GraphNode> {
    // Filho fica no grafo do pai; raiz precisa dizer o grafo.
    let graphId = input.graph_id;
    if (input.parent_id != null) {
      graphId = await this.nodes.graphOf(input.parent_id);
      if (graphId === undefined) throw new ValidationError(`Nó pai ${input.parent_id} não existe`);
    } else if (graphId == null) throw new ValidationError('Informe o grafo (graph_id) do nó raiz');
    else if (!(await this.graphs.findById(graphId))) throw new ValidationError(`Grafo ${graphId} não existe`);
    const node = await this.nodes.create({ ...input, graph_id: graphId });
    this.events.emit('graph.changed');
    return node;
  }

  async update(id: number, input: UpdateNodeInput): Promise<GraphNode> {
    await this.get(id);
    if (input.parent_id != null) {
      await this.assertExists(input.parent_id, 'Nó pai');
      if ((await this.nodes.graphOf(input.parent_id)) !== (await this.nodes.graphOf(id))) throw new BusinessRuleError('O nó pai precisa estar no mesmo grafo');
      await this.assertNoCycle(id, input.parent_id);
    }
    const node = await this.nodes.update(id, input);
    this.events.emit('graph.changed');
    return node;
  }

  async delete(id: number): Promise<void> {
    if (!(await this.nodes.delete(id))) throw new NotFoundError(`Nó ${id} não encontrado`);
    this.events.emit('graph.changed');
  }

  private async assertExists(id: number, label: string): Promise<void> {
    if (!(await this.nodes.exists(id))) throw new ValidationError(`${label} ${id} não existe`);
  }

  /** Impede mover um nó para dentro de si mesmo ou de um descendente. */
  private async assertNoCycle(id: number, newParentId: number): Promise<void> {
    let current: number | null | undefined = newParentId;
    while (current != null) {
      if (current === id) throw new BusinessRuleError('Um nó não pode ser movido para dentro de si mesmo');
      current = await this.nodes.findParentId(current);
    }
  }
}
