/**
 * Axis-aligned rectangles on the ground plane. `(x, z)` is the minimum corner, `w` is the width along x and
 * `d` the depth along z. Used by the layout and by the tests that check it.
 */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Floating-point tolerance. Rectangles that only touch, or overlap by less than this, do not count as overlapping. */
export const EPS = 1e-9;

/** True when the rectangles share more than EPS of ground in both directions. A rectangle with no area overlaps nothing. */
export function overlaps(a: Rect, b: Rect): boolean {
  const sharedX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const sharedZ = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return sharedX > EPS && sharedZ > EPS;
}

/** True when `inner` lies inside `outer` (touching the edge is allowed, within EPS). */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.z + inner.d <= outer.z + outer.d + EPS
  );
}
