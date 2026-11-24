import { useSyncExternalStore } from 'react';
import type { Action } from '../ui/pr-client';

/**
 * The pull requests opened in this session, and each grave's request in progress (bury-and-resurrect Req 10.4, 10.5, Decision 8).
 * Session only: cleared when the scene is left and lost on reload, since the data file doesn't change until a pull request is merged.
 * Plain functions, like the selection store.
 */

export type GraveKind = 'file' | 'ghost';
export interface PrRecord {
  action: Action;
  number: number;
  /** Null when the server's link was not one the page may open: the number is shown as text. */
  url: string | null;
  existing: boolean;
  fake: boolean;
  /** `performance.now()` when it was opened, for the scene's animation; long ago for one found open on load, so it shows at its end. */
  openedAt: number;
  /** Found open on GitHub when the scene loaded (not opened in this session): no animation, and the panel says it is open. */
  found?: true;
}
export type PrRequestState = { state: 'confirming' } | { state: 'opening'; startedAt: number } | { state: 'error'; message: string };

export interface PrSession {
  readonly prs: ReadonlyMap<string, PrRecord>;
  readonly requests: ReadonlyMap<string, PrRequestState>;
}

export const graveKey = (kind: GraveKind, path: string): string => `${kind}:${path}`;

let session: PrSession = { prs: new Map(), requests: new Map() };
const listeners = new Set<{ readonly listener: () => void }>();
const notify = (): void => {
  for (const { listener } of [...listeners]) listener();
};

export const getPrSession = (): PrSession => session;

export function subscribePrSession(listener: () => void): () => void {
  const entry = { listener };
  listeners.add(entry);
  return () => listeners.delete(entry);
}

/** When a pull request found open on load "was opened": long enough ago that every animation is at its end. */
export const FOUND_OPENED_AT = -1e9;

/** Pull requests found open on GitHub when the scene loaded: recorded at once, at their end, unless this session has one already. */
export function recordFoundPrs(found: ReadonlyArray<{ kind: GraveKind; path: string; record: Omit<PrRecord, 'openedAt' | 'found'> }>): void {
  const prs = new Map(session.prs);
  let changed = false;
  for (const { kind, path, record } of found) {
    const key = graveKey(kind, path);
    if (prs.has(key) || session.requests.has(key)) continue;
    prs.set(key, Object.freeze({ ...record, openedAt: FOUND_OPENED_AT, found: true as const }));
    changed = true;
  }
  if (!changed) return;
  session = { prs, requests: session.requests };
  notify();
}

/** A pull request opened for a grave: it ends any request in progress for it. */
export function recordPr(kind: GraveKind, path: string, record: PrRecord): void {
  const key = graveKey(kind, path);
  const prs = new Map(session.prs);
  prs.set(key, Object.freeze({ ...record }));
  const requests = new Map(session.requests);
  requests.delete(key);
  session = { prs, requests };
  notify();
}

/** Sets or clears (`null`) a grave's request state. A grave with a pull request takes no new request. */
export function setPrRequest(kind: GraveKind, path: string, state: PrRequestState | null): void {
  const key = graveKey(kind, path);
  if (state !== null && session.prs.has(key)) return;
  const current = session.requests.get(key);
  if (current === state || (current === undefined && state === null)) return;
  const requests = new Map(session.requests);
  if (state === null) requests.delete(key);
  else requests.set(key, Object.freeze({ ...state }));
  session = { prs: session.prs, requests };
  notify();
}

/** Forgets the session: on leaving the scene. */
export function clearPrSession(): void {
  if (session.prs.size === 0 && session.requests.size === 0) return;
  session = { prs: new Map(), requests: new Map() };
  notify();
}

export function usePrSession(): PrSession {
  return useSyncExternalStore(subscribePrSession, getPrSession, getPrSession);
}
