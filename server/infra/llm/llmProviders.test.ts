import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { AnthropicLlmProvider } from './AnthropicLlmProvider.ts';
import { extractJson, type ILlmProvider } from './ILlmProvider.ts';
import { LlmProviderFactory } from './LlmProviderFactory.ts';
import { NullLlmProvider } from './NullLlmProvider.ts';
import { OpenAiCompatibleLlmProvider } from './OpenAiCompatibleLlmProvider.ts';
import { SwitchableLlmProvider } from './SwitchableLlmProvider.ts';

// O cliente real do SDK não é necessário aqui (e exigiria credenciais no ambiente).
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }));

describe('extractJson', () => {
  it('lê JSON puro, cercado por ``` ou no meio do texto', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a": {"b": 2}}\n```')).toEqual({ a: { b: 2 } });
    expect(extractJson('```\n{"c":3}\n```')).toEqual({ c: 3 });
    expect(extractJson('Claro! {"d": [1]} pronto.')).toEqual({ d: [1] });
  });
  it('rejeita texto sem objeto JSON', () => {
    expect(() => extractJson('nada aqui')).toThrow('Resposta do LLM não contém JSON');
    expect(() => extractJson('} {')).toThrow('Resposta do LLM não contém JSON');
    expect(() => extractJson('{ inválido }')).toThrow(SyntaxError);
  });
});

describe('NullLlmProvider', () => {
  it('não está configurado e rejeita qualquer chamada', async () => {
    const p = new NullLlmProvider();
    expect(p).toMatchObject({ provider: 'none', model: null, configured: false });
    await expect(p.complete()).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(p.completeJson()).rejects.toThrow('Nenhum LLM configurado');
  });
});

describe('SwitchableLlmProvider', () => {
  it('começa sem LLM e delega ao provedor em uso', async () => {
    const s = new SwitchableLlmProvider();
    expect(s).toMatchObject({ provider: 'none', model: null, configured: false });
    await expect(s.complete({ system: '', messages: [] })).rejects.toBeInstanceOf(BusinessRuleError);

    const fake: ILlmProvider = {
      provider: 'openai-compatible',
      model: 'm1',
      configured: true,
      complete: vi.fn<ILlmProvider['complete']>(() => Promise.resolve('texto')),
      completeJson: <T>() => Promise.resolve({ ok: 1 } as T),
    };
    s.use(fake);
    expect(s).toMatchObject({ provider: 'openai-compatible', model: 'm1', configured: true });
    expect(await s.complete({ system: 'x', messages: [] })).toBe('texto');
    expect(await s.completeJson({ system: 'x', messages: [] }, { name: 'n', schema: {}, parse: (v) => v })).toEqual({ ok: 1 });
  });
});

describe('LlmProviderFactory', () => {
  const f = new LlmProviderFactory();
  it('cria o provedor de acordo com a configuração', () => {
    const a = f.create({ provider: 'anthropic', model: 'claude-x', apiKey: 'k', mentionsAuto: false });
    expect(a).toBeInstanceOf(AnthropicLlmProvider);
    expect(a.model).toBe('claude-x');
    expect(f.create({ provider: 'anthropic', model: 'claude-y', apiKey: null, mentionsAuto: false })).toBeInstanceOf(AnthropicLlmProvider);
    const o = f.create({ provider: 'openai-compatible', model: 'gpt', baseUrl: 'https://x.test', apiKey: null, mentionsAuto: true });
    expect(o).toBeInstanceOf(OpenAiCompatibleLlmProvider);
    expect(f.create({ provider: 'openai-compatible', model: 'gpt', baseUrl: 'https://x.test', apiKey: 'k', mentionsAuto: true }).model).toBe('gpt');
    expect(f.create({ provider: 'none', apiKey: null, mentionsAuto: false })).toBeInstanceOf(NullLlmProvider);
  });
});
