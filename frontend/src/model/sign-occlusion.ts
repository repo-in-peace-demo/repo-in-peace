import { PICK_PADDING, rayBoxDistance, type PickTarget } from './pick';
import { signBox } from './sign-placement';
import { cross, dot, normalize, sub, vec3, type Vec3 } from './vec3';

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

/** What `labelBlocked` needs to know about the camera: where it is, which way it looks, its lens and the height of the view in pixels. */
export interface LabelView {
  position: Vec3;
  forward: Vec3;
  /** Vertical field of view, in degrees. */
  fovY: number;
  viewportHeight: number;
}

/**
 * Six points of the scene that the label of a sign covers on screen: the corners and the middles of the top and bottom edges of its
 * text box (`signBox`), whose bottom middle is the anchor. They lie in the plane through the anchor facing the camera, so each projects
 * where that part of the label is drawn. The camera's up is the scene's up, as three.js's `lookAt` has it.
 */
export function labelPoints(view: LabelView, anchor: Vec3, label: string): Vec3[] {
  const f = normalize(view.forward);
  const right = normalize(cross(f, vec3(0, 1, 0)));
  const up = cross(right, f);
  const depth = dot(sub(anchor, view.position), f);
  if (!(depth > 0) || (right.x === 0 && right.y === 0 && right.z === 0)) return [anchor];
  const perPixel = (2 * depth * Math.tan((view.fovY * Math.PI) / 360)) / view.viewportHeight;
  const box = signBox(label, 0, 0); // x from -w/2 to w/2, y from -h (the top) to 0 (the anchor), in pixels
  const points: Vec3[] = [];
  for (const px of [box.x0, 0, box.x1]) {
    for (const py of [0, -box.y0]) {
      points.push(vec3(anchor.x + (right.x * px + up.x * py) * perPixel, anchor.y + (right.y * px + up.y * py) * perPixel, anchor.z + (right.z * px + up.z * py) * perPixel));
    }
  }
  return points;
}

/** True when any part of the sign's label (any of `labelPoints`) is behind a stone: a label drawn over the canvas cannot be partly hidden. */
export function labelBlocked(view: LabelView, anchor: Vec3, label: string, boxes: readonly OccluderBox[]): boolean {
  return labelPoints(view, anchor, label).some((point) => signBlocked(view.position, point, boxes));
}
