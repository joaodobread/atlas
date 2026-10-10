import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { Connection } from '../../../shared/types.ts';
import type { CreateConnectionInput, UpdateConnectionInput } from '../../../shared/schemas.ts';
import { CrudApi } from './CrudApi.ts';

export class ConnectionApi extends CrudApi<Connection, CreateConnectionInput, UpdateConnectionInput> {
  private static instance: ConnectionApi | undefined;

  private constructor(http: IHttpService) {
    super(http, '/connections');
  }

  static getInstance(http: IHttpService = HttpService.getInstance()): ConnectionApi {
    return (ConnectionApi.instance ??= new ConnectionApi(http));
  }
}
