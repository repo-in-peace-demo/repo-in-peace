import { GHOST_FLOAT_BASE } from './visual-constants';
import type { GhostVisual } from './visual-params';

/**
 * Where a ghost is, in height, at a given time. One function, read by everything that needs to know: the ghost
 * mesh, the selection ring, and (through its range) the picking box. Whatever moves the ghost is changed here,
 * and the ring follows it every frame.
 *
 * Today ghosts do not bob: the plain box of task 15 is static, so this returns the float base. Task 23 adds the
 * bob (`floatAmplitude × sin(floatSpeed × seconds + phase)`, which stays within the box that `buildPickTargets` makes)
 * and changes this function and the vertex shader together.
 *
 * @returns the height of the ghost's lowest point above the ground
 */
export function ghostBaseHeight(_visual: GhostVisual, _seconds: number): number {
  return GHOST_FLOAT_BASE;
}
