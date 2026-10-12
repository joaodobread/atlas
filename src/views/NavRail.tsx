import type { ReactNode } from 'react';
import { ArrowDownUp, FileText, GitBranch, ListTree, Settings, ShieldCheck } from 'lucide-react';
import { useNavRailViewModel } from '../viewmodels/useNavRailViewModel.ts';

/** Fecha o menu <details> depois de escolher uma opção. */
const closeMenu = (e: { currentTarget: HTMLElement }) => (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');

function RailMenu({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <details className="rail-menu">
      <summary className="rail-item" title={label} aria-label={label}>
        {icon}
      </summary>
      <div className="menu" onClick={closeMenu}>
        <div className="menu-title">{label}</div>
        {children}
      </div>
    </details>
  );
}

export function NavRail() {
  const vm = useNavRailViewModel();
  return (
    <nav className="nav-rail" aria-label="Navegação" data-tour="nav">
      <div className="rail-logo" title="Comm Graph">
        CG
      </div>
      <button
        className={`rail-item${vm.isPanelActive('tree') ? ' active' : ''}`}
        onClick={() => vm.togglePanel('tree')}
        title="Estrutura"
        aria-label="Estrutura"
      >
        <ListTree size={18} />
      </button>
      <button
        className={`rail-item${vm.isPanelActive('docs') ? ' active' : ''}`}
        onClick={() => vm.togglePanel('docs')}
        title="Documentos e busca"
        aria-label="Documentos e busca"
      >
        <FileText size={18} />
      </button>
      <button
        data-tour="nav-repos"
        className={`rail-item${vm.reposActive ? ' active' : ''}`}
        onClick={vm.openRepos}
        title="Repositórios do GitHub"
        aria-label="Repositórios do GitHub"
      >
        <GitBranch size={18} />
      </button>
      <button
        className={`rail-item${vm.securityActive ? ' active' : ''}`}
        onClick={vm.openSecurity}
        title="Relatório de segurança e DevSecOps"
        aria-label="Relatório de segurança e DevSecOps"
      >
        <ShieldCheck size={18} />
      </button>

      <div className="rail-spacer" />

      <RailMenu icon={<ArrowDownUp size={18} />} label="Importar / exportar">
        {vm.canImport && <button onClick={vm.openImport}>Importar JSON</button>}
        <button onClick={() => void vm.exportJson()}>Exportar JSON</button>
      </RailMenu>
      <button
        data-tour="nav-settings"
        className={`rail-item${vm.settingsActive ? ' active' : ''}`}
        onClick={vm.openSettings}
        title="Configurações"
        aria-label="Configurações"
      >
        <Settings size={18} />
      </button>
      <RailMenu icon={<span className="avatar">{vm.initials}</span>} label={`${vm.userName} · ${vm.roleLabel}`}>
        <button onClick={vm.openAccount}>Minha conta e tokens</button>
        <button onClick={vm.logout}>Sair</button>
      </RailMenu>
    </nav>
  );
}
