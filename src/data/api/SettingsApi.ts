import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type { IndexStatus, LlmSettingsView, LlmTestResult } from '../../../shared/types.ts';
import type { UpdateLlmSettingsInput } from '../../../shared/schemas.ts';

export class SettingsApi {
  private static instance: SettingsApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): SettingsApi {
    return (SettingsApi.instance ??= new SettingsApi(http));
  }

  llm(): Promise<LlmSettingsView> {
    return this.http.get('/settings/llm');
  }

  updateLlm(input: UpdateLlmSettingsInput): Promise<LlmSettingsView> {
    return this.http.put('/settings/llm', input);
  }

  testLlm(): Promise<LlmTestResult> {
    return this.http.post('/settings/llm/test');
  }

  reprocessMentions(): Promise<IndexStatus> {
    return this.http.post('/mentions/reprocess');
  }
}
