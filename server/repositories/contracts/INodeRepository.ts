import type { GraphNode } from '../../../shared/types.ts';
import type { ICrudRepository } from './ICrudRepository.ts';

export type NodeCreateData = Pick<GraphNode, 'name' | 'kind' | 'graph_id'> & Partial<Pick<GraphNode, 'parent_id' | 'tech' | 'icon' | 'description'>>;
export type NodeUpdateData = Partial<Pick<GraphNode, 'parent_id' | 'name' | 'kind' | 'tech' | 'icon' | 'description'>>;

export interface INodeRepository extends ICrudRepository<GraphNode, NodeCreateData, NodeUpdateData> {
  findByParentAndName(graphId: number, parentId: number | null, name: string): Promise<GraphNode | null>;
  findByGraph(graphId: number): Promise<GraphNode[]>;
  /** Grafo do nó (undefined se não existe). */
  graphOf(id: number): Promise<number | undefined>;
  /** undefined quando o nó não existe. */
  findParentId(id: number): Promise<number | null | undefined>;
  deleteByGraph(graphId: number): Promise<void>;
}
