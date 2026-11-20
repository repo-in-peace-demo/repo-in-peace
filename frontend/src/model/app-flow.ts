import type { Graveyard } from '@shared/graveyard-schema';
import type { Route } from './graveyard-load';
import type { SceneModel } from './scene-model';

/**
 * The app's screens and how it moves between them (interface spec, design "App flow"). Pure: `App.tsx` holds the state, does the
 * side effects (fetching, reading a file, building the model, changing the address) and feeds the results back as events.
 *
 *   boot ──choose──▶ digging ──loaded──▶ scene
 *     ▲                 │ failed
 *     └──── back ─── error
 *
 * The made-up graveyard of development builds is called `made` here, so that production code never carries the word of its
 * page-address parameter (task 26 of the scene spec greps the build for it).
 */

/** Where the graveyard comes from. A local file has already been read and checked when it is chosen. */
export type Source =
  | { kind: 'demo'; name: string }
  | { kind: 'local'; fileName: string; graveyard: Graveyard }
  | { kind: 'made'; files: number };

/** The numbers the digging screen shows. */
export interface Counts {
  repo: string;
  files: number;
  ghosts: number;
}

/** A message on the boot screen: a local file that could not be opened. */
export interface BootNotice {
  title: string;
  message: string;
  details: string[];
}

export type FlowState =
  | { screen: 'boot'; notice: BootNotice | null }
  | { screen: 'digging'; source: Source; startedAt: number; counts: Counts | null }
  | { screen: 'scene'; source: Source; model: SceneModel }
  | { screen: 'error'; title: string; message: string; details: string[] };

export type FlowEvent =
  | { type: 'choose'; source: Source; now: number }
  | { type: 'counts'; counts: Counts }
  | { type: 'loaded'; model: SceneModel }
  | { type: 'failed'; title: string; message: string; details: string[] }
  | { type: 'local-rejected'; notice: BootNotice }
  | { type: 'back' };

/** The counts of a graveyard that is already in hand. */
export const countsOf = (g: Graveyard): Counts => ({ repo: g.meta.name, files: g.files.length, ghosts: g.ghosts.length });

/** The first screen for a page address (`routeFromAddress`). */
export function initialFlow(route: Route, now: number): FlowState {
  switch (route.kind) {
    case 'boot':
      return { screen: 'boot', notice: null };
    case 'demo':
      return { screen: 'digging', source: { kind: 'demo', name: route.name }, startedAt: now, counts: null };
    case 'made':
      return { screen: 'digging', source: { kind: 'made', files: route.files }, startedAt: now, counts: null };
    case 'bad-name':
      return { screen: 'error', title: 'Name not allowed', message: route.message, details: [] };
  }
}

/** The next state. An event that does not fit the current screen (a late result after Back, say) changes nothing. */
export function flow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'choose':
      if (state.screen !== 'boot') return state;
      return {
        screen: 'digging',
        source: event.source,
        startedAt: event.now,
        counts: event.source.kind === 'local' ? countsOf(event.source.graveyard) : null,
      };
    case 'counts':
      return state.screen === 'digging' ? { ...state, counts: event.counts } : state;
    case 'loaded':
      return state.screen === 'digging' ? { screen: 'scene', source: state.source, model: event.model } : state;
    case 'failed':
      return state.screen === 'digging' ? { screen: 'error', title: event.title, message: event.message, details: event.details } : state;
    case 'local-rejected':
      return state.screen === 'boot' ? { screen: 'boot', notice: event.notice } : state;
    case 'back':
      return { screen: 'boot', notice: null };
  }
}
