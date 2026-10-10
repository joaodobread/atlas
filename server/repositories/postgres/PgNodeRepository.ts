import type { GraphNode } from '../../../shared/types.ts';
import type { INodeRepository, NodeCreateData, NodeUpdateData } from '../contracts/INodeRepository.ts';
import { PgCrudRepository } from './PgCrudRepository.ts';

export class PgNodeRepository extends PgCrudRepository<GraphNode, NodeCreateData, NodeUpdateData> implements INodeRepository {
  protected readonly table = 'nodes';
  protected readonly writableColumns = ['graph_id', 'parent_id', 'name', 'kind', 'tech', 'icon', 'description'] as const;
  protected override readonly orderBy = 'lower(name), id';
  protected override readonly touchUpdatedAt = true;

  findByParentAndName(graphId: number, parentId: number | null, name: string): Promise<GraphNode | null> {
    return this.db.get<GraphNode>('SELECT * FROM nodes WHERE graph_id = ? AND parent_id IS NOT DISTINCT FROM ? AND name = ?', [graphId, parentId, name]);
  }

  findByGraph(graphId: number): Promise<GraphNode[]> {
    return this.db.all<GraphNode>('SELECT * FROM nodes WHERE graph_id = ? ORDER BY lower(name), id', [graphId]);
  }

  async graphOf(id: number): Promise<number | undefined> {
    return (await this.db.get<{ graph_id: number }>('SELECT graph_id FROM nodes WHERE id = ?', [id]))?.graph_id;
  }

  async findParentId(id: number): Promise<number | null | undefined> {
    const row = await this.db.get<{ parent_id: number | null }>('SELECT parent_id FROM nodes WHERE id = ?', [id]);
    return row ? row.parent_id : undefined;
  }

  async deleteByGraph(graphId: number): Promise<void> {
    await this.db.run('DELETE FROM nodes WHERE graph_id = ?', [graphId]);
  }
}
