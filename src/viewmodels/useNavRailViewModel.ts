import { ROLE_LABEL } from '../../shared/constants.ts';
import { errorMessage } from '../core/errorMessage.ts';
import { GraphApi } from '../data/api/GraphApi.ts';
import { AuthSession } from '../data/AuthSession.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore, type LeftTab } from '../stores/uiStore.ts';
import { usePermissions } from './usePermissions.ts';

/** Barra de navegação lateral: painéis, repositórios, import/export, configurações e conta. */
export function useNavRailViewModel() {
  const leftTab = useUiStore((s) => s.leftTab);
  const leftOpen = useUiStore((s) => s.leftOpen);
  const screen = useUiStore((s) => s.screen);
  const openSettings = useUiStore((s) => s.openSettings);
  const toggleLeft = useUiStore((s) => s.toggleLeft);
  const showRepos = useUiStore((s) => s.showRepos);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const pushToast = useUiStore((s) => s.pushToast);
  const user = useAuthStore((s) => s.user);
  const perms = usePermissions();

  const exportJson = async () => {
    try {
      const doc = await GraphApi.getInstance().exportDocument(useUiStore.getState().graphId);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `comm-graph-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushToast('error', errorMessage(err));
    }
  };

  return {
    isPanelActive: (tab: LeftTab) => screen === 'graph' && leftOpen && leftTab === tab,
    togglePanel: toggleLeft,
    reposActive: screen === 'repos',
    settingsActive: screen === 'settings',
    openRepos: showRepos,
    canImport: perms.canEditGraph,
    openImport: () => setImportOpen(true),
    exportJson,
    openSettings: () => openSettings(),
    openAccount: () => openSettings('account'),
    userName: user?.name ?? '',
    initials:
      (user?.name ?? '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('') || '?',
    roleLabel: user ? ROLE_LABEL[user.role] : '',
    logout: () => void AuthSession.getInstance().logout(),
  };
}
