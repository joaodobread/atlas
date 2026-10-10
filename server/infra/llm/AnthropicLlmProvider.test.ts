import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError } from '../../core/errors/AppError.ts';

interface FakeMessage {
  stop_reason: string;
  stop_details?: { category?: string } | null;
  content: Array<{ type: string; text?: string }>;
}

const sdk = vi.hoisted(() => ({
  constructed: [] as unknown[],
  stream: vi.fn<(params: Record<string, unknown>) => { finalMessage: () => Promise<FakeMessage> }>(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    readonly beta = { messages: { stream: sdk.stream } };
    constructor(...args: unknown[]) {
      sdk.constructed.push(args);
    }
  },
}));

const { AnthropicLlmProvider } = await import('./AnthropicLlmProvider.ts');

const reply = (message: FakeMessage) => sdk.stream.mockReturnValueOnce({ finalMessage: () => Promise.resolve(message) });

describe('AnthropicLlmProvider', () => {
  beforeEach(() => {
    sdk.constructed.length = 0;
    sdk.stream.mockReset();
  });

  it('cria o cliente com a chave informada ou com a resolução padrão do SDK', () => {
    const a = new AnthropicLlmProvider('claude-x', 'sk-test');
    const b = new AnthropicLlmProvider('claude-y');
    expect(sdk.constructed).toEqual([[{ apiKey: 'sk-test' }], []]);
    expect(a).toMatchObject({ provider: 'anthropic', configured: true, model: 'claude-x' });
    expect(b.model).toBe('claude-y');
  });

  it('complete envia a requisição em streaming e junta os blocos de texto', async () => {
    reply({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: 'Olá, ' }, { type: 'text', text: 'mundo' }] });
    const p = new AnthropicLlmProvider('claude-x', 'k');
    const out = await p.complete({ system: 'sys', messages: [{ role: 'user', content: 'oi' }] });
    expect(out).toBe('Olá, mundo');
    expect(sdk.stream).toHaveBeenCalledWith({
      model: 'claude-x',
      max_tokens: 16000,
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('completeJson envia o JSON Schema e valida a resposta', async () => {
    reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok": true}' }] });
    const p = new AnthropicLlmProvider('claude-x', 'k');
    const schema = { type: 'object' };
    const parse = vi.fn<(v: unknown) => { ok: boolean }>((v) => v as { ok: boolean });
    const out = await p.completeJson({ system: 's', messages: [], maxTokens: 50 }, { name: 'n', schema, parse });
    expect(out).toEqual({ ok: true });
    expect(parse).toHaveBeenCalledWith({ ok: true });
    expect(sdk.stream.mock.calls[0]![0]).toMatchObject({ max_tokens: 50, output_config: { effort: 'medium', format: { type: 'json_schema', schema } } });
  });

  it('recusa do modelo vira BusinessRuleError (com e sem categoria)', async () => {
    const p = new AnthropicLlmProvider('claude-x', 'k');
    reply({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] });
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow(new BusinessRuleError('O modelo recusou responder (cyber).'));
    reply({ stop_reason: 'refusal', stop_details: null, content: [] });
    await expect(p.complete({ system: 's', messages: [] })).rejects.toThrow('O modelo recusou responder.');
  });
});
