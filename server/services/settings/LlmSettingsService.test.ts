import { describe, expect, it, vi } from 'vitest';
import type { StoredLlmSettings } from '../../../shared/schemas.ts';
import { AppConfig } from '../../config/AppConfig.ts';
import { EventBus } from '../../core/events/EventBus.ts';
import type { ILlmProvider, LlmRequest } from '../../infra/llm/ILlmProvider.ts';
import type { ILlmProviderFactory } from '../../infra/llm/LlmProviderFactory.ts';
import type { ISwitchableLlm } from '../../infra/llm/SwitchableLlmProvider.ts';
import type { ISecureSettingsStore } from '../../repositories/contracts/ISecureSettingsStore.ts';
import { LlmSettingsService } from './LlmSettingsService.ts';

class MemoryStore implements ISecureSettingsStore {
  readonly data = new Map<string, unknown>();
  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key) ?? null);
  }
  set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

class FakeProvider implements ILlmProvider {
  constructor(readonly settings: StoredLlmSettings) {}
  get provider() {
    return this.settings.provider;
  }
  get model() {
    return this.settings.model ?? null;
  }
  get configured() {
    return this.settings.provider !== 'none';
  }
  complete(): Promise<string> {
    return Promise.resolve('x');
  }
  completeJson<T>(): Promise<T> {
    return Promise.reject(new Error('não usado'));
  }
}

class FakeFactory implements ILlmProviderFactory {
  readonly created: StoredLlmSettings[] = [];
  create(settings: StoredLlmSettings): ILlmProvider {
    this.created.push(settings);
    return new FakeProvider(settings);
  }
}

class FakeSwitchable implements ISwitchableLlm {
  current: ILlmProvider | null = null;
  reply: () => Promise<string> = () => Promise.resolve('  OK  ');
  readonly requests: LlmRequest[] = [];
  use(p: ILlmProvider): void {
    this.current = p;
  }
  get provider() {
    return this.current!.provider;
  }
  get model() {
    return this.current!.model;
  }
  get configured() {
    return this.current!.configured;
  }
  complete(request: LlmRequest): Promise<string> {
    this.requests.push(request);
    return this.reply();
  }
  completeJson<T>(): Promise<T> {
    return Promise.reject(new Error('não usado'));
  }
}

const config = (env: Record<string, string>) => AppConfig.fromEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', ...env });

function build(env: Record<string, string> = {}) {
  const store = new MemoryStore();
  const factory = new FakeFactory();
  const llm = new FakeSwitchable();
  const events = new EventBus();
  const changed = vi.fn<() => void>();
  events.on('llm.changed', changed);
  const service = new LlmSettingsService(store, config(env), factory, llm, events);
  return { store, factory, llm, events, changed, service };
}

describe('LlmSettingsService', () => {
  it('no construtor usa o .env (provider none) sem emitir evento', () => {
    const { service, factory, llm, changed } = build();
    expect(factory.created).toHaveLength(1);
    expect(llm.current).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(service.view()).toEqual({
      provider: 'none',
      model: null,
      baseUrl: null,
      hasApiKey: false,
      apiKeyHint: null,
      mentionsAuto: false,
      source: 'env',
    });
    expect(service.mentionsEnabled()).toBe(false);
  });

  it('init sem nada salvo mantém o .env (anthropic) e emite llm.changed', async () => {
    const { service, changed, factory } = build({ LLM_PROVIDER: 'anthropic', LLM_MODEL: 'claude-x', LLM_API_KEY: 'sk-abcdef1234' });
    await service.init();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(factory.created.at(-1)).toMatchObject({ provider: 'anthropic', model: 'claude-x', apiKey: 'sk-abcdef1234', baseUrl: null });
    expect(service.view()).toMatchObject({ provider: 'anthropic', model: 'claude-x', hasApiKey: true, apiKeyHint: '…1234', mentionsAuto: true, source: 'env' });
    expect(service.mentionsEnabled()).toBe(true);
  });

  it('openai-compatible do .env traz a baseUrl; sem chave a chave fica null', () => {
    const { service } = build({ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm', LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MENTIONS: 'off' });
    expect(service.view()).toMatchObject({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', hasApiKey: false, mentionsAuto: false });
    expect(service.mentionsEnabled()).toBe(false);
  });

  it('init usa o que foi salvo no banco quando é válido', async () => {
    const { service, store, llm } = build();
    store.data.set('llm', { provider: 'anthropic', model: 'salvo', baseUrl: null, apiKey: 'chave-9999', mentionsAuto: false });
    await service.init();
    expect(service.view()).toMatchObject({ provider: 'anthropic', model: 'salvo', apiKeyHint: '…9999', source: 'database', mentionsAuto: false });
    expect(llm.current?.provider).toBe('anthropic');
  });

  it('init ignora configuração salva inválida e volta ao .env', async () => {
    const { service, store } = build();
    store.data.set('llm', { provider: 'anthropic', model: null, apiKey: null, mentionsAuto: true });
    await service.init();
    expect(service.view()).toMatchObject({ provider: 'none', source: 'env' });
  });

  it('update salva, troca o provedor e mantém a chave quando apiKey vem undefined', async () => {
    const { service, store, changed, llm } = build({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-env-0000' });
    const view = await service.update({ provider: 'anthropic', model: 'novo', mentionsAuto: true });
    expect(view).toMatchObject({ provider: 'anthropic', model: 'novo', apiKeyHint: '…0000', source: 'database' });
    expect(store.data.get('llm')).toMatchObject({ apiKey: 'sk-env-0000', model: 'novo', baseUrl: null });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(llm.current?.model).toBe('novo');
  });

  it('update com apiKey null apaga a chave; com string troca', async () => {
    const { service, store } = build({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'sk-env-0000' });
    await service.update({ provider: 'openai-compatible', model: 'gpt', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'nova-5678', mentionsAuto: false });
    expect(service.view()).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', apiKeyHint: '…5678' });
    await service.update({ provider: 'anthropic', model: 'c', baseUrl: 'https://ignorada.example', apiKey: null, mentionsAuto: false });
    expect(service.view()).toMatchObject({ baseUrl: null, hasApiKey: false, apiKeyHint: null });
    expect(store.data.get('llm')).toMatchObject({ apiKey: null, baseUrl: null });
  });

  it('update para none zera o modelo', async () => {
    const { service } = build({ LLM_PROVIDER: 'anthropic' });
    const view = await service.update({ provider: 'none', model: 'ignorado', mentionsAuto: true });
    expect(view).toMatchObject({ provider: 'none', model: null });
    expect(service.mentionsEnabled()).toBe(false);
  });

  it('update com configuração inválida falha sem salvar', async () => {
    const { service, store, changed } = build();
    await expect(service.update({ provider: 'openai-compatible', model: 'x', mentionsAuto: false })).rejects.toThrow('Informe a URL base da API');
    expect(store.data.size).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });

  it('test() devolve a resposta aparada em caso de sucesso', async () => {
    const { service, llm } = build();
    llm.reply = () => Promise.resolve(`  ${'a'.repeat(300)}  `);
    const r = await service.test();
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.reply).toBe('a'.repeat(200));
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(llm.requests[0]?.messages[0]?.content).toContain('OK');
  });

  it('test() devolve o erro em caso de falha (Error ou valor qualquer)', async () => {
    const { service, llm } = build();
    llm.reply = () => Promise.reject(new Error('sem rede'));
    expect(await service.test()).toMatchObject({ ok: false, reply: null, error: 'sem rede' });
    llm.reply = () => Promise.reject('texto');
    expect(await service.test()).toMatchObject({ ok: false, error: 'texto' });
  });
});
