import { useSyncExternalStore } from 'react';

/**
 * What the pointer is over, and where the pointer is, for the hover label. The picker writes it and the label reads
 * it. Like the selection store it is plain functions with no library. The pointer position has its own listeners, so
 * moving the pointer moves the label without rendering anything again; only a change of target renders.
 */

export type HoverTarget = { readonly kind: 'file' | 'ghost'; readonly path: string } | null;

export interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

/** Each subscription is its own entry, so subscribing the same function twice, and unsubscribing once, works. */
type Subscriptions = Set<{ readonly listener: () => void }>;

function subscribe(subscriptions: Subscriptions, listener: () => void): () => void {
  const subscription = { listener };
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
  };
}

function notify(subscriptions: Subscriptions): void {
  for (const { listener } of [...subscriptions]) {
    try {
      listener();
    } catch (error) {
      // One broken listener must not keep the others from hearing about the change.
      console.error('A hover listener threw:', error);
    }
  }
}

let target: HoverTarget = null;
let position: PointerPosition = Object.freeze({ x: 0, y: 0 });
const targetSubscriptions: Subscriptions = new Set();
const positionSubscriptions: Subscriptions = new Set();

/** The stone or ghost under the pointer. The same object until the target changes. */
export function getHover(): HoverTarget {
  return target;
}

/** Sets what is hovered, or `null`. Does nothing, and tells nobody, if it is already hovered. */
export function setHover(next: HoverTarget): void {
  if (target === next || (target !== null && next !== null && target.kind === next.kind && target.path === next.path)) return;
  target = next === null ? null : Object.freeze({ kind: next.kind, path: next.path });
  notify(targetSubscriptions);
}

export const clearHover = (): void => setHover(null);

export const subscribeHover = (listener: () => void): (() => void) => subscribe(targetSubscriptions, listener);

/** The hover target in a React component, which renders again when it changes. */
export function useHover(): HoverTarget {
  return useSyncExternalStore(subscribeHover, getHover, getHover);
}

/** The pointer's position on the page, in pixels. */
export function getPointer(): PointerPosition {
  return position;
}

export function setPointer(x: number, y: number): void {
  position = Object.freeze({ x, y });
  notify(positionSubscriptions);
}

export const subscribePointer = (listener: () => void): (() => void) => subscribe(positionSubscriptions, listener);
