/**
 * What the signs depend on: where the camera is and which way it looks, its lens, and the size of the scene. When
 * none of it has changed since the last frame, the signs are not worked out again.
 */

export interface ViewSignature {
  px: number;
  py: number;
  pz: number;
  fx: number;
  fy: number;
  fz: number;
  fovY: number;
  aspect: number;
  width: number;
  height: number;
}

/** True when `next` is exactly the view of `previous`. `null` (nothing worked out yet) is never the same. */
export function sameView(previous: ViewSignature | null, next: ViewSignature): boolean {
  if (previous === null) return false;
  return (Object.keys(next) as Array<keyof ViewSignature>).every((key) => previous[key] === next[key]);
}
