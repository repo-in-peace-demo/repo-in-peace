import type { CameraPose } from './camera-pose';
import { devWarn } from './dev-warn';
import { cameraLimits, clampPose } from './fly-controls';
import type { Rect } from './rect';
import { add, dot, normalize, scale, sub, vec3, type Vec3 } from './vec3';

/**
 * The shots of the opening: the establishing shot that the scene opens on and that Reset view returns to, and the low shot that
 * the opening move starts from. Pure.
 *
 * The establishing shot is composed so that the first frame shows the whole scene with nobody touching anything:
 *   - the camera is in front of the graveyard and above it, looking at its middle from `ESTABLISHING_ELEVATION_DEG`;
 *   - the horizon is `HORIZON_FROM_TOP` of the way down the frame (the upper third), with the sky above it for the moon, the
 *     clouds and the hills, and the graveyard fills the rest, from a little over a third down to the bottom, with every plot in view;
 *   - the camera is as near as it can be with all four corners of the graveyard inside the frame for the window's own shape
 *     (a wide window is limited by the height, a narrow one by the width), so nothing important is cut off.
 *
 * What cannot all be had at once: with a horizon in the upper third, and a field of view of 60 degrees, a camera 30 to 35 degrees above
 * the graveyard would see it as a thin strip at the very bottom, and a graveyard filling 60 to 65 percent of the frame needs the camera
 * lower than 20 degrees. The shot uses 22 degrees (just above the camera's own limit of 20), the horizon at 22 percent from the top, and gets
 * the graveyard from about 45 percent down to the bottom: the largest picture that keeps both the sky and the whole graveyard in the frame.
 *
 * Why a "lens shift": a camera that looks down at the middle of the graveyard from 22 degrees has the graveyard in the middle of
 * the frame and the horizon off the top of it. To have the horizon near the top and the graveyard in the lower part, with the
 * camera still looking at the middle of the graveyard (so the mouse orbits around it), the picture is moved down in the frame by a
 * fixed share of its height, `viewShift`. It is what a shift lens does in architectural photography. Everything that projects a
 * point (picking, signs) uses the camera's own projection, which includes it.
 */

/** How far the camera is above the horizontal, seen from the middle of the graveyard, in the establishing shot. At least the limit of the camera (20). */
export const ESTABLISHING_ELEVATION_DEG = 22;

/** Where the horizon is in the establishing shot, as a share of the frame's height from the top: the upper third. */
export const HORIZON_FROM_TOP = 0.27;

/** The graveyard is kept this far from the sides of the frame, and its near edge this far from the bottom, as shares. */
export const FRAME_MARGIN_X = 0.035;
export const FRAME_BOTTOM = 0.965;

/** The camera is never nearer than this to the middle of the graveyard, so a tiny graveyard is not seen from inside. */
export const MIN_SHOT_DISTANCE = 20;

/** The shape of the window to compose for when it is not known (the tests and the model's own start pose). */
export const DEFAULT_ASPECT = 1.6;

/** The opening move starts this many degrees above the horizontal, seen from the front of the graveyard: close to eye level. */
export const OPENING_ELEVATION_DEG = 10;

/** The opening move takes this long, in milliseconds, to rise into the establishing shot. */
export const OPENING_DURATION_MS = 3600;

const RAD = Math.PI / 180;

/** The search for the establishing shot's distance: at most this many doublings to find one that fits, then this many bisection steps. */
const MAX_DOUBLINGS = 64;
const BISECTION_STEPS = 60;

/**
 * The narrowest vertical field of view, in degrees, for which the establishing shot exists. Far away the graveyard shrinks to its
 * middle at 0.5 + shift down the frame, and that must be above FRAME_BOTTOM: tan(fov / 2) > tan(elevation) / (2 (FRAME_BOTTOM - HORIZON_FROM_TOP)).
 */
export function minFovForShot(): number {
  return (2 * Math.atan(Math.tan(ESTABLISHING_ELEVATION_DEG * RAD) / (2 * (FRAME_BOTTOM - HORIZON_FROM_TOP)))) / RAD;
}

export interface Shot {
  pose: CameraPose;
  /** The share of the frame's height that the picture is moved down by (0 for none): see the top of this file. */
  viewShift: number;
}

/** The lens shift that puts the horizon at `HORIZON_FROM_TOP` when the camera looks down `elevationDeg` degrees. */
export function shiftForHorizon(fovY: number, elevationDeg: number, horizonFromTop: number = HORIZON_FROM_TOP): number {
  return horizonFromTop - 0.5 + Math.tan(elevationDeg * RAD) / (2 * Math.tan((fovY * RAD) / 2));
}

/**
 * Where a point is in the frame, from 0 to 1 across and from 0 to 1 down, for a camera with this pose and lens, or null if it is
 * behind the camera. `shift` moves the picture down by that share of the height.
 */
export function projectToFrame(pose: CameraPose, fovY: number, aspect: number, shift: number, point: Vec3): { x: number; y: number } | null {
  const forward = normalize(sub(pose.target, pose.position));
  const right = normalize(vec3(-forward.z, 0, forward.x)); // forward is never vertical here
  const up = vec3(right.y * forward.z - right.z * forward.y, right.z * forward.x - right.x * forward.z, right.x * forward.y - right.y * forward.x);
  const v = sub(point, pose.position);
  const depth = dot(v, forward);
  if (depth <= 1e-9) return null;
  const tanHalf = Math.tan((fovY * RAD) / 2);
  return {
    x: 0.5 + (dot(v, right) / (depth * tanHalf * aspect)) * 0.5,
    y: 0.5 - (dot(v, up) / (depth * tanHalf)) * 0.5 + shift,
  };
}

/** Where the horizon is in the frame, from the top: it depends only on the tilt, the lens and the shift. */
export function horizonInFrame(pose: CameraPose, fovY: number, aspect: number, shift: number): number {
  const ahead = normalize(vec3(pose.target.x - pose.position.x, 0, pose.target.z - pose.position.z));
  // A point very far away along the ground, level with the camera: it is on the horizon.
  const far = vec3(pose.position.x + ahead.x * 1e7, pose.position.y, pose.position.z + ahead.z * 1e7);
  return projectToFrame(pose, fovY, aspect, shift, far)!.y;
}

const corners = (bounds: Rect): Vec3[] => [
  vec3(bounds.x, 0, bounds.z),
  vec3(bounds.x + bounds.w, 0, bounds.z),
  vec3(bounds.x, 0, bounds.z + bounds.d),
  vec3(bounds.x + bounds.w, 0, bounds.z + bounds.d),
];

const centreOf = (bounds: Rect): Vec3 => vec3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);

/** The establishing shot for a graveyard with these bounds, a camera with this vertical field of view, and a window of this shape (width over height). */
export function establishingShot(bounds: Rect, fovY: number, aspect: number = DEFAULT_ASPECT): Shot {
  const target = centreOf(bounds);
  const direction = normalize(vec3(0, Math.tan(ESTABLISHING_ELEVATION_DEG * RAD), 1)); // toward the camera from the middle: in front, and up
  const shift = shiftForHorizon(fovY, ESTABLISHING_ELEVATION_DEG);
  const poseAt = (distance: number): CameraPose => ({ position: add(target, scale(direction, distance)), target });
  const fits = (distance: number): boolean =>
    corners(bounds).every((corner) => {
      const at = projectToFrame(poseAt(distance), fovY, aspect, shift, corner);
      return at !== null && at.x >= FRAME_MARGIN_X && at.x <= 1 - FRAME_MARGIN_X && at.y <= FRAME_BOTTOM;
    });

  // The nearest distance at which the whole graveyard fits: it fits at any greater distance, so bisect.
  let low = MIN_SHOT_DISTANCE;
  let high = Math.max(MIN_SHOT_DISTANCE * 2, Math.hypot(bounds.w, bounds.d) * 4 + 100);
  // Find a distance that fits by doubling. It may never fit: far away the graveyard shrinks to its middle, which sits at
  // 0.5 + shift down the frame, so a field of view under `minFovForShot()` keeps it below FRAME_BOTTOM at every distance.
  let doublings = 0;
  while (!fits(high)) {
    if (++doublings > MAX_DOUBLINGS || !Number.isFinite(high)) {
      throw new Error(
        `establishingShot: no camera distance fits the graveyard in the frame after ${MAX_DOUBLINGS} doublings ` +
          `(bounds ${JSON.stringify(bounds)}, fovY ${fovY}, aspect ${aspect}). ` +
          `With the camera ${ESTABLISHING_ELEVATION_DEG} degrees up and the horizon at ${HORIZON_FROM_TOP} of the frame, ` +
          `the vertical field of view must be over ${minFovForShot().toFixed(1)} degrees, the aspect above 0, and the bounds finite.`,
      );
    }
    high *= 2;
  }
  if (fits(low)) return { pose: poseAt(low), viewShift: shift };
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  return { pose: poseAt(high), viewShift: shift };
}

// ---- The fallback ----

/** The pose the scene used before the establishing shot: along this direction from the middle (31 degrees up), far enough back for a sphere around the graveyard to fit, with 15% to spare. */
const LEGACY_DIRECTION = normalize(vec3(0, 0.6, 1));
const LEGACY_MARGIN = 1.15;

/** The old starting pose: `max(MIN_SHOT_DISTANCE, 1.15 × radius / sin(fov / 2))` from the middle, with no lens shift. It exists for any field of view between 0 and 180 degrees. */
export function legacyShot(bounds: Rect, fovY: number): Shot {
  const target = centreOf(bounds);
  const radius = Math.hypot(bounds.w, bounds.d) / 2;
  const away = Math.max(MIN_SHOT_DISTANCE, (LEGACY_MARGIN * radius) / Math.sin((fovY * RAD) / 2));
  return { pose: { position: add(target, scale(LEGACY_DIRECTION, away)), target }, viewShift: 0 };
}

const isFiniteShot = (shot: Shot): boolean =>
  [shot.pose.position.x, shot.pose.position.y, shot.pose.position.z, shot.viewShift].every(Number.isFinite);

/**
 * The establishing shot, or the legacy shot when there is none (the search gave up, or the result is not a finite pose), with a
 * warning through `warn` (a development-only console warning by default). Never throws for finite bounds and a field of view
 * between 0 and 180 degrees, so the scene always opens. Every caller in the app goes through this, not `establishingShot`.
 */
export function safeEstablishingShot(bounds: Rect, fovY: number, aspect: number = DEFAULT_ASPECT, warn: (message: string) => void = devWarn): Shot {
  let reason: string;
  try {
    const shot = establishingShot(bounds, fovY, aspect);
    if (isFiniteShot(shot)) return shot;
    reason = `the shot is not a finite pose (${JSON.stringify(shot)})`;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  warn(`Repo In Peace: falling back to the legacy starting view. ${reason}`);
  return legacyShot(bounds, fovY);
}

/**
 * The shot that the opening move starts from: low, close to eye level (`OPENING_ELEVATION_DEG`), in front of the graveyard and
 * looking across its front rows, with no lens shift, so that the sky with the moon fills the upper half. It is nearer to the
 * front rows than the establishing shot, on the same line. The camera's tilt limit does not apply to it (the move is the one
 * exception), and the move leaves it for the establishing shot.
 */
export function openingShot(bounds: Rect, fovY: number, aspect: number = DEFAULT_ASPECT): Shot {
  const establishing = safeEstablishingShot(bounds, fovY, aspect);
  const centre = centreOf(bounds);
  // Look at a point a little in front of the middle, so the front rows fill the lower part of the view.
  const target = vec3(centre.x, 0, centre.z + bounds.d * 0.12);
  const back = Math.max(MIN_SHOT_DISTANCE, sub(establishing.pose.position, centre).z * 0.9); // how far in front of the middle, along the ground
  const lookDistance = back - bounds.d * 0.12;
  const height = Math.tan(OPENING_ELEVATION_DEG * RAD) * lookDistance;
  return { pose: { position: vec3(centre.x, Math.max(1, height), centre.z + back), target }, viewShift: 0 };
}

/** The shot between two shots, `t` from 0 to 1 (already eased): the pose and the lens shift both move in a straight line. */
export function blendShots(a: Shot, b: Shot, t: number): Shot {
  const mix = (p: Vec3, q: Vec3): Vec3 => vec3(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t);
  return {
    pose: { position: mix(a.pose.position, b.pose.position), target: mix(a.pose.target, b.pose.target) },
    viewShift: a.viewShift + (b.viewShift - a.viewShift) * t,
  };
}

/** True when the shot is inside every camera limit for these bounds (the establishing shot always is). */
export function shotIsInsideLimits(shot: Shot, bounds: Rect): boolean {
  return clampPose(shot.pose, cameraLimits(bounds)) === shot.pose;
}
