import type { Connection } from '../../../shared/types.ts';
import type { ICrudRepository } from './ICrudRepository.ts';

export type ConnectionCreateData = Pick<Connection, 'source_id' | 'target_id'> &
  Partial<Pick<Connection, 'target_interface_id' | 'parent_connection_id' | 'protocol' | 'description'>>;
export type ConnectionUpdateData = Partial<Omit<Connection, 'id' | 'created_at'>>;

export interface IConnectionRepository extends ICrudRepository<Connection, ConnectionCreateData, ConnectionUpdateData> {
  findByEndpoints(sourceId: number, targetId: number, targetInterfaceId: number | null): Promise<Connection | null>;
  deleteAll(): Promise<void>;
}
