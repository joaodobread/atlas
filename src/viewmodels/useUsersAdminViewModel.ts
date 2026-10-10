import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABEL, type Role } from '../../shared/constants.ts';
import { createUserSchema, updateUserSchema } from '../../shared/schemas.ts';
import type { User } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { UserApi } from '../data/api/UserApi.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useForm } from './useForm.ts';

interface NewUserForm {
  name: string;
  email: string;
  role: Role;
  password: string;
}
const emptyUser: NewUserForm = { name: '', email: '', role: 'viewer', password: '' };

export function useUsersAdminViewModel() {
  const me = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const form = useForm<NewUserForm>(emptyUser);

  const load = () =>
    UserApi.getInstance()
      .list()
      .then(setUsers)
      .catch((err) => pushToast('error', errorMessage(err)));

  useEffect(() => {
    void load();
  }, []);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      pushToast('success', success);
      await load();
      return true;
    } catch (err) {
      pushToast('error', errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const update = (id: number, raw: unknown, success: string) => {
    const parsed = updateUserSchema.safeParse(raw);
    if (!parsed.success) return pushToast('error', errorMessage(parsed.error));
    void run(() => UserApi.getInstance().update(id, parsed.data), success);
  };

  return {
    users,
    busy,
    form,
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    isMe: (u: User) => u.id === me?.id,
    create: async () => {
      const input = form.validate(createUserSchema, form.values);
      if (input && (await run(() => UserApi.getInstance().create(input), 'Usuário criado'))) form.reset(emptyUser);
    },
    changeRole: (u: User, role: Role) => update(u.id, { role }, 'Papel alterado'),
    toggleActive: (u: User) => update(u.id, { active: !u.active }, u.active ? 'Usuário desativado' : 'Usuário reativado'),
    resetPassword: (u: User) => {
      const password = prompt(`Nova senha para ${u.name} (mínimo 8 caracteres):`);
      if (password) update(u.id, { password }, 'Senha redefinida (sessões encerradas)');
    },
    remove: (u: User) => {
      if (confirm(`Excluir ${u.name}? Os tokens de API dele param de funcionar.`)) void run(() => UserApi.getInstance().remove(u.id), 'Usuário excluído');
    },
  };
}
