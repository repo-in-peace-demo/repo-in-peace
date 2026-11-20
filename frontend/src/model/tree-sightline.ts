import type { Tree } from './horizon';
import { MAX_STONE_H } from './layout-constants';
import type { Rect } from './rect';
import { vec3, type Vec3 } from './vec3';

/**
 * Whether a tree stands between the camera and the graveyard (`model/horizon.ts` trees). Pure; used by the camera limits' property
 * tests and the browser test. Each tree's flat shape lies inside its box (base, across, width, height), so testing the box is safe:
 * it can only find a tree where there is one or nearly.
 */
/** True when the straight line from a to b passes through the tree's box (its flat shape is inside it): a conservative test. */
export function lineMeetsTree(a: Vec3, b: Vec3, tree: Tree): boolean {
  const n = { x: -tree.across.z, z: tree.across.x }; // the normal of the tree's plane, on the ground
  const da = (a.x - tree.base.x) * n.x + (a.z - tree.base.z) * n.z;
  const db = (b.x - tree.base.x) * n.x + (b.z - tree.base.z) * n.z;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return false;
  const t = da / (da - db);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const z = a.z + (b.z - a.z) * t;
  const u = ((x - tree.base.x) * tree.across.x + (z - tree.base.z) * tree.across.z) / tree.width;
  const v = (y - tree.base.y) / tree.height;
  return Math.abs(u) <= 0.5 && v >= 0 && v <= 1;
}

/** Points of the graveyard to look at: its corners and middle, on the ground and at the height of the tallest stone. */
export const graveyardPoints = (b: Rect): Vec3[] =>
  [0, MAX_STONE_H].flatMap((y) => [vec3(b.x, y, b.z), vec3(b.x + b.w, y, b.z), vec3(b.x, y, b.z + b.d), vec3(b.x + b.w, y, b.z + b.d), vec3(b.x + b.w / 2, y, b.z + b.d / 2)]);

/** The trees that stand between this camera position and a point of the graveyard. */
export const treesInTheWay = (camera: Vec3, b: Rect, trees: readonly Tree[]): Tree[] => trees.filter((t) => graveyardPoints(b).some((p) => lineMeetsTree(camera, p, t)));

