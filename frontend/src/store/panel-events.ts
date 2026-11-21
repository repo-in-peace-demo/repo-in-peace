/**
 * A request from one panel to another: the list, opening on a window too short for it below the open stats panel, asks the stats
 * panel to fold to its header (it stays foldable and openable as usual). Plain listeners, no state.
 */
const statsCollapse = new Set<() => void>();

export function onStatsCollapseRequest(listener: () => void): () => void {
  statsCollapse.add(listener);
  return () => statsCollapse.delete(listener);
}

export function requestStatsCollapse(): void {
  for (const listener of [...statsCollapse]) listener();
}
