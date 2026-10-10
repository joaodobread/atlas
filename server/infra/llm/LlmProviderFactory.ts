import type { StoredLlmSettings } from '../../../shared/schemas.ts';
import { AnthropicLlmProvider } from './AnthropicLlmProvider.ts';
import type { ILlmProvider } from './ILlmProvider.ts';
import { NullLlmProvider } from './NullLlmProvider.ts';
import { OpenAiCompatibleLlmProvider } from './OpenAiCompatibleLlmProvider.ts';

export interface ILlmProviderFactory {
  create(settings: StoredLlmSettings): ILlmProvider;
}

/** Fábrica dos provedores concretos a partir da configuração (usada quando ela muda em runtime). */
export class LlmProviderFactory implements ILlmProviderFactory {
  create(s: StoredLlmSettings): ILlmProvider {
    switch (s.provider) {
      case 'anthropic':
        return new AnthropicLlmProvider(s.model!, s.apiKey ?? undefined);
      case 'openai-compatible':
        return new OpenAiCompatibleLlmProvider(s.model!, s.baseUrl!, s.apiKey ?? undefined);
      default:
        return new NullLlmProvider();
    }
  }
}
