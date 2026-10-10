import { restartOnboarding } from './useOnboardingViewModel.ts';
import { useEffect, useState } from 'react';
import { ROLE_LABEL } from '../../shared/constants.ts';
import { changePasswordSchema, createApiTokenSchema } from '../../shared/schemas.ts';
import type { ApiTokenView, CreatedApiToken } from '../../shared/types.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { AuthApi } from '../data/api/AuthApi.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { useForm } from './useForm.ts';

export function useAccountViewModel() {
  const user = useAuthStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const [tokens, setTokens] = useState<ApiTokenView[]>([]);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const passwordForm = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const tokenForm = useForm({ name: '' });

  const load = () =>
    AuthApi.getInstance()
      .tokens()
      .then(setTokens)
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, []);

  return {
    /** Reabre o tutorial de primeiro acesso. */
    restartTour: () => void restartOnboarding().catch((err: unknown) => pushToast('error', errorMessage(err))),
    user,
    roleLabel: user ? ROLE_LABEL[user.role] : '',
    tokens,
    created,
    passwordForm,
    tokenForm,
    changePassword: async () => {
      const v = passwordForm.values;
      const input = passwordForm.validate(changePasswordSchema, { currentPassword: v.currentPassword, newPassword: v.newPassword });
      if (!input) return;
      if (v.newPassword !== v.confirm) return pushToast('error', 'As senhas não conferem');
      try {
        await AuthApi.getInstance().changePassword(input);
        passwordForm.reset({ currentPassword: '', newPassword: '', confirm: '' });
        pushToast('success', 'Senha alterada');
      } catch (err) {
        pushToast('error', errorMessage(err));
      }
    },
    createToken: async () => {
      const input = tokenForm.validate(createApiTokenSchema, tokenForm.values);
      if (!input) return;
      try {
        setCreated(await AuthApi.getInstance().createToken(input));
        tokenForm.reset({ name: '' });
        await load();
      } catch (err) {
        pushToast('error', errorMessage(err));
      }
    },
    copyCreated: async () => {
      if (!created) return;
      const copied = await navigator.clipboard.writeText(created.token).then(
        () => true,
        () => false,
      );
      pushToast(copied ? 'success' : 'error', copied ? 'Token copiado' : 'Não foi possível copiar; selecione e copie manualmente');
    },
    dismissCreated: () => setCreated(null),
    revoke: async (t: ApiTokenView) => {
      if (!confirm(`Revogar o token "${t.name}"? Scripts que o usam param de funcionar.`)) return;
      try {
        await AuthApi.getInstance().revokeToken(t.id);
        await load();
      } catch (err) {
        pushToast('error', errorMessage(err));
      }
    },
  };
}
