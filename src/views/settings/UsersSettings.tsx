import type { FormEvent } from 'react';
import type { Role } from '../../../shared/constants.ts';
import { useUsersAdminViewModel } from '../../viewmodels/useUsersAdminViewModel.ts';
import { Field } from '../common/Field.tsx';
import { Section } from '../common/Section.tsx';

export function UsersSettings() {
  const vm = useUsersAdminViewModel();
  const { values, errors, set } = vm.form;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void vm.create();
  };

  return (
    <div className="settings-body">
      <table className="users-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Papel</th>
            <th>Último acesso</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {vm.users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'inactive'}>
              <td>
                {u.name} {vm.isMe(u) && <span className="tag subtle">você</span>}
              </td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} disabled={vm.busy} onChange={(e) => vm.changeRole(u, e.target.value as Role)}>
                  {vm.roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="muted small">{u.last_login_at ?? 'nunca'}</td>
              <td className="actions-cell">
                <button disabled={vm.busy || vm.isMe(u)} onClick={() => vm.toggleActive(u)}>
                  {u.active ? 'Desativar' : 'Reativar'}
                </button>
                <button disabled={vm.busy} onClick={() => vm.resetPassword(u)}>
                  Senha
                </button>
                <button className="danger" disabled={vm.busy || vm.isMe(u)} onClick={() => vm.remove(u)}>
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Section title="Novo usuário">
        <form className="row wrap" onSubmit={submit}>
          <Field label="Nome" error={errors.name}>
            <input value={values.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="E-mail" error={errors.email}>
            <input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Papel" error={errors.role}>
            <select value={values.role} onChange={(e) => set('role', e.target.value as Role)}>
              {vm.roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Senha inicial" error={errors.password}>
            <input type="password" autoComplete="new-password" value={values.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <button className="primary" disabled={vm.busy}>
            Criar
          </button>
        </form>
        <p className="hint">Leitor: vê o grafo e busca/pergunta nos documentos. Editor: também edita. Administrador: também gerencia usuários, LLM e pastas.</p>
      </Section>
    </div>
  );
}
