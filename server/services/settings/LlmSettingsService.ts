import type { AppConfig } from '../../config/AppConfig.ts';
import type { IEventBus } from '../../core/events/EventBus.ts';
import type { ILlmProviderFactory } from '../../infra/llm/LlmProviderFactory.ts';
import type { ISwitchableLlm } from '../../infra/llm/SwitchableLlmProvider.ts';
import type { ISecureSettingsStore } from '../../repositories/contracts/ISecureSettingsStore.ts';
import { storedLlmSettingsSchema, type StoredLlmSettings, type UpdateLlmSettingsInput } from '../../../shared/schemas.ts';
import type { LlmSettingsView, LlmTestResult } from '../../../shared/types.ts';
import type { ILlmSettingsService } from '../contracts/index.ts';

const KEY = 'llm';

/**
 * Configuração de LLM: valores salvos pela interface (tabela settings) ou, na falta deles, os do .env.
 * Ao salvar, o provedor em uso é trocado na hora.
 */
export class LlmSettingsService implements ILlmSettingsService {
  private settings: StoredLlmSettings;
  private source: LlmSettingsView['source'] = 'env';

  constructor(
    /** Criptografado em repouso (a chave de API nunca fica em texto puro no banco). */
    private readonly repo: ISecureSettingsStore,
    private readonly config: AppConfig,
    private readonly factory: ILlmProviderFactory,
    private readonly llm: ISwitchableLlm,
    private readonly events: IEventBus,
  ) {
    // Até o init() terminar vale o .env.
    this.settings = fromEnv(config);
    this.llm.use(this.factory.create(this.settings));
  }

  async init(): Promise<void> {
    const stored = storedLlmSettingsSchema.safeParse(await this.repo.get(KEY));
    if (stored.success) {
      this.settings = stored.data;
      this.source = 'database';
    } else {
      this.settings = fromEnv(this.config);
      this.source = 'env';
    }
    this.llm.use(this.factory.create(this.settings));
    this.events.emit('llm.changed');
  }

  view(): LlmSettingsView {
    const key = this.settings.apiKey;
    return {
      provider: this.settings.provider,
      model: this.settings.model ?? null,
      baseUrl: this.settings.baseUrl ?? null,
      hasApiKey: !!key,
      apiKeyHint: key ? `…${key.slice(-4)}` : null,
      mentionsAuto: this.settings.mentionsAuto,
      source: this.source,
    };
  }

  async update(input: UpdateLlmSettingsInput): Promise<LlmSettingsView> {
    const next = storedLlmSettingsSchema.parse({
      provider: input.provider,
      model: input.provider === 'none' ? null : (input.model ?? null),
      baseUrl: input.provider === 'openai-compatible' ? (input.baseUrl ?? null) : null,
      // undefined = mantém a chave atual; null = apaga.
      apiKey: input.apiKey === undefined ? this.settings.apiKey : input.apiKey,
      mentionsAuto: input.mentionsAuto,
    });
    await this.repo.set(KEY, next);
    this.settings = next;
    this.source = 'database';
    this.llm.use(this.factory.create(next));
    this.events.emit('llm.changed');
    return this.view();
  }

  mentionsEnabled(): boolean {
    return this.settings.mentionsAuto && this.llm.configured;
  }

  async test(): Promise<LlmTestResult> {
    const started = Date.now();
    try {
      const reply = await this.llm.complete({
        system: 'Você é um teste de conectividade.',
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        maxTokens: 2000,
      });
      return { ok: true, latencyMs: Date.now() - started, reply: reply.trim().slice(0, 200), error: null };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, reply: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function fromEnv(config: AppConfig): StoredLlmSettings {
  const llm = config.llm;
  return {
    provider: llm.provider,
    model: llm.provider === 'none' ? null : llm.model,
    baseUrl: llm.provider === 'openai-compatible' ? llm.baseUrl : null,
    apiKey: llm.provider === 'none' ? null : (llm.apiKey ?? null),
    mentionsAuto: config.llmMentions,
  };
}
