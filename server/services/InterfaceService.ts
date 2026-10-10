import { NotFoundError, ValidationError } from '../core/errors/AppError.ts';
import type { IEventBus } from '../core/events/EventBus.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { NodeInterface } from '../../shared/types.ts';
import type { CreateInterfaceInput, UpdateInterfaceInput } from '../../shared/schemas.ts';
import type { IInterfaceService } from './contracts/index.ts';

export class InterfaceService implements IInterfaceService {
  constructor(
    private readonly interfaces: IInterfaceRepository,
    private readonly nodes: INodeRepository,
    private readonly events: IEventBus,
  ) {}

  async list(): Promise<NodeInterface[]> {
    return await this.interfaces.findAll();
  }

  async get(id: number): Promise<NodeInterface> {
    const iface = await this.interfaces.findById(id);
    if (!iface) throw new NotFoundError(`Interface ${id} não encontrada`);
    return iface;
  }

  async create(input: CreateInterfaceInput): Promise<NodeInterface> {
    if (!(await this.nodes.exists(input.node_id))) throw new ValidationError(`Nó ${input.node_id} não existe`);
    const iface = await this.interfaces.create(input);
    this.events.emit('graph.changed');
    return iface;
  }

  async update(id: number, input: UpdateInterfaceInput): Promise<NodeInterface> {
    await this.get(id);
    const iface = await this.interfaces.update(id, input);
    this.events.emit('graph.changed');
    return iface;
  }

  async delete(id: number): Promise<void> {
    if (!(await this.interfaces.delete(id))) throw new NotFoundError(`Interface ${id} não encontrada`);
    this.events.emit('graph.changed');
  }
}
