import type { FormEvent } from 'react';
import { useGithubSettingsViewModel } from '../../viewmodels/useGithubSettingsViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Section } from '../common/Section.tsx';

export function GithubSettings() {
  const vm = useGithubSettingsViewModel();
  const { values, errors, set } = vm.form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.save();
  };

  return (
    <div className="settings-body">
      <form className="settings-form" onSubmit={submit}>
        <Field label="Organização ou usuário" error={errors.owner}>
          <input placeholder="minha-org" value={values.owner} onChange={(e) => set('owner', e.target.value)} />
        </Field>
        <Field label="Token" error={errors.token}>
          <input
            type="password"
            autoComplete="off"
            placeholder={vm.tokenPlaceholder}
            value={values.token}
            disabled={values.clearToken}
            onChange={(e) => set('token', e.target.value)}
          />
          {vm.current?.hasToken && (
            <label className="check">
              <input type="checkbox" checked={values.clearToken} onChange={(e) => set('clearToken', e.target.checked)} />
              Remover o token salvo
            </label>
          )}
          <span className="hint">
            Use um token fine-grained com acesso somente leitura a <em>Contents</em> e <em>Metadata</em>. Guardado criptografado (AES-256-GCM) e nunca devolvido
            pela API.
          </span>
        </Field>
        <div className="row">
          <Field label="Só com push nos últimos (meses)" error={errors.pushedWithinMonths}>
            <input
              className="narrow"
              inputMode="numeric"
              placeholder="todos"
              value={values.pushedWithinMonths}
              onChange={(e) => set('pushedWithinMonths', e.target.value)}
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={values.includeArchived} onChange={(e) => set('includeArchived', e.target.checked)} />
            Incluir arquivados
          </label>
          <label className="check">
            <input type="checkbox" checked={values.includeForks} onChange={(e) => set('includeForks', e.target.checked)} />
            Incluir forks
          </label>
        </div>
        <div className="row actions">
          <button className="primary" disabled={vm.busy || !vm.dirty}>
            Salvar
          </button>
          <button
            type="button"
            disabled={vm.busy || vm.dirty || !vm.current?.hasToken}
            onClick={() => void vm.runTest()}
            title={vm.dirty ? 'Salve antes de testar' : ''}
          >
            Testar conexão
          </button>
        </div>
        {vm.test && (
          <p className={vm.test.ok ? 'test-ok' : 'field-error'}>
            {vm.test.ok ? `Conectado como ${vm.test.login}: ${vm.test.repoCount} repositório(s) em ${values.owner}` : `Falhou: ${vm.test.error}`}
          </p>
        )}
      </form>

      <Section title="Métricas pelo workflow do GitHub">
        <p className="hint">
          Cada repositório pode enviar cobertura, resultados de testes (JUnit) e achados de SAST/DAST/SCA (SARIF — Semgrep, CodeQL, ZAP, Trivy, Rainforest…)
          para <code>POST {vm.apiBase}/metrics</code>. Crie um usuário <strong>editor</strong> só para o CI, gere um token de API em “Minha conta” e salve como
          secret <code>COMM_GRAPH_TOKEN</code>.
        </p>
        <pre className="code-block">{vm.workflow}</pre>
      </Section>
    </div>
  );
}
