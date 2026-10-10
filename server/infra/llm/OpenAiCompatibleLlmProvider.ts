import { z } from 'zod';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { extractJson, type ILlmProvider, type JsonOutputSpec, type LlmRequest } from './ILlmProvider.ts';

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
});

/** Qualquer API no formato /chat/completions: OpenRouter, OpenAI, Ollama, LM Studio, vLLM... */
export class OpenAiCompatibleLlmProvider implements ILlmProvider {
  readonly provider = 'openai-compatible' as const;
  readonly configured = true;

  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  complete(request: LlmRequest): Promise<string> {
    return this.run(request);
  }

  /**
   * Tenta `response_format: json_schema` (OpenAI, OpenRouter, Ollama, LM Studio recentes);
   * se o servidor não suportar, repete só com a instrução no prompt. A resposta sempre passa pelo zod.
   */
  async completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T> {
    const responseFormat = { type: 'json_schema', json_schema: { name: spec.name, schema: spec.schema, strict: true } };
    let text: string;
    try {
      text = await this.run(request, responseFormat);
    } catch (err) {
      if (!(err instanceof UnsupportedFormatError)) throw err;
      text = await this.run({
        ...request,
        system: `${request.system}\n\nResponda SOMENTE com um objeto JSON válido neste JSON Schema:\n${JSON.stringify(spec.schema)}`,
      });
    }
    return spec.parse(extractJson(text));
  }

  private async run(request: LlmRequest, responseFormat?: object): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 4000,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (responseFormat && (res.status === 400 || res.status === 422)) throw new UnsupportedFormatError(body);
      throw new BusinessRuleError(`LLM respondeu ${res.status}: ${body.slice(0, 300)}`);
    }
    const parsed = chatResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new BusinessRuleError('Resposta do LLM em formato inesperado');
    return parsed.data.choices[0]!.message.content ?? '';
  }
}

class UnsupportedFormatError extends Error {}
