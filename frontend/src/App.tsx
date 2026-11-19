import { useMemo, useState } from 'react';
import type { Graveyard } from '@shared/graveyard-schema';
import { buildSceneModel } from './model/scene-model';
import { SceneCanvas } from './scene/SceneCanvas';
import { ControlsPanel } from './ui/ControlsPanel';
import { StatusMessage } from './ui/StatusMessage';
import { useGraveyardLoad } from './ui/useGraveyardLoad';
import { hasWebGL } from './ui/webgl';

/**
 * Loading and error screens, then the scene. The overlays (legend, statistics, hover label, signs) and the camera
 * controls are added in the next tasks.
 */
export function App() {
  const [webgl] = useState(() => hasWebGL());
  const state = useGraveyardLoad(window.location.search, import.meta.env.BASE_URL, webgl);

  if (!webgl) {
    return (
      <StatusMessage
        title="WebGL is not available"
        message="This browser cannot draw the graveyard. Try another browser, or turn on hardware acceleration."
      />
    );
  }
  if (state.status === 'loading') {
    return <StatusMessage kind="loading" title="Loading" message="Exhuming the graveyard…" />;
  }
  if (state.status === 'error') {
    return <StatusMessage title={state.title} message={state.message} details={state.details} />;
  }
  return <Scene graveyard={state.graveyard} />;
}

/** Everything the scene needs is worked out once per loaded file, then handed to the drawing code. */
function Scene({ graveyard }: { graveyard: Graveyard }) {
  const model = useMemo(() => buildSceneModel(graveyard), [graveyard]);
  return (
    <>
      <SceneCanvas model={model} />
      <ControlsPanel />
    </>
  );
}
