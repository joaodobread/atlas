import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { OpenAiCompatibleLlmProvider } from './OpenAiCompatibleLlmProvider.ts';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const chat = (content: string | null) => json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1]!.body as string) as Record<string, unknown>;
const headersOf = (call: number) => fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;

describe('OpenAiCompatibleLlmProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chama /chat/completions com o prompt de sistema e a chave', async () => {
    fetchMock.mockResolvedValueOnce(chat('resposta'));
    const p = new OpenAiCompatibleLlmProvider('gpt-x', 'https://llm.test/v1/', 'sk-1');
    expect(p).toMatchObject({ provider: 'openai-compatible', configured: true, model: 'gpt-x' });
    expect(await p.complete({ system: 'sys', messages: [{ role: 'user', content: 'oi' }] })).toBe('resposta');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://llm.test/v1/chat/completions');
    expect(headersOf(0)).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-1' });
    expect(bodyOf(0)).toEqual({
      model: 'gpt-x',
      max_tokens: 4000,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'oi' },
      ],
    });
  });

  it('sem chave não envia Authorization; conteúdo null vira texto vazio', async () => {
    fetchMock.mockResolvedValueOnce(chat(null));
    const p = new OpenAiCompatibleLlmProvider('local', 'http://localhost:11434/v1');
    expect(await p.complete({ system: 's', messages: [], maxTokens: 10 })).toBe('');
    expect(headersOf(0)).toEqual({ 'Content-Type': 'application/json' });
    expect(bodyOf(0).max_tokens).toBe(10);
  });

  it('erros HTTP e respostas em formato inesperado viram BusinessRuleError', async () => {
    const p = new OpenAiCompatibleLlmProvider('m', 'https://llm.test');
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(400), { status: 500 }));
    const err = await p.complete({ system: 's', messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as Error).message).toBe(`LLM respondeu 500: ${'x'.repeat(300)}`);

    fetchMock.mockResolvedValueOnce(json({ choices: [] }));
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow('Resposta do LLM em formato inesperado');

    // 400 sem response_format não é tratado como formato não suportado.
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow('LLM respondeu 400: bad');
  });

  it('tolera falha ao ler o corpo do erro', async () => {
    const res = new Response('ignored', { status: 503 });
    vi.spyOn(res, 'text').mockRejectedValue(new Error('stream'));
    fetchMock.mockResolvedValueOnce(res);
    await expect(new OpenAiCompatibleLlmProvider('m', 'https://llm.test').complete({ system: 's', messages: [] })).rejects.toThrow('LLM respondeu 503: ');
  });

  it('completeJson usa response_format json_schema e valida com o parse', async () => {
    fetchMock.mockResolvedValueOnce(chat('```json\n{"a": 1}\n```'));
    const p = new OpenAiCompatibleLlmProvider('m', 'https://llm.test');
    const schema = { type: 'object' };
    const out = await p.completeJson({ system: 's', messages: [] }, { name: 'resp', schema, parse: (v) => v as { a: number } });
    expect(out).toEqual({ a: 1 });
    expect(bodyOf(0).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'resp', schema, strict: true } });
  });

  it.each([400, 422])('completeJson repete só com o prompt quando o servidor responde %i ao json_schema', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('response_format não suportado', { status })).mockResolvedValueOnce(chat('aqui: {"b": 2} fim'));
    const p = new OpenAiCompatibleLlmProvider('m', 'https://llm.test');
    const out = await p.completeJson({ system: 'sys', messages: [] }, { name: 'r', schema: { type: 'object' }, parse: (v) => v });
    expect(out).toEqual({ b: 2 });
    const retry = bodyOf(1);
    expect(retry.response_format).toBeUndefined();
    expect((retry.messages as Array<{ content: string }>)[0]!.content).toBe(
      'sys\n\nResponda SOMENTE com um objeto JSON válido neste JSON Schema:\n{"type":"object"}',
    );
  });

  it('completeJson propaga outros erros sem repetir', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 502 }));
    const p = new OpenAiCompatibleLlmProvider('m', 'https://llm.test');
    await expect(p.completeJson({ system: 's', messages: [] }, { name: 'r', schema: {}, parse: (v) => v })).rejects.toThrow('LLM respondeu 502: down');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
