/**
 * Which rows of a long list to put in the page (interface spec, Req 5.7): only those in view, plus a few either side. Pure.
 */

/** The rows `first` to `last` (inclusive) to draw; `last` is `first - 1` for an empty list. */
export function visibleRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 8): { first: number; last: number } {
  if (count <= 0 || !(rowHeight > 0)) return { first: 0, last: -1 };
  const top = Math.max(0, scrollTop);
  const firstInView = Math.min(count - 1, Math.floor(top / rowHeight));
  const lastInView = Math.min(count - 1, Math.max(firstInView, Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight) - 1));
  return { first: Math.max(0, firstInView - overscan), last: Math.min(count - 1, lastInView + overscan) };
}

/** The scroll position that brings row `index` into view: unchanged when it already is, otherwise the least movement that shows it. */
export function scrollToShow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}
