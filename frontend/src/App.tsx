import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { Graveyard } from '@shared/graveyard-schema';
import { countsOf, flow, initialFlow, type Counts, type FlowEvent, type FlowState, type Source } from './model/app-flow';
import { digHoldMs } from './model/digging-timing';
import { BOOT_SEARCH, graveyardUrl, routeFromAddress } from './model/graveyard-load';
import { buildSceneModel, type SceneModel } from './model/scene-model';
import { SceneCanvas } from './scene/SceneCanvas';
import { Landing } from './ui/Landing';
import { BootScreen } from './ui/BootScreen';
import { ControlsPanel } from './ui/ControlsPanel';
import { DetailPanel } from './ui/DetailPanel';
import { DiggingScreen } from './ui/DiggingScreen';
import { fetchGraveyard } from './ui/fetch-graveyard';
import { HoverLabel } from './ui/HoverLabel';
import { Legend } from './ui/Legend';
import { ListView } from './ui/ListView';
import { readLocalFile } from './ui/read-local-file';
import { SearchBox } from './ui/SearchBox';
import { StatsPanel } from './ui/StatsPanel';
import { StatusMessage } from './ui/StatusMessage';
import { hasWebGL } from './ui/webgl';
import { prefersReducedMotion } from './scene/reduced-motion';
import { clearSelection } from './store/selection-store';
import { clearPrSession, recordFoundPrs } from './store/pr-store';
import { resetPanels } from './store/panels-store';
import { availability, fetchOpenPrs, fetchPrConfig, type PrConfigAnswer } from './ui/pr-client';

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

  // From a scene or an error to the boot screen, at its own address.
  const back = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = BOOT_SEARCH;
    window.history.pushState(null, '', url);
    dispatch({ type: 'back' });
  }, [dispatch]);

  // From the landing page to the boot screen; the browser's Back returns to the landing page.
  const enter = useCallback(() => {
    const url = new URL(window.location.href);
    url.search = BOOT_SEARCH;
    window.history.pushState(null, '', url);
    dispatch({ type: 'enter' });
  }, [dispatch]);

  // The landing page needs no WebGL (it has no 3D), so it shows even where the graveyard can't be drawn.
  if (state.screen === 'landing') return <Landing onEnter={enter} />;
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
      return <Scene key={sourceKey(state.source)} model={state.model} source={state.source} onBack={back} />;
  }
}

const sourceKey = (source: Source): string => (source.kind === 'demo' ? `demo:${source.name}` : source.kind === 'local' ? `local:${source.fileName}` : `made:${source.files}`);

/**
 * The digging screen and the work behind it: load the file (a demo), make the graveyard (development), or take the file already read,
 * then build the scene model after the screen has been painted, and hold the screen for its beat (`digHoldMs`: 1.8 s from the choice,
 * 0.6 s under reduced motion) so its lines can be read; any key or click skips the rest.
 */
function Digging({ state, baseUrl, dispatch }: { state: Extract<FlowState, { screen: 'digging' }>; baseUrl: string; dispatch: (e: FlowEvent) => void }) {
  // The source is fixed for this component (it is keyed on it); the effect runs once per mount. (StrictMode mounts twice in
  // development: the first run is cancelled by its cleanup, and the second does the work.)
  const first = useRef(state);
  useEffect(() => {
    const { source, startedAt } = first.current;
    let gone = false;
    const timers: number[] = [];
    // The beat: the rest of the minimum once the model is built (1.8 s from the choice, 0.6 s under reduced motion; none at all
    // when a browser test turns it off). Any key or click skips the rest at once (or goes as soon as the model is ready).
    const reduced = prefersReducedMotion();
    const noHold = import.meta.env.DEV && window.__repoInPeaceNoDigHold === true;
    let ready: SceneModel | null = null;
    let skipped = false;
    const go = (): void => {
      if (!gone && ready !== null) dispatch({ type: 'loaded', model: ready });
    };
    const skip = (event: Event): void => {
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey)) return; // the browser's own shortcuts
      skipped = true;
      go();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
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
          ready = model;
          const hold = skipped || noHold ? 0 : digHoldMs(performance.now() - startedAt, reduced);
          if (hold === 0) go();
          else timers.push(window.setTimeout(go, hold));
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
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [baseUrl, dispatch]);
  return <DiggingScreen counts={state.counts} />;
}

/** The scene and its panels, for one graveyard. */
function Scene({ model, source, onBack }: { model: SceneModel; source: Source; onBack: () => void }) {
  // Whether Bury and Resurrect work here: asked once per scene (bury-and-resurrect Req 1.2). Until the answer comes, "unavailable".
  const [prConfig, setPrConfig] = useState<PrConfigAnswer | 'unreachable'>('unreachable');
  useEffect(() => {
    let live = true;
    if (source.kind === 'demo') void fetchPrConfig().then((answer) => live && setPrConfig(answer));
    resetPanels(); // every panel starts collapsed, so the opening shot is clear
    return () => {
      live = false;
      clearPrSession(); // the session's pull requests belong to this scene
      resetPanels();
    };
  }, [source]);
  const pr = { availability: availability(source, prConfig), graveyard: source.kind === 'demo' ? source.name : null };
  // The demo's open Repo In Peace pull requests, live from GitHub (Req 10.4, revised): their graves show the mound and stake, or the
  // restored stone, at once and without the animation, and the panel says the pull request is open. Closed and merged ones show nothing.
  const avail = pr.availability;
  const repo = avail.kind === 'available' ? avail.repo : null;
  const fake = avail.kind === 'available' && avail.fake;
  useEffect(() => {
    if (repo === null || source.kind !== 'demo') return;
    let live = true;
    void fetchOpenPrs(source.name, { repo, fake }).then((open) => {
      if (!live) return;
      recordFoundPrs(open.map((p) => ({ kind: p.action === 'bury' ? 'file' : 'ghost', path: p.path, record: { action: p.action, number: p.number, url: p.url, existing: true, fake } })));
    });
    return () => {
      live = false;
    };
  }, [repo, fake, source]);
  return (
    <>
      <SceneCanvas model={model} />
      <StatsPanel meta={model.graveyard.meta} stats={model.stats} />
      <Legend legend={model.legend} lookup={model.lookup} />
      <ControlsPanel onBack={onBack} />
      <SearchBox model={model} />
      <ListView model={model} />
      <DetailPanel model={model} pr={pr} />
      <HoverLabel model={model} />
      {DevExtras && (
        <Suspense fallback={null}>
          <DevExtras />
        </Suspense>
      )}
    </>
  );
}
