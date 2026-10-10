import type { FormEvent } from 'react';
import type { LlmProviderKind } from '../../../shared/types.ts';
import { useLlmSettingsViewModel } from '../../viewmodels/useLlmSettingsViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Section } from '../common/Section.tsx';

const PROVIDERS: Array<{ value: LlmProviderKind; label: string }> = [
  { value: 'none', label: 'Desligado' },
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'openai-compatible', label: 'OpenAI-compatível (OpenRouter, OpenAI, Ollama, LM Studio…)' },
];

export function LlmSettings() {
  const vm = useLlmSettingsViewModel();
  const { values, errors, set } = vm.form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.save();
  };

  return (
    <div className="settings-body">
      <form className="settings-form" onSubmit={submit}>
        <Field label="Provedor" error={errors.provider}>
          <select value={values.provider} onChange={(e) => set('provider', e.target.value as LlmProviderKind)}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {vm.showBaseUrl && (
          <Field label="URL base da API" error={errors.baseUrl}>
            <input list="llm-base-urls" placeholder="https://…/v1" value={values.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
            <datalist id="llm-base-urls">
              {vm.baseUrlPresets.map((p) => (
                <option key={p.url} value={p.url}>
                  {p.label}
                </option>
              ))}
            </datalist>
          </Field>
        )}

        {vm.showModel && (
          <Field label="Modelo" error={errors.model}>
            <input list="llm-models" placeholder="id do modelo" value={values.model} onChange={(e) => set('model', e.target.value)} />
            <datalist id="llm-models">
              {vm.modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        )}

        {vm.showApiKey && (
          <Field label="Chave de API" error={errors.apiKey}>
            <input
              type="password"
              autoComplete="off"
              placeholder={vm.apiKeyPlaceholder}
              value={values.apiKey}
              disabled={values.clearApiKey}
              onChange={(e) => set('apiKey', e.target.value)}
            />
            {vm.current?.hasApiKey && (
              <label className="check">
                <input type="checkbox" checked={values.clearApiKey} onChange={(e) => set('clearApiKey', e.target.checked)} />
                Remover a chave salva
              </label>
            )}
            <span className="hint">Guardada criptografada (AES-256-GCM) e nunca devolvida pela API.</span>
          </Field>
        )}

        <label className="check">
          <input type="checkbox" checked={values.mentionsAuto} onChange={(e) => set('mentionsAuto', e.target.checked)} />
          Usar o LLM para identificar módulos citados nos documentos (pega erros de digitação e variações de nome)
        </label>

        <div className="row actions">
          <button className="primary" disabled={vm.busy || !vm.dirty}>
            Salvar
          </button>
          <button
            type="button"
            disabled={vm.busy || vm.dirty || values.provider === 'none'}
            onClick={() => void vm.runTest()}
            title={vm.dirty ? 'Salve antes de testar' : ''}
          >
            Testar conexão
          </button>
          {vm.current && <span className="muted small">Origem: {vm.current.source === 'env' ? '.env' : 'interface'}</span>}
        </div>
        {vm.test && (
          <p className={vm.test.ok ? 'test-ok' : 'field-error'}>
            {vm.test.ok ? `Funcionou em ${vm.test.latencyMs} ms — resposta: “${vm.test.reply}”` : `Falhou: ${vm.test.error}`}
          </p>
        )}
      </form>

      <Section title="Menções por LLM">
        <p className="hint">Status: {vm.mentionsLabel}</p>
        <div className="row">
          <button onClick={() => void vm.reprocess()} disabled={!vm.status?.llmMentions.enabled}>
            Reanalisar todos os documentos
          </button>
          <button onClick={() => void vm.refreshStatus()}>Atualizar status</button>
        </div>
      </Section>
    </div>
  );
}
