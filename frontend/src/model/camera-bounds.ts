import { DEFAULT_FOV_Y } from './camera-pose';
import { DEFAULT_ASPECT, safeEstablishingShot } from './framing';
import { cameraLimits, type CameraLimits } from './fly-controls';
import { horizonPlan, nearBand } from './horizon';
import type { Rect } from './rect';
import { distance } from './vec3';

/**
 * The camera limits of the scene: the graveyard's own (`cameraLimits`), and three more that keep the camera inside the trees
 * that stand around it (`model/horizon.ts`), so it can never reach a tree or get behind one, and no tree can ever stand between
 * the camera and the graveyard:
 *
 *   - the camera is never further than ZOOM_OUT_SHARE times the establishing shot's distance from its look-at point;
 *   - the camera and its look-at point stay inside a circle a little inside the nearest trees of the ring (the framing trees);
 *   - and in front of a line a little in front of the nearer layer of trees behind the back fence;
 *   - and the camera may orbit only ORBIT_HALF_ANGLE_DEG to either side of the establishing shot's direction, so it never swings
 *     round to the sides or the back, where the trees and the stones are not composed to be seen from.
 *
 * Why no tree can then be in the way: the graveyard is inside the circle and in front of the line, and so is the camera; the
 * region inside both is convex, so the straight line from the camera to any point of the graveyard stays inside it, and every tree
 * stands outside it. The circle is never smaller than the establishing shot needs, so the opening view is never moved.
 */

/** The furthest zoom out, and the furthest back flight, as a multiple of the establishing shot's distance. */
export const ZOOM_OUT_SHARE = 1.3;

/** The circle is this share of the ring's radius: inside the nearest trees (the framing trees, from 0.93 of it). */
export const KEEP_INSIDE_SHARE = 0.88;

/** The camera may orbit this many degrees to either side of the establishing shot's direction, and no further. */
export const ORBIT_HALF_ANGLE_DEG = 50;

/** The line is this far in front of the first row of the nearer trees. */
export const NEAR_TREES_MARGIN = 1;

export function sceneCameraLimits(bounds: Rect, aspect: number = DEFAULT_ASPECT): CameraLimits {
  const base = cameraLimits(bounds);
  const plan = horizonPlan(bounds);
  const shot = safeEstablishingShot(bounds, DEFAULT_FOV_Y, aspect);
  const away = distance(shot.pose.position, shot.pose.target);
  const start = Math.hypot(shot.pose.position.x - plan.centre.x, shot.pose.position.z - plan.centre.z);
  return {
    ...base,
    maxDistance: Math.max(away * ZOOM_OUT_SHARE, 1),
    // Never smaller than the opening view needs (a very narrow window's establishing shot stands further back).
    keepInside: { x: plan.centre.x, z: plan.centre.z, radius: Math.max(plan.ridgeRadius * KEEP_INSIDE_SHARE, start * (1 + 1e-9)) },
    minZ: nearBand(plan).firstZ + NEAR_TREES_MARGIN,
    // From the look-at point toward the camera of the establishing shot: in front of the graveyard.
    azimuth: { ...groundDirection(shot.pose.position.x - shot.pose.target.x, shot.pose.position.z - shot.pose.target.z), maxDeg: ORBIT_HALF_ANGLE_DEG },
  };
}

const groundDirection = (x: number, z: number): { x: number; z: number } => {
  const n = Math.hypot(x, z);
  return n > 0 ? { x: x / n, z: z / n } : { x: 0, z: 1 };
};
