import type { IHttpService } from '../../core/http/IHttpService.ts';

/** Base para APIs REST de um recurso. As subclasses são singletons. */
export abstract class CrudApi<TEntity, TCreate, TUpdate> {
  protected constructor(
    protected readonly http: IHttpService,
    private readonly resource: string,
  ) {}

  list(): Promise<TEntity[]> {
    return this.http.get<TEntity[]>(this.resource);
  }

  get(id: number): Promise<TEntity> {
    return this.http.get<TEntity>(`${this.resource}/${id}`);
  }

  create(input: TCreate): Promise<TEntity> {
    return this.http.post<TEntity>(this.resource, input);
  }

  update(id: number, input: TUpdate): Promise<TEntity> {
    return this.http.patch<TEntity>(`${this.resource}/${id}`, input);
  }

  remove(id: number): Promise<void> {
    return this.http.delete(`${this.resource}/${id}`);
  }
}
