import { flyToPose, type CameraPose } from './camera-pose';
import { FENCE_POST, FENCE_RAIL, fenceInstances } from './fences';
import { clampPose, type CameraLimits } from './fly-controls';
import { STONE_D, STONE_W } from './layout-constants';
import { PICK_PADDING, rayBoxDistance } from './pick';
import type { SceneModel } from './scene-model';
import { plaqueBox } from './sign-fade';
import type { OccluderBox } from './sign-occlusion';
import { add, distance, scale, sub, vec3, type Vec3 } from './vec3';
import { GHOST_FLOAT_BASE, GHOST_HEIGHT } from './visual-constants';

/**
 * A clear view of the grave in focus (interface spec, Req 4.11). Pure. `flyTo` (and so a double-click, a list row and search) picks the
 * first of a few camera positions inside the camera's limits from which no stone, fence or sign box stands between the camera and the
 * grave's face; if none is fully clear it takes the one with the fewest in the way, and those fade while the grave is in focus.
 *
 * "In the way" is tested with rays: from the camera to a grid of points on the face, against the boxes of every other stone (its pick
 * box without the padding, which includes the reach of a lean), every fence post and rail, and every sign board.
 */

export type OccluderKind = 'stone' | 'fence' | 'sign';

export interface Occluder {
  kind: OccluderKind;
  /** A stone's or ghost's path; `post:<i>` or `rail:<i>` for a fence; the folder's path for a sign. */
  id: string;
  box: OccluderBox;
}

/** Every box that can stand in the way, built once per scene. Ghosts are see-through and stand in nobody's way. */
export function sceneOccluders(model: Pick<SceneModel, 'pickTargets' | 'layout' | 'signSources'>): Occluder[] {
  const out: Occluder[] = [];
  for (const t of model.pickTargets) {
    if (t.kind !== 'file') continue;
    out.push({ kind: 'stone', id: t.path, box: { min: vec3(t.min.x + PICK_PADDING, 0, t.min.z + PICK_PADDING), max: vec3(t.max.x - PICK_PADDING, t.max.y - PICK_PADDING, t.max.z - PICK_PADDING) } });
  }
  const fence = fenceInstances(model.layout);
  fence.posts.forEach((p, i) => {
    const h = FENCE_POST.width / 2;
    out.push({ kind: 'fence', id: `post:${i}`, box: { min: vec3(p.x - h, 0, p.z - h), max: vec3(p.x + h, FENCE_POST.height, p.z + h) } });
  });
  fence.rails.forEach((r, i) => {
    const [hx, hz] = r.axis === 'x' ? [r.length / 2, FENCE_RAIL.thickness / 2] : [FENCE_RAIL.thickness / 2, r.length / 2];
    const y0 = FENCE_RAIL.y - FENCE_RAIL.height / 2;
    out.push({ kind: 'fence', id: `rail:${i}`, box: { min: vec3(r.x - hx, y0, r.z - hz), max: vec3(r.x + hx, y0 + FENCE_RAIL.height, r.z + hz) } });
  });
  for (const s of model.signSources) out.push({ kind: 'sign', id: s.path, box: plaqueBox(s.x, s.z) });
  return out;
}

export interface Face {
  /** The grave's path. */
  path: string;
  /** Points on the face, a little in front of it, that must all be seen. */
  points: Vec3[];
  /** The middle of the face. */
  centre: Vec3;
  /** Half its diagonal. */
  radius: number;
}

const COLUMNS = 5;
const ROWS = 7;

/**
 * The face of a stone (its front, where RIP and the name are carved: the stone's width and height, upright) or of a ghost (the front of
 * its figure), as a grid of points just in front of it. Null for a path that is neither.
 */
export function faceOf(model: Pick<SceneModel, 'lookup' | 'stones' | 'ghosts'>, path: string): Face | null {
  const found = model.lookup.get(path);
  if (!found) return null;
  let x0: number, x1: number, y0: number, y1: number, z: number;
  if (found.kind === 'file') {
    const { x, z: sz, height } = model.stones[found.index]!.layout;
    [x0, x1, y0, y1, z] = [x - STONE_W / 2, x + STONE_W / 2, 0, height, sz + STONE_D / 2 + 0.02];
  } else {
    const { x, z: gz } = model.ghosts[found.index]!.layout;
    [x0, x1, y0, y1, z] = [x - 0.45, x + 0.45, GHOST_FLOAT_BASE, GHOST_FLOAT_BASE + GHOST_HEIGHT, gz + 0.47];
  }
  const points: Vec3[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const u = 0.05 + (0.9 * i) / (COLUMNS - 1);
      const v = 0.05 + (0.9 * j) / (ROWS - 1);
      points.push(vec3(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, z));
    }
  }
  return { path, points, centre: vec3((x0 + x1) / 2, (y0 + y1) / 2, z), radius: Math.hypot(x1 - x0, y1 - y0) / 2 };
}

/** The boxes that stand between the camera and any point of the face (the grave's own box never counts). */
export function blockersOf(camera: Vec3, face: Face, occluders: readonly Occluder[]): Occluder[] {
  const toCentre = sub(face.centre, camera);
  const length = Math.hypot(toCentre.x, toCentre.y, toCentre.z);
  const out: Occluder[] = [];
  for (const o of occluders) {
    if (o.id === face.path) continue;
    // A quick test first: the box must come near the line from the camera to the face's middle, before the face.
    const c = vec3((o.box.min.x + o.box.max.x) / 2, (o.box.min.y + o.box.max.y) / 2, (o.box.min.z + o.box.max.z) / 2);
    const r = Math.hypot(o.box.max.x - o.box.min.x, o.box.max.y - o.box.min.y, o.box.max.z - o.box.min.z) / 2;
    const t = ((c.x - camera.x) * toCentre.x + (c.y - camera.y) * toCentre.y + (c.z - camera.z) * toCentre.z) / (length * length);
    if (t < -r / length || t > 1 + r / length) continue;
    const near = add(camera, scale(toCentre, Math.min(1, Math.max(0, t))));
    if (distance(near, c) > r + face.radius * Math.min(1, Math.max(0, t)) + 0.05) continue;
    const target = { kind: 'file' as const, path: o.id, min: o.box.min, max: o.box.max };
    if (face.points.some((p) => {
      const hit = rayBoxDistance(target, camera, sub(p, camera));
      return hit !== undefined && hit < 1 - 1e-6;
    })) out.push(o);
  }
  return out;
}

/** A grave this short (or shorter) is looked at from higher up first: a fence rail or a stone in front hides a short one at a low angle. */
export const SHORT_STONE = 1.6;
const ELEVATIONS_SHORT = [32, 40, 48, 26, 20.6, 56, 64];
const ELEVATIONS_TALL = [20.6, 28, 36, 44, 52, 60];
/** Nearer than the flyTo distance, as a last resort: less room for something to stand in between. */
const NEARER = [1, 0.8];
const SIDEWAYS = [0, -12, 12, -24, 24];
/** Never nearer than this (the camera's own minimum zoom distance is 3). */
const MIN_AWAY = 6;
const RAD = Math.PI / 180;

/**
 * The camera positions `flyTo` tries for a grave, in order: at the distance it would fly to, higher elevations first for a short grave
 * (lower first for a tall one), then the same a little to each side, then all of it a fifth nearer. Each is put inside the camera's
 * limits.
 */
export function flyCandidates(model: Pick<SceneModel, 'flyTargets'>, path: string, limits: CameraLimits): CameraPose[] {
  const base = flyToPose(model.flyTargets, path);
  const target = model.flyTargets.get(path);
  if (!base || !target) return [];
  const away = distance(base.position, base.target);
  const elevations = target.height <= SHORT_STONE ? ELEVATIONS_SHORT : ELEVATIONS_TALL;
  const out: CameraPose[] = [];
  for (const k of NEARER) {
    for (const side of SIDEWAYS) {
      for (const e of elevations) {
        const dir = vec3(Math.sin(side * RAD) * Math.cos(e * RAD), Math.sin(e * RAD), Math.cos(side * RAD) * Math.cos(e * RAD));
        out.push(clampPose({ position: add(base.target, scale(dir, Math.max(MIN_AWAY, away * k))), target: base.target }, limits));
      }
    }
  }
  return out;
}

/**
 * The pose `flyTo` uses for a grave: the first candidate with nothing in the way, or else the one with the fewest in the way (the first
 * of those). `blockers` is what is still in the way from it: they fade while the grave is in focus.
 */
export function clearFlyPose(model: Pick<SceneModel, 'flyTargets' | 'lookup' | 'stones' | 'ghosts'>, path: string, limits: CameraLimits, occluders: readonly Occluder[]): { pose: CameraPose; blockers: Occluder[] } | null {
  const face = faceOf(model, path);
  const candidates = flyCandidates(model, path, limits);
  if (!face || candidates.length === 0) return null;
  let best: { pose: CameraPose; blockers: Occluder[] } | null = null;
  for (const pose of candidates) {
    const blockers = blockersOf(pose.position, face, occluders);
    if (blockers.length === 0) return { pose, blockers };
    if (best === null || blockers.length < best.blockers.length) best = { pose, blockers };
  }
  return best;
}
