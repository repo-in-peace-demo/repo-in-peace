/**
 * How long the digging screen stays (interface spec, Req 3.2): an intentional beat, long enough for its lines to type and be read.
 * Pure. It shows for at least DIG_MIN_MS in all (DIG_MIN_REDUCED_MS under reduced motion, when the lines appear at once), counted
 * from when the graveyard was chosen; loading and building that take longer add nothing. Any key or click skips the rest of it.
 */
export const DIG_MIN_MS = 1800;
export const DIG_MIN_REDUCED_MS = 600;

/** The least time the digging screen shows. */
export const digMinimumMs = (reducedMotion: boolean): number => (reducedMotion ? DIG_MIN_REDUCED_MS : DIG_MIN_MS);

/** How much longer to hold the digging screen after `workMs` of real loading and building: the rest of the minimum, or 0. */
export function digHoldMs(workMs: number, reducedMotion = false): number {
  const work = Number.isFinite(workMs) && workMs > 0 ? workMs : 0;
  return Math.max(0, digMinimumMs(reducedMotion) - work);
}
