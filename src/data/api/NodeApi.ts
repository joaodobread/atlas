import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { GraphNode } from '../../../shared/types.ts';
import type { CreateNodeInput, UpdateNodeInput } from '../../../shared/schemas.ts';
import { CrudApi } from './CrudApi.ts';

export class NodeApi extends CrudApi<GraphNode, CreateNodeInput, UpdateNodeInput> {
  private static instance: NodeApi | undefined;

  private constructor(http: IHttpService) {
    super(http, '/nodes');
  }

  static getInstance(http: IHttpService = HttpService.getInstance()): NodeApi {
    return (NodeApi.instance ??= new NodeApi(http));
  }
}
