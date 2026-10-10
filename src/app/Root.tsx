import { useRootViewModel } from '../viewmodels/useRootViewModel.ts';
import { AuthScreen } from '../views/auth/AuthScreen.tsx';
import { Toasts } from '../views/common/Toasts.tsx';
import { App } from './App.tsx';

/** Portão de autenticação: só monta o app depois do login. */
export function Root() {
  const vm = useRootViewModel();
  switch (vm.phase) {
    case 'loading':
      return <div className="auth-screen muted">Carregando…</div>;
    case 'offline':
      return (
        <div className="auth-screen">
          <div className="auth-card">
            <p>Não foi possível falar com o servidor: {vm.error}</p>
            <button onClick={vm.retry}>Tentar de novo</button>
          </div>
        </div>
      );
    case 'needs-setup':
      return <AuthScreen mode="setup" />;
    case 'anonymous':
      return (
        <>
          <AuthScreen mode="login" />
          <Toasts />
        </>
      );
    default:
      return <App />;
  }
}
