/**
 * How long the digging screen stays after the real work is done (interface spec, Req 3.2). Pure. It never flashes (it shows for at
 * least DIG_MIN_MS in all) and never adds more than DIG_MAX_ADDED_MS of artificial delay.
 */
export const DIG_MIN_MS = 400;
export const DIG_MAX_ADDED_MS = 1000;

/** The extra time to hold the digging screen after `workMs` of real loading and building. */
export function digHoldMs(workMs: number): number {
  const work = Number.isFinite(workMs) && workMs > 0 ? workMs : 0;
  return Math.min(DIG_MAX_ADDED_MS, Math.max(0, DIG_MIN_MS - work));
}
