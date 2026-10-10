import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { CallSite } from '../../../shared/types.ts';
import type { CreateCallSiteInput, UpdateCallSiteInput } from '../../../shared/schemas.ts';
import { CrudApi } from './CrudApi.ts';

export class CallSiteApi extends CrudApi<CallSite, CreateCallSiteInput, UpdateCallSiteInput> {
  private static instance: CallSiteApi | undefined;

  private constructor(http: IHttpService) {
    super(http, '/call-sites');
  }

  static getInstance(http: IHttpService = HttpService.getInstance()): CallSiteApi {
    return (CallSiteApi.instance ??= new CallSiteApi(http));
  }
}
