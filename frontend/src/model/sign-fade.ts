import type { OccluderBox } from './sign-occlusion';
import { signBox } from './sign-placement';
import { PLAQUE_BOARD, PLAQUE_POST, SIGN_HEIGHT } from './signs';
import { vec3, type Vec3 } from './vec3';

/**
 * Signs that stand in front of the grave in focus fade out (interface spec, Req 4.10): when a stone or ghost is selected or flown to,
 * every sign whose board or label would cover it on screen, and which is nearer the camera than it, fades out, so its RIP and name can
 * be read; it fades back in when the focus moves on. Pure: the scene gives the projection of its camera.
 */

/** A point on the screen in pixels, and its depth along the camera's view (scene units; positive in front). */
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** A box on the screen, and the depth of the thing it is the box of. */
export interface ScreenRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  depth: number;
}

/** How long a sign takes to fade out or back in, in seconds. */
export const SIGN_FADE_SECONDS = 0.25;
/** A sign this faded or more counts as out of the way. */
export const SIGN_FADED = 0.05;

/** The eight corners of a box. */
export function cornersOf(box: OccluderBox): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(vec3(x, y, z));
  return out;
}

/** The box a plaque (board and post) takes, standing at (x, z). */
export function plaqueBox(x: number, z: number): OccluderBox {
  const halfW = Math.max(PLAQUE_BOARD.w, PLAQUE_POST.w) / 2;
  const halfD = Math.max(PLAQUE_BOARD.d, PLAQUE_POST.w) / 2;
  return { min: vec3(x - halfW, 0, z - halfD), max: vec3(x + halfW, SIGN_HEIGHT + PLAQUE_BOARD.h / 2, z + halfD) };
}

/** The screen box of some points (null when any is behind the camera), with the depth of their middle. */
export function screenRectOf(points: readonly Vec3[], project: (p: Vec3) => ScreenPoint | null): ScreenRect | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let depth = 0;
  for (const p of points) {
    const s = project(p);
    if (s === null) return null;
    x0 = Math.min(x0, s.x);
    x1 = Math.max(x1, s.x);
    y0 = Math.min(y0, s.y);
    y1 = Math.max(y1, s.y);
    depth += s.depth;
  }
  return { x0, x1, y0, y1, depth: depth / Math.max(1, points.length) };
}

const overlap = (a: ScreenRect, b: Omit<ScreenRect, 'depth'>): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export interface FadeSign {
  path: string;
  label: string;
  /** Where the plaque stands, and where its label is anchored (the board's face). */
  x: number;
  z: number;
  anchor: Vec3;
}

/**
 * The signs in the way of the grave in focus (its box: the pick box of the stone or ghost): those nearer the camera than it whose board
 * or label covers it on screen. A sign behind the camera, or with the grave behind the camera, is never in the way.
 */
export function signsInTheWay(focus: OccluderBox, signs: readonly FadeSign[], project: (p: Vec3) => ScreenPoint | null): Set<string> {
  const out = new Set<string>();
  const face = screenRectOf(cornersOf(focus), project);
  if (face === null) return out;
  for (const sign of signs) {
    const board = screenRectOf(cornersOf(plaqueBox(sign.x, sign.z)), project);
    if (board === null || !(board.depth < face.depth)) continue;
    const at = project(sign.anchor);
    const label = at === null ? null : signBox(sign.label, at.x, at.y);
    if (overlap(face, board) || (label !== null && overlap(face, label))) out.add(sign.path);
  }
  return out;
}

/** One step of a sign's fade toward its target (0 out of the way, 1 shown), over SIGN_FADE_SECONDS; `seconds` of Infinity jumps there. */
export function stepFade(alpha: number, target: number, seconds: number): number {
  const step = seconds / SIGN_FADE_SECONDS;
  if (!(step < Infinity)) return target;
  return target > alpha ? Math.min(target, alpha + step) : Math.max(target, alpha - step);
}
