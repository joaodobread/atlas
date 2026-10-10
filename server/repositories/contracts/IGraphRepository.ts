import type { GraphInfo } from '../../../shared/types.ts';

export interface IGraphRepository {
  list(): Promise<GraphInfo[]>;
  findById(id: number): Promise<GraphInfo | null>;
  findByName(name: string): Promise<GraphInfo | null>;
  create(name: string, description: string | null): Promise<GraphInfo>;
  update(id: number, data: { name?: string; description?: string | null }): Promise<GraphInfo>;
  /** Remove o grafo e, em cascata, seus nós/conexões. */
  delete(id: number): Promise<boolean>;
  count(): Promise<number>;
}
