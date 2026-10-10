import { useUiStore, type SettingsSection } from '../stores/uiStore.ts';
import { usePermissions } from './usePermissions.ts';

interface SectionEntry {
  id: SettingsSection;
  label: string;
  description: string;
  group: 'Pessoal' | 'Administração' | 'Integrações';
}

const SECTIONS: Array<SectionEntry & { allowed(p: ReturnType<typeof usePermissions>): boolean }> = [
  { id: 'account', label: 'Minha conta', description: 'Nome, senha e tokens de API', group: 'Pessoal', allowed: () => true },
  { id: 'users', label: 'Usuários', description: 'Contas e papéis (leitor, editor, administrador)', group: 'Administração', allowed: (p) => p.canManageUsers },
  {
    id: 'llm',
    label: 'LLM',
    description: 'Provedor, modelo e chave usados nas respostas e análises',
    group: 'Integrações',
    allowed: (p) => p.canManageSettings,
  },
  { id: 'github', label: 'GitHub', description: 'Organização, token e métricas de CI', group: 'Integrações', allowed: (p) => p.canManageSettings },
];

/** Tela de configurações: navegação por seções conforme as permissões do usuário. */
export function useSettingsScreenViewModel() {
  const section = useUiStore((s) => s.settingsSection);
  const openSettings = useUiStore((s) => s.openSettings);
  const showGraph = useUiStore((s) => s.showGraph);
  const perms = usePermissions();

  const sections = SECTIONS.filter((s) => s.allowed(perms)).map(({ allowed: _allowed, ...s }) => s);
  // Seção sem permissão (ex.: papel mudou) cai na primeira disponível.
  const current = sections.find((s) => s.id === section) ?? sections[0]!;
  const groups = [...new Set(sections.map((s) => s.group))].map((g) => ({ name: g, items: sections.filter((s) => s.group === g) }));

  return { groups, current, select: (id: SettingsSection) => openSettings(id), back: showGraph };
}
