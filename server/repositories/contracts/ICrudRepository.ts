export interface IReadRepository<TEntity> {
  findAll(): Promise<TEntity[]>;
  findById(id: number): Promise<TEntity | null>;
  exists(id: number): Promise<boolean>;
}

export interface IWriteRepository<TEntity, TCreate, TUpdate> {
  create(data: TCreate): Promise<TEntity>;
  /** Atualiza apenas os campos definidos (undefined = não altera). */
  update(id: number, data: TUpdate): Promise<TEntity>;
  delete(id: number): Promise<boolean>;
}

export interface ICrudRepository<TEntity, TCreate, TUpdate> extends IReadRepository<TEntity>, IWriteRepository<TEntity, TCreate, TUpdate> {}
