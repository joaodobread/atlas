import type { ViewMode } from '../../stores/uiStore.ts';
import { GraphScene2D } from './GraphScene2D.tsx';
import { GraphScene3D } from './GraphScene3D.tsx';
import { SceneOverlay } from './SceneOverlay.tsx';

export function GraphStage({ viewMode }: { viewMode: ViewMode }) {
  return (
    <>
      {viewMode === '2d' ? <GraphScene2D /> : <GraphScene3D />}
      <SceneOverlay />
    </>
  );
}
