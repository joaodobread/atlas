import { updateLlmSettingsSchema } from '../../../shared/schemas.ts';
import type { ILlmSettingsService } from '../../services/contracts/index.ts';
import type { HttpRequest } from '../HttpRequest.ts';
import { ok, type HttpResponse } from '../HttpResponse.ts';

export class SettingsController {
  constructor(private readonly llm: ILlmSettingsService) {}

  async getLlm(): Promise<HttpResponse> {
    return ok(this.llm.view());
  }

  async updateLlm(req: HttpRequest): Promise<HttpResponse> {
    return ok(await this.llm.update(updateLlmSettingsSchema.parse(req.body)));
  }

  async testLlm(): Promise<HttpResponse> {
    return ok(await this.llm.test());
  }
}
