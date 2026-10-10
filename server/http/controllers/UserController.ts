import { createUserSchema, idParamSchema, updateUserSchema } from '../../../shared/schemas.ts';
import type { IUserService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { created, noContent, ok, type HttpResponse } from '../HttpResponse.ts';

export class UserController {
  constructor(private readonly users: IUserService) {}

  async list(): Promise<HttpResponse> {
    return ok(await this.users.list());
  }

  async create(req: HttpRequest): Promise<HttpResponse> {
    return created(await this.users.create(createUserSchema.parse(req.body)));
  }

  async update(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.users.update(req.user!, idParamSchema.parse(req.params.id), updateUserSchema.parse(req.body)));
  }

  async destroy(req: HttpRequest): Promise<HttpResponse> {
    await this.users.delete(req.user!, idParamSchema.parse(req.params.id));
    return noContent();
  }
}
