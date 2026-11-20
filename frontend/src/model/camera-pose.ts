import type { Layout } from './layout';
import type { Rect } from './rect';
import { GHOST_FLOAT_BASE, GHOST_HEIGHT } from './visual-constants';
import { DEFAULT_ASPECT, safeEstablishingShot } from './framing';
import { add, distance, lerp, normalize, scale, vec3, type Vec3 } from './vec3';

/**
 * Where the camera stands and what it looks at: for the starting view, for flying to a stone or ghost, and for the
 * steps in between. Pure: the animation clock is the only thing outside (scene/flight.ts).
 */

export interface CameraPose {
  position: Vec3;
  /** The point the camera looks at, which is also the centre the mouse orbits around. */
  target: Vec3;
}

// ---- The starting view ----

/** The vertical field of view of the scene's camera, in degrees. The opening shot is composed for it (`model/framing.ts`). */
export const DEFAULT_FOV_Y = 60; // wide enough to hold the sky with the moon above the horizon and the graveyard below it, from 22 degrees up

/**
 * The pose of the establishing shot that the scene opens on and Reset view returns to: the middle of the graveyard at ground
 * level as the look-at point, and a camera in front of it and above, as near as it can be with the whole graveyard in the frame
 * of a window of this shape. `fovY` is in degrees. The shot also has a lens shift (`establishingShot`), which is the same for every pose.
 * If there is no establishing shot for this lens, it is the legacy pose, with a development-only warning (`safeEstablishingShot`): it never throws.
 */
export function startPose(bounds: Rect, fovY: number, aspect: number = DEFAULT_ASPECT): CameraPose {
  return safeEstablishingShot(bounds, fovY, aspect).pose;
}

// ---- Flying to a stone or ghost ----

/** The camera looks at the target from in front of it and above, along this direction. */
const FLY_DIRECTION = normalize(vec3(0, 0.375, 1)); // 20.6 degrees above the horizontal: just above the 20 degree limit of the camera, close to the low angle the ghosts and stones are judged from

/** The camera aims at this share of the way up the stone, where its face is. */
const AIM_HEIGHT_SHARE = 0.55;

/** The distance from the target is `FLY_DISTANCE_PER_HEIGHT × height + FLY_DISTANCE_BASE`, kept between the two limits. */
const FLY_DISTANCE_PER_HEIGHT = 3.5;
const FLY_DISTANCE_BASE = 6;
const FLY_MIN_DISTANCE = 8;
const FLY_MAX_DISTANCE = 40;

/** What `flyTo` can fly to: a stone or a ghost, where it stands and how tall it is. */
export interface FlyTarget {
  kind: 'file' | 'ghost';
  path: string;
  /** Centre of its base on the ground. */
  x: number;
  z: number;
  /** A stone's height, or a ghost's figure. */
  height: number;
}

/** Every stone and ghost of the layout by path. A file and a ghost never share a path. */
export function buildFlyTargets(layout: Layout): Map<string, FlyTarget> {
  const targets = new Map<string, FlyTarget>();
  for (const stone of layout.stones) {
    targets.set(stone.path, { kind: 'file', path: stone.path, x: stone.x, z: stone.z, height: stone.height });
  }
  for (const ghost of layout.ghosts) {
    targets.set(ghost.path, { kind: 'ghost', path: ghost.path, x: ghost.x, z: ghost.z, height: GHOST_HEIGHT });
  }
  return targets;
}

/**
 * The pose that frames the stone or ghost with this path: looking at the middle of its face from in front and
 * above, at a distance that grows with its height. `undefined` for a path that is neither.
 */
export function flyToPose(targets: ReadonlyMap<string, FlyTarget>, path: string): CameraPose | undefined {
  const t = targets.get(path);
  if (t === undefined) return undefined;

  // A ghost floats, so its middle is higher above the ground than a stone's.
  const lift = t.kind === 'ghost' ? GHOST_FLOAT_BASE : 0;
  const target = vec3(t.x, lift + AIM_HEIGHT_SHARE * t.height, t.z);
  const away = Math.min(FLY_MAX_DISTANCE, Math.max(FLY_MIN_DISTANCE, FLY_DISTANCE_PER_HEIGHT * t.height + FLY_DISTANCE_BASE));
  return { position: add(target, scale(FLY_DIRECTION, away)), target };
}

// ---- Between two poses ----

/** Slow at both ends, fast in the middle. 0 gives 0, 1 gives 1, and the input is held to 0 to 1. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** How high a long flight rises over the straight line, as a share of its length, and the most it ever rises. */
const RISE_SHARE = 0.15;
const RISE_MAX = 30;

/**
 * The pose a fraction `t` (0 to 1) of the way through a flight from `a` to `b`, eased. A long flight rises a little in
 * the middle and settles, instead of skimming the fences: up to 15% of the flight's length, at most 30 units.
 */
export function interpolatePose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  if (t <= 0) return a;
  if (t >= 1) return b;

  const e = easeInOutCubic(t);
  const straight = lerp(a.position, b.position, e);
  const rise = Math.min(RISE_SHARE * distance(a.position, b.position), RISE_MAX) * Math.sin(Math.PI * e);
  return {
    position: vec3(straight.x, straight.y + rise, straight.z),
    target: lerp(a.target, b.target, e),
  };
}
