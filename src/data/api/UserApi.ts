import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { User } from '../../../shared/types.ts';
import type { CreateUserInput, UpdateUserInput } from '../../../shared/schemas.ts';

export class UserApi {
  private static instance: UserApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): UserApi {
    return (UserApi.instance ??= new UserApi(http));
  }

  list(): Promise<User[]> {
    return this.http.get('/users');
  }

  create(input: CreateUserInput): Promise<User> {
    return this.http.post('/users', input);
  }

  update(id: number, input: UpdateUserInput): Promise<User> {
    return this.http.patch(`/users/${id}`, input);
  }

  remove(id: number): Promise<void> {
    return this.http.delete(`/users/${id}`);
  }
}
