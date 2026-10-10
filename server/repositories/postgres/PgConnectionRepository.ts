import type { Connection } from '../../../shared/types.ts';
import type { ConnectionCreateData, ConnectionUpdateData, IConnectionRepository } from '../contracts/IConnectionRepository.ts';
import { PgCrudRepository } from './PgCrudRepository.ts';

export class PgConnectionRepository extends PgCrudRepository<Connection, ConnectionCreateData, ConnectionUpdateData> implements IConnectionRepository {
  protected readonly table = 'connections';
  protected readonly writableColumns = ['source_id', 'target_id', 'target_interface_id', 'parent_connection_id', 'protocol', 'description'] as const;

  findByEndpoints(sourceId: number, targetId: number, targetInterfaceId: number | null): Promise<Connection | null> {
    return this.db.get<Connection>('SELECT * FROM connections WHERE source_id = ? AND target_id = ? AND target_interface_id IS NOT DISTINCT FROM ?', [
      sourceId,
      targetId,
      targetInterfaceId,
    ]);
  }

  async deleteAll(): Promise<void> {
    await this.db.run('DELETE FROM connections');
  }
}
