import Anthropic from '@anthropic-ai/sdk';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { extractJson, type ILlmProvider, type JsonOutputSpec, type LlmRequest } from './ILlmProvider.ts';

/** Claude via SDK oficial (Messages API). */
export class AnthropicLlmProvider implements ILlmProvider {
  readonly provider = 'anthropic' as const;
  readonly configured = true;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    // Sem chave explícita, o SDK resolve ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / perfil do `ant auth login`.
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  complete(request: LlmRequest): Promise<string> {
    return this.run(request);
  }

  /** Structured outputs: o modelo é restrito ao JSON Schema; a resposta ainda passa pelo zod. */
  async completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    const text = await this.run(request, { type: 'json_schema', schema: spec.schema });
    return spec.parse(extractJson(text));
  }

  private async run(request: LlmRequest, format?: Anthropic.Beta.BetaJSONOutputFormat): Promise<string> {
    // Streaming evita timeout em contextos/respostas longas; finalMessage() junta tudo.
    // fallbacks "default": se o modelo recusar por política, o servidor tenta outro modelo na mesma chamada.
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens ?? 16000,
      system: request.system,
      messages: request.messages,
      output_config: { effort: 'medium', ...(format ? { format } : {}) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new BusinessRuleError(`O modelo recusou responder${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`);
    }
    return message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
