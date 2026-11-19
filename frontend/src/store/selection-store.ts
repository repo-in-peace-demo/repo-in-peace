import { useSyncExternalStore } from 'react';

/**
 * The one thing the scene shares with the rest of the page: which stone or ghost is selected. The detail panel
 * of a later spec reads it and can set it. Plain functions, so it works from code outside React as well as from
 * components, with no library. It holds only the selection: hover is private to the scene.
 */

export type Selection = { readonly kind: 'file' | 'ghost'; readonly path: string } | null;

let current: Selection = null;

/** Each subscription is its own entry, so subscribing the same function twice, and unsubscribing once, works. */
const subscriptions = new Set<{ readonly listener: () => void }>();

const sameSelection = (a: Selection, b: Selection): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.path === b.path);

/** The current selection. The same object until the selection changes, which React needs to see changes. */
export function getSelection(): Selection {
  return current;
}

/**
 * Selects a stone or ghost, or `null` to clear. Does nothing, and tells nobody, if it is already selected.
 * The store keeps its own frozen copy, so changing the object passed in later does not change the selection.
 */
export function select(selection: Selection): void {
  if (sameSelection(current, selection)) return;
  current = selection === null ? null : Object.freeze({ kind: selection.kind, path: selection.path });
  notify();
}

export function clearSelection(): void {
  select(null);
}

/** Calls `listener` after every change of the selection. Returns the function that stops it. */
export function subscribeSelection(listener: () => void): () => void {
  const subscription = { listener };
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
  };
}

/** The current selection in a React component, which renders again when it changes. */
export function useSelection(): Selection {
  return useSyncExternalStore(subscribeSelection, getSelection, getSelection);
}

function notify(): void {
  // A listener may subscribe, unsubscribe or change the selection while it runs: walk a copy.
  for (const { listener } of [...subscriptions]) {
    try {
      listener();
    } catch (error) {
      // One broken listener must not keep the others from hearing about the change.
      console.error('A selection listener threw:', error);
    }
  }
}
