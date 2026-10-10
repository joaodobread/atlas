import type { CSSProperties } from 'react';
import { useAppViewModel } from '../viewmodels/useAppViewModel.ts';
import { Toasts } from '../views/common/Toasts.tsx';
import { ImportModal } from '../views/ImportModal.tsx';
import { DetailPanel } from '../views/panels/DetailPanel.tsx';
import { DocumentViewer } from '../views/docs/DocumentViewer.tsx';
import { ReposScreen } from '../views/repos/ReposScreen.tsx';
import { SettingsScreen } from '../views/settings/SettingsScreen.tsx';
import { PanelResizer } from '../views/common/PanelResizer.tsx';
import { LeftPanel } from '../views/panels/LeftPanel.tsx';
import { GraphStage } from '../views/scene/GraphStage.tsx';
import { NavRail } from '../views/NavRail.tsx';
import { OnboardingTour } from '../views/OnboardingTour.tsx';

export function App() {
  const vm = useAppViewModel();
  return (
    <div className="app">
      <NavRail />
      {vm.screen === 'settings' ? (
        <SettingsScreen />
      ) : vm.screen === 'repos' ? (
        <ReposScreen />
      ) : (
        <div
          className={`workspace${vm.leftOpen ? '' : ' no-left'}${vm.hasSelection ? '' : ' no-right'}`}
          style={{ '--left-w': `${vm.panelWidths.left}px`, '--right-w': `${vm.panelWidths.right}px` } as CSSProperties}
        >
          {vm.leftOpen && <LeftPanel tab={vm.leftTab} onClose={vm.closeLeft} />}
          <main className="stage">
            {vm.leftOpen && <PanelResizer side="left" />}
            {vm.hasSelection && <PanelResizer side="right" />}
            {vm.status === 'error' ? (
              <div className="stage-message">
                <p>Não foi possível carregar o grafo: {vm.error}</p>
                <button onClick={vm.retry}>Tentar de novo</button>
              </div>
            ) : (
              <GraphStage viewMode={vm.viewMode} />
            )}
          </main>
          <DetailPanel />
        </div>
      )}
      {vm.importOpen && <ImportModal />}
      <DocumentViewer />
      <OnboardingTour />
      <Toasts />
    </div>
  );
}
