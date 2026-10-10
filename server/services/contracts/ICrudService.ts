/** Os inputs já chegam validados (zod) pela camada de entrada (controller/CLI). */
export interface ICrudService<TEntity, TCreate, TUpdate> {
  list(): Promise<TEntity[]>;
  get(id: number): Promise<TEntity>;
  create(input: TCreate): Promise<TEntity>;
  update(id: number, input: TUpdate): Promise<TEntity>;
  delete(id: number): Promise<void>;
}
