import { STONE_D, STONE_W } from './layout-constants';
import { compareCodePoint } from './sort';
import type { Vec3 } from './vec3';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT, GHOST_PICK_HALF } from './visual-constants';

/**
 * Which stone or ghost is under the pointer. Pure: a ray from the camera through the pointer is tested against one
 * box for every stone and ghost, taken from the layout, instead of against the geometry of the meshes. For 2,000
 * stones that is well under a millisecond, it runs only when the pointer moves, and it can be tested without a
 * renderer.
 */

/** Boxes are a little bigger than the stone, so a thin stone is easy to point at. */
export const PICK_PADDING = 0.1;

export interface PickTarget {
  kind: 'file' | 'ghost';
  path: string;
  min: Vec3;
  max: Vec3;
}

/** What the boxes need to know about a stone. */
export interface PickStone {
  path: string;
  /** Centre of the base on the ground. */
  x: number;
  z: number;
  height: number;
  /** 0 for an upright stone. */
  leanDegrees: number;
}

export interface PickGhost {
  path: string;
  x: number;
  z: number;
}

/**
 * One box per stone and ghost. A stone's box runs from the ground to its height and covers its base plus the padding;
 * for a leaning stone it is wider on every side by how far the top can reach (height × sin(lean)), because the layout
 * does not say which way it leans. A ghost's box covers the whole range it floats through.
 */
export function buildPickTargets(stones: readonly PickStone[], ghosts: readonly PickGhost[]): PickTarget[] {
  const targets: PickTarget[] = [];

  for (const stone of stones) {
    const reach = stone.leanDegrees > 0 ? stone.height * Math.sin((stone.leanDegrees * Math.PI) / 180) : 0;
    const halfW = STONE_W / 2 + PICK_PADDING + reach;
    const halfD = STONE_D / 2 + PICK_PADDING + reach;
    targets.push({
      kind: 'file',
      path: stone.path,
      min: { x: stone.x - halfW, y: 0, z: stone.z - halfD },
      max: { x: stone.x + halfW, y: stone.height + PICK_PADDING, z: stone.z + halfD },
    });
  }

  for (const ghost of ghosts) {
    targets.push({
      kind: 'ghost',
      path: ghost.path,
      min: {
        x: ghost.x - GHOST_PICK_HALF - PICK_PADDING,
        y: GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE,
        z: ghost.z - GHOST_PICK_HALF - PICK_PADDING,
      },
      max: {
        x: ghost.x + GHOST_PICK_HALF + PICK_PADDING,
        y: GHOST_FLOAT_BASE + GHOST_HEIGHT + GHOST_FLOAT_AMPLITUDE,
        z: ghost.z + GHOST_PICK_HALF + PICK_PADDING,
      },
    });
  }

  return targets;
}

/**
 * How far along the ray the box is first reached, in lengths of `direction`; 0 when the origin is inside the box;
 * `undefined` when the ray never reaches it (or the box is behind the origin).
 */
export function rayBoxDistance(target: PickTarget, origin: Vec3, direction: Vec3): number | undefined {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;

  const axes = [
    [origin.x, direction.x, target.min.x, target.max.x],
    [origin.y, direction.y, target.min.y, target.max.y],
    [origin.z, direction.z, target.min.z, target.max.z],
  ] as const;

  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      // Parallel to the two faces of this axis: inside the slab for the whole ray, or never.
      if (o < lo || o > hi) return undefined;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return undefined;
  }

  if (far < 0) return undefined;
  return Math.max(near, 0);
}

/**
 * The nearest box the ray reaches, or `undefined`. Equal distances go to the smaller path, so the answer does not
 * depend on the order of `targets`. A ray with no direction reaches nothing.
 */
export function pickNearest(targets: readonly PickTarget[], origin: Vec3, direction: Vec3): PickTarget | undefined {
  if (Math.abs(direction.x) < 1e-12 && Math.abs(direction.y) < 1e-12 && Math.abs(direction.z) < 1e-12) return undefined;

  let best: PickTarget | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const t = rayBoxDistance(target, origin, direction);
    if (t === undefined) continue;
    if (t < bestDistance || (t === bestDistance && best !== undefined && compareCodePoint(target.path, best.path) < 0)) {
      best = target;
      bestDistance = t;
    }
  }
  return best;
}
