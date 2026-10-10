import type { NodeInterface } from '../../../shared/types.ts';
import type { ICrudRepository } from './ICrudRepository.ts';

export type InterfaceCreateData = Pick<NodeInterface, 'node_id' | 'name'> & Partial<Pick<NodeInterface, 'type' | 'spec' | 'description'>>;
export type InterfaceUpdateData = Partial<Pick<NodeInterface, 'name' | 'type' | 'spec' | 'description'>>;

export interface IInterfaceRepository extends ICrudRepository<NodeInterface, InterfaceCreateData, InterfaceUpdateData> {
  findByNodeAndName(nodeId: number, name: string): Promise<NodeInterface | null>;
}
