import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadRealGraveyard } from '../../test/real-data';
import { countsOf, flow, initialFlow, type FlowEvent, type FlowState, type Source } from './app-flow';
import type { Route } from './graveyard-load';
import { buildSceneModel } from './scene-model';

const spatialql = loadRealGraveyard('demo.spatialql');
const model = buildSceneModel(spatialql);
const demo: Source = { kind: 'demo', name: 'demo.spatialql' };
const local: Source = { kind: 'local', fileName: 'mine.graveyard.json', graveyard: spatialql };
const notice = { title: 'Wrong version', message: 'version 1', details: [] };

describe('the first screen for a page address', () => {
  it('is the boot screen, a demo or a made-up graveyard being dug up, or the name error', () => {
    expect(initialFlow({ kind: 'landing' }, 0)).toEqual({ screen: 'landing' });
    expect(initialFlow({ kind: 'boot' }, 0)).toEqual({ screen: 'boot', notice: null });
    expect(initialFlow({ kind: 'demo', name: 'demo.spatialql' }, 5)).toEqual({ screen: 'digging', source: demo, startedAt: 5, counts: null });
    expect(initialFlow({ kind: 'made', files: 2000 }, 0)).toMatchObject({ screen: 'digging', source: { kind: 'made', files: 2000 } });
    expect(initialFlow({ kind: 'bad-name', message: 'not allowed' }, 0)).toMatchObject({ screen: 'error', message: 'not allowed' });
  });
});

describe('the flow', () => {
  it('goes boot → digging → scene for a demo, with the counts arriving on the way', () => {
    let s: FlowState = initialFlow({ kind: 'boot' }, 0);
    s = flow(s, { type: 'choose', source: demo, now: 10 });
    expect(s).toEqual({ screen: 'digging', source: demo, startedAt: 10, counts: null });
    s = flow(s, { type: 'counts', counts: countsOf(spatialql) });
    expect(s).toMatchObject({ screen: 'digging', counts: { repo: 'spatialql', files: 120, unused: 2, ghosts: 2 } });
    s = flow(s, { type: 'loaded', model });
    expect(s).toEqual({ screen: 'scene', source: demo, model });
  });

  it('takes a demo\'s counts from the demo list when it is chosen, so the digging screen shows them while the file loads', () => {
    const s = flow({ screen: 'boot', notice: null }, { type: 'choose', source: demo, now: 0, counts: { repo: 'spatialql', files: 120, unused: 2, ghosts: 2 } });
    expect(s).toMatchObject({ screen: 'digging', counts: { files: 120, ghosts: 2 } });
  });

  it('knows a local file\'s counts at once', () => {
    expect(flow({ screen: 'boot', notice: null }, { type: 'choose', source: local, now: 0 })).toMatchObject({ counts: { files: 120, ghosts: 2 } });
  });

  it('goes digging → error → back → boot', () => {
    let s: FlowState = initialFlow({ kind: 'demo', name: 'nope' }, 0);
    s = flow(s, { type: 'failed', title: 'Not found', message: 'no such graveyard', details: [] });
    expect(s).toMatchObject({ screen: 'error', title: 'Not found' });
    expect(flow(s, { type: 'back' })).toEqual({ screen: 'boot', notice: null });
  });

  it('keeps a rejected local file on the boot screen with its notice, and a new choice clears it', () => {
    const s = flow({ screen: 'boot', notice: null }, { type: 'local-rejected', notice });
    expect(s).toEqual({ screen: 'boot', notice });
    expect(flow(s, { type: 'choose', source: demo, now: 0 }).screen).toBe('digging');
  });

  it('goes landing → boot on enter, and nowhere else from the landing page', () => {
    const landing: FlowState = { screen: 'landing' };
    expect(flow(landing, { type: 'enter' })).toEqual({ screen: 'boot', notice: null });
    for (const e of [{ type: 'choose', source: demo, now: 0 }, { type: 'loaded', model }, { type: 'counts', counts: countsOf(spatialql) }] as FlowEvent[]) {
      expect(flow(landing, e)).toBe(landing);
    }
    const boot: FlowState = { screen: 'boot', notice: null };
    expect(flow(boot, { type: 'enter' })).toBe(boot);
  });

  it('ignores late results: a model or a failure arriving after Back changes nothing', () => {
    const boot: FlowState = { screen: 'boot', notice: null };
    expect(flow(boot, { type: 'loaded', model })).toBe(boot);
    expect(flow(boot, { type: 'failed', title: 'x', message: 'y', details: [] })).toBe(boot);
    expect(flow(boot, { type: 'counts', counts: countsOf(spatialql) })).toBe(boot);
  });

  const route: fc.Arbitrary<Route> = fc.oneof(
    fc.constant<Route>({ kind: 'landing' }),
    fc.constant<Route>({ kind: 'boot' }),
    fc.constant<Route>({ kind: 'demo', name: 'demo.spatialql' }),
    fc.constant<Route>({ kind: 'made', files: 10 }),
    fc.constant<Route>({ kind: 'bad-name', message: 'no' }),
  );
  const event: fc.Arbitrary<FlowEvent> = fc.oneof(
    fc.constantFrom<Source>(demo, local, { kind: 'made', files: 3 }).map((source): FlowEvent => ({ type: 'choose', source, now: 1 })),
    fc.constant<FlowEvent>({ type: 'counts', counts: countsOf(spatialql) }),
    fc.constant<FlowEvent>({ type: 'loaded', model }),
    fc.constant<FlowEvent>({ type: 'failed', title: 't', message: 'm', details: [] }),
    fc.constant<FlowEvent>({ type: 'local-rejected', notice }),
    fc.constant<FlowEvent>({ type: 'back' }),
    fc.constant<FlowEvent>({ type: 'enter' }),
  );

  it('for any events: a scene always has a model, only a loaded model leads to a scene, and back always ends on the boot screen', () => {
    fc.assert(
      fc.property(route, fc.array(event, { maxLength: 30 }), (start, events) => {
        let s = initialFlow(start, 0);
        for (const e of events) {
          const next = flow(s, e);
          if (next.screen === 'scene' && (next.model === undefined || (s.screen !== 'scene' && e.type !== 'loaded'))) return false;
          if (e.type === 'back' && next.screen !== 'boot') return false;
          s = next;
        }
        return true;
      }),
    );
  });
});
