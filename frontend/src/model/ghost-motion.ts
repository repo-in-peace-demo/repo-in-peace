import { GHOST_FLOAT_BASE } from './visual-constants';
import type { GhostVisual } from './visual-params';

/**
 * Where a ghost is, in height, at a given time: it floats gently, `floatAmplitude × sin(floatSpeed × seconds + phase)` up
 * and down around its float base. One function, read by everything that needs to know: the selection ring (every frame),
 * the picking box (through its range, which covers the whole bob), and the ghost's vertex shader, which repeats this
 * formula in GLSL (`scene/ghost-material.ts`; a browser test compares the ring with the drawn ghost).
 *
 * @returns the height of the ghost's lowest point above the ground
 */
export function ghostBaseHeight(visual: GhostVisual, seconds: number): number {
  return GHOST_FLOAT_BASE + visual.floatAmplitude * Math.sin(visual.floatSpeed * seconds + visual.phase);
}
