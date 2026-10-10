import type { NodeInterface } from '../../../shared/types.ts';
import type { IInterfaceRepository, InterfaceCreateData, InterfaceUpdateData } from '../contracts/IInterfaceRepository.ts';
import { PgCrudRepository } from './PgCrudRepository.ts';

export class PgInterfaceRepository extends PgCrudRepository<NodeInterface, InterfaceCreateData, InterfaceUpdateData> implements IInterfaceRepository {
  protected readonly table = 'interfaces';
  protected readonly writableColumns = ['node_id', 'name', 'type', 'spec', 'description'] as const;
  protected override readonly orderBy = 'lower(name)';

  findByNodeAndName(nodeId: number, name: string): Promise<NodeInterface | null> {
    return this.db.get<NodeInterface>('SELECT * FROM interfaces WHERE node_id = ? AND name = ?', [nodeId, name]);
  }
}
