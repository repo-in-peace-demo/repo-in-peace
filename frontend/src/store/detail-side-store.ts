import type { Side } from '../model/panel-placement';

/**
 * Which side of the window the detail panel is on, or null when it is closed. (Which panels are open, and the rule that closes
 * overlapping ones, is in panels-store.ts.)
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
