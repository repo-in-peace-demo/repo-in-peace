import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Which panels are open, and the one rule that keeps them readable (panel rules, revised): every panel starts collapsed, and
 * opening a panel closes any open panel it would overlap. Panels that don't overlap stay open together. The detail panel is part of
 * it too: it opens with a selection, closes what it overlaps when it settles on its side, and is closed (the selection cleared) if
 * a panel opened later overlaps it. Closing a panel never reopens what it closed.
 *
 * Overlap is measured on the page, not assumed: each panel registers its element, and after a panel opens (two frames later, once it
 * and anything that fits itself around it have their size) the store compares its box with every other open panel's.
 */
export type PanelId = 'stats' | 'legend' | 'list' | 'controls' | 'detail';

let open: ReadonlySet<PanelId> = new Set();
/** When each open panel was opened, as a counter: a panel only ever closes panels opened before it, so a late check can't close a
 * panel opened after it (found when slow frames delayed the list's check past the detail panel's opening). */
const openedAt = new Map<PanelId, number>();
let counter = 0;
const elements = new Map<PanelId, () => Element | null>();
const listeners = new Set<() => void>();
/** How to close the detail panel (clear the selection); set by DetailPanel. */
let closeDetail: () => void = () => {};

const notify = (): void => {
  for (const l of [...listeners]) l();
};

export const isPanelOpen = (id: PanelId): boolean => open.has(id);

export function setPanelOpen(id: PanelId, next: boolean): void {
  if (open.has(id) === next) return;
  const s = new Set(open);
  if (next) {
    s.add(id);
    openedAt.set(id, ++counter);
  } else {
    s.delete(id);
    openedAt.delete(id);
  }
  open = s;
  notify();
}

export const togglePanel = (id: PanelId): void => setPanelOpen(id, !open.has(id));

/** All panels collapsed: on launch, and when a scene is left. */
export function resetPanels(): void {
  if (open.size === 0) return;
  open = new Set();
  openedAt.clear();
  notify();
}

export function registerPanel(id: PanelId, element: () => Element | null): () => void {
  elements.set(id, element);
  return () => {
    if (elements.get(id) === element) elements.delete(id);
  };
}

export function setDetailCloser(close: () => void): void {
  closeDetail = close;
}

type Rect = { left: number; right: number; top: number; bottom: number };
export const rectsOverlap = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Closes every open panel whose box overlaps the box of `id`. Called once `id` has opened and settled into its size. */
/** A panel still being placed (the details before they know their side) is hidden: it neither closes nor is closed. */
const shown = (el: Element): boolean => typeof getComputedStyle === 'undefined' || getComputedStyle(el).visibility !== 'hidden';

export function settle(id: PanelId): void {
  if (!open.has(id)) return;
  const mine = elements.get(id)?.();
  if (!mine || !shown(mine)) return;
  const box = mine.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const mineAt = openedAt.get(id) ?? 0;
  for (const other of [...open]) {
    if (other === id || (openedAt.get(other) ?? 0) > mineAt) continue;
    const el = elements.get(other)?.();
    if (!el || !shown(el)) continue;
    if (!rectsOverlap(box, el.getBoundingClientRect())) continue;
    if (other === 'detail') closeDetail();
    else setPanelOpen(other, false);
  }
}

/** Two frames: the first lets the panel lay out, the second lets panels that fit themselves around it (the list) do so. */
export function settleSoon(id: PanelId): void {
  if (typeof requestAnimationFrame === 'undefined') return settle(id);
  requestAnimationFrame(() => requestAnimationFrame(() => settle(id)));
}

/**
 * A panel's part in the rule: once it has opened and been laid out (a layout effect: before the page is painted), it closes what it
 * overlaps. `deferred` waits two frames instead, for a panel that first fits itself around the others (the list).
 */
export function useSettleOnOpen(id: PanelId, isOpen: boolean, deferred = false): void {
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (deferred) settleSoon(id);
    else settle(id);
  }, [id, isOpen, deferred]);
}

export function subscribePanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePanelOpen(id: PanelId): boolean {
  return useSyncExternalStore(subscribePanels, () => open.has(id), () => false);
}
