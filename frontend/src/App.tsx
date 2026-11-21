import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { Graveyard } from '@shared/graveyard-schema';
import { countsOf, flow, initialFlow, type Counts, type FlowEvent, type FlowState, type Source } from './model/app-flow';
import { digHoldMs } from './model/digging-timing';
import { graveyardUrl, routeFromAddress } from './model/graveyard-load';
import { buildSceneModel, type SceneModel } from './model/scene-model';
import { SceneCanvas } from './scene/SceneCanvas';
import { BootScreen } from './ui/BootScreen';
import { ControlsPanel } from './ui/ControlsPanel';
import { DiggingScreen } from './ui/DiggingScreen';
import { fetchGraveyard } from './ui/fetch-graveyard';
import { HoverLabel } from './ui/HoverLabel';
import { Legend } from './ui/Legend';
import { readLocalFile } from './ui/read-local-file';
import { StatsPanel } from './ui/StatsPanel';
import { StatusMessage } from './ui/StatusMessage';
import { hasWebGL } from './ui/webgl';
import { clearSelection } from './store/selection-store';

/** Development builds only: the performance overlay and the other extras (`dev/DevExtras.tsx`). Null, and not in the bundle, in production. */
const DevExtras = import.meta.env.DEV ? lazy(() => import('./dev/DevExtras')) : null;

/**
 * The made-up graveyard's size that a development build reads from the page address (`?synthetic=<n>`), or null. In production the
 * whole expression is `null`, so neither the parameter's name nor this code is in the bundle.
 */
const madeFilesOf = (search: string): number | null => {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(search).get('synthetic');
  const n = raw !== null && /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 20_000) : null;
};

const flowFromAddress = (): FlowState => {
  const { search } = window.location;
  return initialFlow(routeFromAddress(search, madeFilesOf(search)), performance.now());
};

/**
 * The app (interface spec, design "App flow"): the boot screen at a bare address, the digging screen while a graveyard loads and its
 * scene is built, then the scene; or the reason it cannot be shown. The screens and their moves are the pure `flow`; this component
 * does what they need: fetching, reading a picked file, building the model, and the page address (a chosen demo is pushed as
 * `?graveyard=<name>`, so the address can be shared and Back returns to the boot screen).
 */
export function App() {
  const [webgl] = useState(() => hasWebGL());
  const [state, setState] = useState<FlowState>(flowFromAddress);
  const dispatch = useCallback((event: FlowEvent) => setState((s) => flow(s, event)), []);
  const baseUrl = import.meta.env.BASE_URL;

  // Back and Forward: the screen follows the address.
  useEffect(() => {
    const onPop = (): void => setState(flowFromAddress());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A new screen starts with no selection (the store outlives the scene).
  const screen = state.screen;
  useEffect(() => {
    if (screen !== 'scene') clearSelection();
  }, [screen]);

  const chooseDemo = useCallback(
    (name: string, counts: Counts) => {
      const url = new URL(window.location.href);
      url.search = `?graveyard=${encodeURIComponent(name)}`;
      window.history.pushState(null, '', url);
      dispatch({ type: 'choose', source: { kind: 'demo', name }, now: performance.now(), counts });
    },
    [dispatch],
  );

  const chooseFile = useCallback(
    (file: File) => {
      void readLocalFile(file).then((result) => {
        if (result.ok) dispatch({ type: 'choose', source: { kind: 'local', fileName: result.fileName, graveyard: result.graveyard }, now: performance.now() });
        else dispatch({ type: 'local-rejected', notice: result.notice });
      });
    },
    [dispatch],
  );

  const back = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.pushState(null, '', url);
    dispatch({ type: 'back' });
  }, [dispatch]);

  if (!webgl) {
    return <StatusMessage title="WebGL is not available" message="This browser cannot draw the graveyard. Try another browser, or turn on hardware acceleration." />;
  }
  switch (state.screen) {
    case 'boot':
      return <BootScreen baseUrl={baseUrl} notice={state.notice} onChooseDemo={chooseDemo} onChooseFile={chooseFile} />;
    case 'digging':
      return <Digging key={sourceKey(state.source)} state={state} baseUrl={baseUrl} dispatch={dispatch} />;
    case 'error':
      return (
        <>
          <StatusMessage title={state.title} message={state.message} details={state.details} />
          <div className="status-actions">
            <button type="button" onClick={back}>
              Back to the graveyards
            </button>
          </div>
        </>
      );
    case 'scene':
      // Keyed on the source, so another graveyard is a new scene: the old one is unmounted and its GPU resources are freed.
      return <Scene key={sourceKey(state.source)} model={state.model} onBack={back} />;
  }
}

const sourceKey = (source: Source): string => (source.kind === 'demo' ? `demo:${source.name}` : source.kind === 'local' ? `local:${source.fileName}` : `made:${source.files}`);

/**
 * The digging screen and the work behind it: load the file (a demo), make the graveyard (development), or take the file already read,
 * then build the scene model after the screen has been painted, and hold the screen for `digHoldMs` so it never flashes.
 */
function Digging({ state, baseUrl, dispatch }: { state: Extract<FlowState, { screen: 'digging' }>; baseUrl: string; dispatch: (e: FlowEvent) => void }) {
  // The source is fixed for this component (it is keyed on it); the effect runs once per mount. (StrictMode mounts twice in
  // development: the first run is cancelled by its cleanup, and the second does the work.)
  const first = useRef(state);
  useEffect(() => {
    const { source, startedAt } = first.current;
    let gone = false;
    const timers: number[] = [];
    const finish = (graveyard: Graveyard): void => {
      if (gone) return;
      dispatch({ type: 'counts', counts: countsOf(graveyard) });
      // After the digging screen (with its counts) has been painted: build the model, then hold the screen for the rest of its beat.
      timers.push(
        window.setTimeout(() => {
          if (gone) return;
          let model: SceneModel;
          try {
            model = buildSceneModel(graveyard);
          } catch (error) {
            dispatch({ type: 'failed', title: 'Could not build the graveyard', message: error instanceof Error ? error.message : String(error), details: [] });
            return;
          }
          const work = performance.now() - startedAt;
          timers.push(window.setTimeout(() => !gone && dispatch({ type: 'loaded', model }), digHoldMs(work)));
        }, 0),
      );
    };
    const controller = new AbortController();
    if (source.kind === 'local') finish(source.graveyard);
    else if (source.kind === 'demo') {
      void fetchGraveyard(source.name, graveyardUrl(source.name, baseUrl), controller.signal).then((outcome) => {
        if (outcome.kind === 'aborted' || gone) return;
        if (outcome.kind === 'ready') finish(outcome.graveyard);
        else dispatch({ type: 'failed', title: outcome.title, message: outcome.message, details: outcome.details });
      });
    } else if (import.meta.env.DEV) {
      void import('./dev/synthetic-load').then(({ madeGraveyard }) => finish(madeGraveyard(source.files)));
    }
    return () => {
      gone = true;
      controller.abort();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [baseUrl, dispatch]);
  return <DiggingScreen counts={state.counts} />;
}

/** The scene and its panels, for one graveyard. */
function Scene({ model, onBack }: { model: SceneModel; onBack: () => void }) {
  return (
    <>
      <SceneCanvas model={model} />
      <StatsPanel meta={model.graveyard.meta} stats={model.stats} />
      <Legend legend={model.legend} />
      <ControlsPanel onBack={onBack} />
      <HoverLabel model={model} />
      {DevExtras && (
        <Suspense fallback={null}>
          <DevExtras />
        </Suspense>
      )}
    </>
  );
}
