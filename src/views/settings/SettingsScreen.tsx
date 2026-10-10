import { ArrowLeft } from 'lucide-react';
import { useSettingsScreenViewModel } from '../../viewmodels/useSettingsScreenViewModel.ts';
import { AccountSettings } from './AccountSettings.tsx';
import { GithubSettings } from './GithubSettings.tsx';
import { LlmSettings } from './LlmSettings.tsx';
import { UsersSettings } from './UsersSettings.tsx';

export function SettingsScreen() {
  const vm = useSettingsScreenViewModel();
  return (
    <div className="settings-screen">
      <nav className="settings-nav" aria-label="Seções de configuração">
        <button className="back" onClick={vm.back}>
          <ArrowLeft size={14} /> Voltar ao grafo
        </button>
        <h2>Configurações</h2>
        {vm.groups.map((g) => (
          <div key={g.name} className="settings-group">
            <span className="settings-group-name">{g.name}</span>
            {g.items.map((s) => (
              <button key={s.id} className={vm.current.id === s.id ? 'active' : ''} onClick={() => vm.select(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="settings-content">
        <header>
          <h1>{vm.current.label}</h1>
          <p className="muted">{vm.current.description}</p>
        </header>
        {vm.current.id === 'account' && <AccountSettings />}
        {vm.current.id === 'users' && <UsersSettings />}
        {vm.current.id === 'llm' && <LlmSettings />}
        {vm.current.id === 'github' && <GithubSettings />}
      </main>
    </div>
  );
}
