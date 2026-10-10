import type { FormEvent } from 'react';
import { useAuthFormViewModel } from '../../viewmodels/useAuthFormViewModel.ts';
import { Field } from '../common/Field.tsx';

export function AuthScreen({ mode }: { mode: 'login' | 'setup' }) {
  const vm = useAuthFormViewModel(mode);
  const { values, errors, set } = vm.form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.submit();
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>Comm Graph</h1>
        {mode === 'setup' ? (
          <p className="muted">Primeiro acesso: crie a conta de administrador desta instalação.</p>
        ) : (
          <p className="muted">Entre para continuar.</p>
        )}
        {mode === 'setup' && (
          <Field label="Nome" error={errors.name}>
            <input autoFocus value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field label="E-mail" error={errors.email}>
          <input
            autoFocus={mode === 'login'}
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            autoComplete={mode === 'login' ? 'username' : 'email'}
          />
        </Field>
        <Field label="Senha" error={errors.password}>
          <input
            type="password"
            value={values.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Field>
        {mode === 'setup' && (
          <Field label="Confirmar senha">
            <input type="password" value={values.confirm} onChange={(e) => set('confirm', e.target.value)} autoComplete="new-password" />
          </Field>
        )}
        {vm.error && <p className="field-error">{vm.error}</p>}
        <button className="primary" disabled={vm.busy}>
          {mode === 'setup' ? 'Criar administrador' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
