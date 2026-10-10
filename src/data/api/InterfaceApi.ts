import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { NodeInterface } from '../../../shared/types.ts';
import type { CreateInterfaceInput, UpdateInterfaceInput } from '../../../shared/schemas.ts';
import { CrudApi } from './CrudApi.ts';

export class InterfaceApi extends CrudApi<NodeInterface, CreateInterfaceInput, UpdateInterfaceInput> {
  private static instance: InterfaceApi | undefined;

  private constructor(http: IHttpService) {
    super(http, '/interfaces');
  }

  static getInstance(http: IHttpService = HttpService.getInstance()): InterfaceApi {
    return (InterfaceApi.instance ??= new InterfaceApi(http));
  }
}
