import { useSyncExternalStore } from 'react';
import type { Side } from '../model/panel-placement';

/**
 * Which side of the window the detail panel is on, or null when it is closed. One panel per side (interface spec): while the detail
 * panel is on a side, the other panels there (the legend on the right; the stats panel and the list on the left) fold to their
 * header bar, keeping their own open or closed state, so closing the detail panel brings them back as they were.
 */
let side: Side | null = null;
const listeners = new Set<() => void>();

export const getDetailSide = (): Side | null => side;

export function setDetailSide(next: Side | null): void {
  if (next === side) return;
  side = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeDetailSide(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the detail panel takes this side, so a panel there shows only its header bar. */
export function useYieldsTo(mySide: Side): boolean {
  return useSyncExternalStore(subscribeDetailSide, () => side === mySide, () => false);
}
