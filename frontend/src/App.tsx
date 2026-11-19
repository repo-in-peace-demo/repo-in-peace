import { useMemo, useState } from 'react';
import type { Graveyard } from '@shared/graveyard-schema';
import { buildSceneModel } from './model/scene-model';
import { StatusMessage } from './ui/StatusMessage';
import { useGraveyardLoad } from './ui/useGraveyardLoad';
import { hasWebGL } from './ui/webgl';

/**
 * Loading and error screens. Once a graveyard is ready, the scene takes over (added in the next tasks); until then this
 * shows what was loaded, so the loading, the checks and the scene model can be seen working on real files.
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
  return <Loaded graveyard={state.graveyard} name={state.name} />;
}

function Loaded({ graveyard, name }: { graveyard: Graveyard; name: string }) {
  const model = useMemo(() => buildSceneModel(graveyard), [graveyard]);
  const { stats } = model;
  return (
    <main className="status status-loading">
      <h1>{graveyard.meta.name}</h1>
      <p>
        Loaded {name}: {stats.files} files in {stats.folders} folders and {stats.ghosts} ghosts. The scene comes next.
      </p>
      <p>
        Fresh {stats.fresh}, stale {stats.stale}, ancient {stats.ancient}; unused {stats.unused}, hot {stats.hot}.
      </p>
    </main>
  );
}
