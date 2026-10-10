import type { IEventBus } from '../core/events/EventBus.ts';
import { BusinessRuleError, NotFoundError, ValidationError } from '../core/errors/AppError.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { Connection } from '../../shared/types.ts';
import type { CreateConnectionInput, UpdateConnectionInput } from '../../shared/schemas.ts';
import type { IConnectionService } from './contracts/index.ts';

type ConnectionState = Pick<Connection, 'source_id' | 'target_id' | 'target_interface_id' | 'parent_connection_id'>;

export class ConnectionService implements IConnectionService {
  constructor(
    private readonly connections: IConnectionRepository,
    private readonly nodes: INodeRepository,
    private readonly interfaces: IInterfaceRepository,
    private readonly events: IEventBus,
  ) {}

  async list(): Promise<Connection[]> {
    return await this.connections.findAll();
  }

  async get(id: number): Promise<Connection> {
    const conn = await this.connections.findById(id);
    if (!conn) throw new NotFoundError(`Conexão ${id} não encontrada`);
    return conn;
  }

  async create(input: CreateConnectionInput): Promise<Connection> {
    await this.assertValid(input, null);
    const created = await this.connections.create(input);
    this.events.emit('graph.changed');
    return created;
  }

  async update(id: number, input: UpdateConnectionInput): Promise<Connection> {
    const current = await this.get(id);
    const next: ConnectionState = {
      source_id: input.source_id ?? current.source_id,
      target_id: input.target_id ?? current.target_id,
      target_interface_id: input.target_interface_id !== undefined ? input.target_interface_id : current.target_interface_id,
      parent_connection_id: input.parent_connection_id !== undefined ? input.parent_connection_id : current.parent_connection_id,
    };
    await this.assertValid(next, id);
    const updated = await this.connections.update(id, input);
    this.events.emit('graph.changed');
    return updated;
  }

  async delete(id: number): Promise<void> {
    if (!(await this.connections.delete(id))) throw new NotFoundError(`Conexão ${id} não encontrada`);
    this.events.emit('graph.changed');
  }

  private async assertValid(c: ConnectionState, selfId: number | null): Promise<void> {
    if (!(await this.nodes.exists(c.source_id))) throw new ValidationError(`Origem ${c.source_id} não existe`);
    if (!(await this.nodes.exists(c.target_id))) throw new ValidationError(`Destino ${c.target_id} não existe`);
    if (c.source_id === c.target_id) throw new BusinessRuleError('Origem e destino não podem ser o mesmo nó');
    if ((await this.nodes.graphOf(c.source_id)) !== (await this.nodes.graphOf(c.target_id)))
      throw new BusinessRuleError('Origem e destino precisam estar no mesmo grafo');

    if (c.target_interface_id != null) {
      const iface = await this.interfaces.findById(c.target_interface_id);
      if (!iface) throw new ValidationError(`Interface ${c.target_interface_id} não existe`);
      if (iface.node_id !== c.target_id) throw new BusinessRuleError('A interface escolhida não pertence ao destino');
    }

    // A cadeia de "implementa" não pode formar ciclo.
    let parent = c.parent_connection_id;
    const seen = new Set<number>();
    while (parent != null) {
      if (parent === selfId || seen.has(parent)) throw new BusinessRuleError('A cadeia de conexões implementadas forma um ciclo');
      seen.add(parent);
      const p = await this.connections.findById(parent);
      if (!p) throw new ValidationError(`Conexão pai ${parent} não existe`);
      parent = p.parent_connection_id;
    }
  }
}
