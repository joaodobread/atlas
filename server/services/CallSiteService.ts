import type { IEventBus } from '../core/events/EventBus.ts';
import { NotFoundError, ValidationError } from '../core/errors/AppError.ts';
import type { ICallSiteRepository } from '../repositories/contracts/ICallSiteRepository.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { CallSite } from '../../shared/types.ts';
import type { CreateCallSiteInput, UpdateCallSiteInput } from '../../shared/schemas.ts';
import type { ICallSiteService } from './contracts/index.ts';

export class CallSiteService implements ICallSiteService {
  constructor(
    private readonly callSites: ICallSiteRepository,
    private readonly connections: IConnectionRepository,
    private readonly events: IEventBus,
  ) {}

  async list(): Promise<CallSite[]> {
    return await this.callSites.findAll();
  }

  async get(id: number): Promise<CallSite> {
    const site = await this.callSites.findById(id);
    if (!site) throw new NotFoundError(`Local de chamada ${id} não encontrado`);
    return site;
  }

  async create(input: CreateCallSiteInput): Promise<CallSite> {
    if (!(await this.connections.exists(input.connection_id))) throw new ValidationError(`Conexão ${input.connection_id} não existe`);
    const created = await this.callSites.create(input);
    this.events.emit('graph.changed');
    return created;
  }

  async update(id: number, input: UpdateCallSiteInput): Promise<CallSite> {
    await this.get(id);
    const updated = await this.callSites.update(id, input);
    this.events.emit('graph.changed');
    return updated;
  }

  async delete(id: number): Promise<void> {
    if (!(await this.callSites.delete(id))) throw new NotFoundError(`Local de chamada ${id} não encontrado`);
    this.events.emit('graph.changed');
  }
}
