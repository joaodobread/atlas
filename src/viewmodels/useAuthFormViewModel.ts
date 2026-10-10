import { useState } from 'react';
import { loginSchema, setupSchema } from '../../shared/schemas.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { AuthSession } from '../data/AuthSession.ts';
import { useForm } from './useForm.ts';

interface AuthForm {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

/** Login ou criação do primeiro administrador. */
export function useAuthFormViewModel(mode: 'login' | 'setup') {
  const form = useForm<AuthForm>({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const v = form.values;
    if (mode === 'setup') {
      const input = form.validate(setupSchema, { name: v.name, email: v.email, password: v.password });
      if (!input) return;
      if (v.password !== v.confirm) return setError('As senhas não conferem');
      setBusy(true);
      await AuthSession.getInstance()
        .setup(input)
        .catch((err) => setError(errorMessage(err)));
    } else {
      const input = form.validate(loginSchema, { email: v.email, password: v.password });
      if (!input) return;
      setBusy(true);
      await AuthSession.getInstance()
        .login(input)
        .catch((err) => setError(errorMessage(err)));
    }
    setBusy(false);
  };

  return { mode, form, busy, error, submit };
}
