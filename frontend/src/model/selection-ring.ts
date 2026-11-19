import { ghostBaseHeight } from './ghost-motion';
import type { GhostVisual } from './visual-params';

/** How far above the surface the ring is drawn, so it does not flicker against the floor. */
export const RING_LIFT = 0.06;

/**
 * The height of the selection ring: at the base of what is selected. A stone stands on the ground, so its ring is on
 * the ground. A ghost floats, so its ring is at the ghost's base, where the ghost is at this moment, and not on the
 * ground far below it (which, seen at an angle, would look like a ring in front of the ghost). The ring's x and z
 * are the object's own x and z, from the layout.
 *
 * @param ghost the ghost's look, for a ghost; leave out for a stone
 */
export function selectionRingHeight(ghost: GhostVisual | undefined, seconds: number): number {
  return (ghost === undefined ? 0 : ghostBaseHeight(ghost, seconds)) + RING_LIFT;
}
