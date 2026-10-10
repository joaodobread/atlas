import type { FormEvent } from 'react';
import { useAccountViewModel } from '../../viewmodels/useAccountViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Section } from '../common/Section.tsx';

export function AccountSettings() {
  const vm = useAccountViewModel();
  const pf = vm.passwordForm;
  const tf = vm.tokenForm;

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void vm.changePassword();
  };
  const submitToken = (e: FormEvent) => {
    e.preventDefault();
    void vm.createToken();
  };

  return (
    <div className="settings-body">
      <p>
        {vm.user?.name} <span className="muted">· {vm.user?.email}</span> <span className="tag">{vm.roleLabel}</span>
      </p>

      <Section title="Trocar senha">
        <form className="settings-form" onSubmit={submitPassword}>
          <Field label="Senha atual" error={pf.errors.currentPassword}>
            <input
              type="password"
              autoComplete="current-password"
              value={pf.values.currentPassword}
              onChange={(e) => pf.set('currentPassword', e.target.value)}
            />
          </Field>
          <div className="row">
            <Field label="Nova senha" error={pf.errors.newPassword}>
              <input type="password" autoComplete="new-password" value={pf.values.newPassword} onChange={(e) => pf.set('newPassword', e.target.value)} />
            </Field>
            <Field label="Confirmar">
              <input type="password" autoComplete="new-password" value={pf.values.confirm} onChange={(e) => pf.set('confirm', e.target.value)} />
            </Field>
          </div>
          <button className="primary">Alterar senha</button>
        </form>
      </Section>

      <Section title="Tutorial">
        <p className="hint">Rever o passo a passo do primeiro acesso.</p>
        <button onClick={vm.restartTour}>Ver o tutorial de novo</button>
      </Section>

      <Section title="Tokens de API" count={vm.tokens.length}>
        <p className="hint">
          Para scripts e para o LLM importar dados: envie <code>Authorization: Bearer &lt;token&gt;</code>. O token tem as mesmas permissões que você.
        </p>
        {vm.created && (
          <div className="token-created">
            <p>Copie agora — ele não será mostrado de novo:</p>
            <code className="token">{vm.created.token}</code>
            <div className="row">
              <button className="primary" onClick={() => void vm.copyCreated()}>
                Copiar
              </button>
              <button onClick={vm.dismissCreated}>Ok, guardei</button>
            </div>
          </div>
        )}
        <ul className="list">
          {vm.tokens.map((t) => (
            <li key={t.id}>
              <span>
                {t.name} <code className="muted">{t.prefix}…</code>
                <span className="note">
                  criado {t.created_at} · {t.last_used_at ? `usado ${t.last_used_at}` : 'nunca usado'}
                </span>
              </span>
              <button className="icon" title="Revogar" onClick={() => void vm.revoke(t)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={submitToken}>
          <Field error={tf.errors.name}>
            <input placeholder="Nome do token (ex.: importador CI)" value={tf.values.name} onChange={(e) => tf.set('name', e.target.value)} />
          </Field>
          <button>Gerar</button>
        </form>
      </Section>
    </div>
  );
}
