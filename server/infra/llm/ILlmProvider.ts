export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

/** Saída estruturada: JSON Schema enviado ao modelo + validação (zod) da resposta. */
export interface JsonOutputSpec<T> {
  name: string;
  schema: Record<string, unknown>;
  parse(value: unknown): T;
}

export interface ILlmProvider {
  readonly provider: 'anthropic' | 'openai-compatible' | 'none';
  readonly model: string | null;
  readonly configured: boolean;
  /** Gera a resposta completa em texto. */
  complete(request: LlmRequest): Promise<string>;
  /** Gera uma resposta JSON no formato do schema, já validada. */
  completeJson<T>(request: LlmRequest, spec: JsonOutputSpec<T>): Promise<T>;
}

/** Extrai o primeiro objeto JSON de um texto (tolera cercas ``` de modelos sem saída estruturada). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Resposta do LLM não contém JSON');
  return JSON.parse(body.slice(start, end + 1));
}
