import { useEffect, useState } from 'react';
import { updateLlmSettingsSchema } from '../../shared/schemas.ts';
import type { IndexStatus, LlmProviderKind, LlmSettingsView, LlmTestResult } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { SettingsApi } from '../data/api/SettingsApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useForm } from './useForm.ts';

interface LlmForm {
  provider: LlmProviderKind;
  model: string;
  baseUrl: string;
  /** Vazio = manter a chave salva. */
  apiKey: string;
  clearApiKey: boolean;
  mentionsAuto: boolean;
}

export const MODEL_SUGGESTIONS: Record<Exclude<LlmProviderKind, 'none'>, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  'openai-compatible': [],
};

export const BASE_URL_PRESETS = [
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Ollama (local)', url: 'http://localhost:11434/v1' },
  { label: 'LM Studio (local)', url: 'http://localhost:1234/v1' },
];

const toForm = (s: LlmSettingsView): LlmForm => ({
  provider: s.provider,
  model: s.model ?? '',
  baseUrl: s.baseUrl ?? '',
  apiKey: '',
  clearApiKey: false,
  mentionsAuto: s.mentionsAuto,
});

export function useLlmSettingsViewModel() {
  const pushToast = useUiStore((s) => s.pushToast);
  const [current, setCurrent] = useState<LlmSettingsView | null>(null);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [test, setTest] = useState<LlmTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm<LlmForm>({ provider: 'none', model: '', baseUrl: '', apiKey: '', clearApiKey: false, mentionsAuto: true });

  const loadStatus = () =>
    DocumentApi.getInstance()
      .status()
      .then(setStatus)
      .catch(() => undefined);

  useEffect(() => {
    SettingsApi.getInstance()
      .llm()
      .then((s) => {
        setCurrent(s);
        form.reset(toForm(s));
      })
      .catch((err) => pushToast('error', errorMessage(err)));
    void loadStatus();
  }, []);

  const save = async () => {
    const v = form.values;
    const input = form.validate(updateLlmSettingsSchema, {
      provider: v.provider,
      model: v.model || null,
      baseUrl: v.baseUrl || null,
      apiKey: v.clearApiKey ? null : v.apiKey.trim() ? v.apiKey.trim() : undefined,
      mentionsAuto: v.mentionsAuto,
    });
    if (!input) return false;
    setBusy(true);
    try {
      const saved = await SettingsApi.getInstance().updateLlm(input);
      setCurrent(saved);
      form.reset(toForm(saved));
      setTest(null);
      pushToast('success', 'Configuração salva');
      void DocsSync.getInstance().reload();
      return true;
    } catch (err) {
      pushToast('error', errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await SettingsApi.getInstance().testLlm());
    } catch (err) {
      setTest({ ok: false, latencyMs: 0, reply: null, error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const reprocess = async () => {
    try {
      setStatus(await SettingsApi.getInstance().reprocessMentions());
      pushToast('success', 'Reanálise das menções iniciada');
    } catch (err) {
      pushToast('error', errorMessage(err));
    }
  };

  const v = form.values;
  return {
    form,
    current,
    status,
    test,
    busy,
    dirty: current != null && JSON.stringify(toForm(current)) !== JSON.stringify(v),
    modelSuggestions: v.provider === 'none' ? [] : MODEL_SUGGESTIONS[v.provider],
    baseUrlPresets: BASE_URL_PRESETS,
    showModel: v.provider !== 'none',
    showBaseUrl: v.provider === 'openai-compatible',
    showApiKey: v.provider !== 'none',
    apiKeyPlaceholder: current?.hasApiKey ? `Salva (${current.apiKeyHint}) — deixe vazio para manter` : 'Cole a chave de API',
    mentionsLabel: !status
      ? ''
      : status.llmMentions.state === 'disabled'
        ? 'Desligada'
        : status.llmMentions.state === 'running'
          ? `Analisando… ${status.llmMentions.pendingDocuments} documento(s) na fila`
          : status.llmMentions.state === 'error'
            ? `Erro: ${status.llmMentions.error ?? ''}`
            : status.llmMentions.pendingDocuments
              ? `${status.llmMentions.pendingDocuments} documento(s) na fila`
              : 'Em dia',
    save,
    runTest,
    reprocess,
    refreshStatus: loadStatus,
  };
}
