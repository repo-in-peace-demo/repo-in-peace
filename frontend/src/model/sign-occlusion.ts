import { PICK_PADDING, rayBoxDistance, type PickTarget } from './pick';
import type { Vec3 } from './vec3';

/**
 * Whether a folder sign is hidden behind a stone, so its label (a page element over the canvas) is not drawn on top of the stone.
 * Pure: the same depth question drei's `<Html occlude>` asks, answered against one box per stone instead of the meshes. The boxes are
 * the stones' pick boxes without the padding that makes thin stones easy to point at; a leaning stone's box is still wider by the
 * reach of its lean, and the arch is boxed as a rectangle, so a label just past a stone's shoulder may hide a little early.
 * Ghosts are translucent and do not hide labels. Fences and plaques are thin and do not either.
 */

export interface OccluderBox {
  min: Vec3;
  max: Vec3;
}

/** One box for every stone of the scene: its pick box, less the padding. */
export function stoneOccluders(targets: readonly PickTarget[]): OccluderBox[] {
  return targets
    .filter((t) => t.kind === 'file')
    .map((t) => ({
      min: { x: t.min.x + PICK_PADDING, y: t.min.y, z: t.min.z + PICK_PADDING },
      max: { x: t.max.x - PICK_PADDING, y: t.max.y - PICK_PADDING, z: t.max.z - PICK_PADDING },
    }));
}

/** Rounding slack along the line from the camera to the sign, as a share of its length. */
const EPS = 1e-6;

/**
 * True when some box lies on the straight line from the camera to the sign's anchor, before the anchor. A box behind the sign, or
 * beside the line, does not hide it. A camera inside a box sees nothing past it.
 */
export function signBlocked(camera: Vec3, anchor: Vec3, boxes: readonly OccluderBox[]): boolean {
  const direction = { x: anchor.x - camera.x, y: anchor.y - camera.y, z: anchor.z - camera.z };
  if (direction.x === 0 && direction.y === 0 && direction.z === 0) return false;
  for (const box of boxes) {
    const t = rayBoxDistance({ kind: 'file', path: '', min: box.min, max: box.max }, camera, direction);
    if (t !== undefined && t < 1 - EPS) return true;
  }
  return false;
}
