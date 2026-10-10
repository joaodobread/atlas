import type { ZodType } from 'zod';
import { idParamSchema } from '../../../shared/schemas.ts';
import type { ICrudService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, noContent, ok, type HttpResponse } from '../HttpResponse.ts';

type Schema<T> = ZodType<T, unknown>;

/** Controller CRUD genérico: valida a entrada com zod e delega ao service. */
export abstract class CrudController<TEntity, TCreate, TUpdate> {
  constructor(
    protected readonly service: ICrudService<TEntity, TCreate, TUpdate>,
    private readonly createSchema: Schema<TCreate>,
    private readonly updateSchema: Schema<TUpdate>,
  ) {}

  async list(): Promise<HttpResponse> {
    return ok(await this.service.list());
  }

  async show(req: HttpRequest): Promise<HttpResponse> {
    return ok<unknown>(await this.service.get(idParamSchema.parse(req.params.id)));
  }

  async create(req: HttpRequest): Promise<HttpResponse> {
    return created<unknown>(await this.service.create(this.createSchema.parse(req.body)));
  }

  async update(req: HttpRequest): Promise<HttpResponse> {
    return ok<unknown>(await this.service.update(idParamSchema.parse(req.params.id), this.updateSchema.parse(req.body)));
  }

  async destroy(req: HttpRequest): Promise<HttpResponse> {
    await this.service.delete(idParamSchema.parse(req.params.id));
    return noContent();
  }
}
