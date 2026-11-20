import type { CameraPose } from './camera-pose';
import { MAX_STONE_H } from './layout-constants';
import type { Rect } from './rect';
import { add, scale, vec3, type Vec3 } from './vec3';

/**
 * Flying with the keyboard: W A S D or the arrows to move, Q and E for down and up, Shift to go faster.
 * Pure: which keys mean which way, how fast, and where a step of movement ends up. The scene only feeds it the
 * keys that are down and the time since the last frame.
 */

/** How the pressed keys ask the camera to move: each from -1 to 1. */
export interface FlyInput {
  /** Forward along the ground in the direction the camera faces (negative: back). */
  forward: number;
  /** To the right of that direction (negative: left). */
  right: number;
  /** Straight up (negative: down). */
  up: number;
}

/** Keys by `KeyboardEvent.code`, so the layout of the keyboard does not matter. */
const BINDINGS: ReadonlyArray<[codes: readonly string[], axis: keyof FlyInput, sign: 1 | -1]> = [
  [['KeyW', 'ArrowUp'], 'forward', 1],
  [['KeyS', 'ArrowDown'], 'forward', -1],
  [['KeyD', 'ArrowRight'], 'right', 1],
  [['KeyA', 'ArrowLeft'], 'right', -1],
  [['KeyE'], 'up', 1],
  [['KeyQ'], 'up', -1],
];

/** Every key code that moves the camera. */
export const FLY_KEY_CODES: ReadonlySet<string> = new Set(BINDINGS.flatMap(([codes]) => codes));

/** The keys that make the camera go faster while held. */
export const FAST_KEY_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];

/** How much faster Shift makes the camera. */
export const FLY_FAST_FACTOR = 3;

/** The camera never goes lower than this, so it cannot end up inside the ground. */
export const MIN_CAMERA_HEIGHT = 1;

/**
 * The camera stays at least this many degrees above the horizontal, seen from the point it looks at, whatever moves it (mouse,
 * keys, flights). Nearer the horizontal the graveyard collapses into a thin strip and the sky fills the screen. The opening
 * move of the app is the one exception (it starts lower, for a few seconds, and says so with `minTiltDeg: 0`).
 */
export const MIN_TILT_DEG = 20;

/** The look-at point may wander this far, as a share of the graveyard's radius, beyond the edge of the root plot. */
export const WANDER_MARGIN_SHARE = 0.25;

/** Half the diagonal of the graveyard's bounds: the size that the camera limits and the fly speed are scaled by. */
export const boundsRadius = (bounds: Rect): number => Math.hypot(bounds.w, bounds.d) / 2;

/**
 * The furthest the camera may be from its look-at point (zoom out), and the highest it may be above the ground.
 * One value for both, so E cannot lift the camera higher than the furthest zoom.
 */
export const maxCameraDistance = (radius: number): number => Math.max(100, 3 * radius);

/** Where the camera and the point it looks at may be. Used for every input by `clampPose`. */
export interface CameraLimits {
  /** The look-at point stays inside this rectangle on the ground (the root plot plus a margin). */
  area: Rect;
  /** The camera is never lower than this. */
  minCameraHeight: number;
  /** The camera is never higher than this. Must be at least `minCameraHeight`. */
  maxCameraHeight: number;
  /** The look-at point is between the ground (0) and this height (the tallest stone). */
  maxTargetHeight: number;
  /** The camera is at least this many degrees above the horizontal, seen from the look-at point; 0 for no limit. */
  minTiltDeg: number;
}

/** The limits for a graveyard with these bounds. */
export function cameraLimits(bounds: Rect): CameraLimits {
  const radius = boundsRadius(bounds);
  const margin = radius * WANDER_MARGIN_SHARE;
  return {
    area: { x: bounds.x - margin, z: bounds.z - margin, w: bounds.w + 2 * margin, d: bounds.d + 2 * margin },
    minCameraHeight: MIN_CAMERA_HEIGHT,
    maxCameraHeight: maxCameraDistance(radius),
    maxTargetHeight: MAX_STONE_H,
    minTiltDeg: MIN_TILT_DEG,
  };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * The one rule for where the camera may be, applied after every change to it: keys, mouse and the end of a flight.
 *
 * - The look-at point is brought inside `limits.area` sideways. The camera moves sideways by the same amount, so
 *   the view slides to a stop and its direction does not change.
 * - The look-at point's height is held between 0 and `maxTargetHeight`. The camera does not move for this, so a
 *   camera that keeps rising tilts down onto the graveyard.
 * - The camera's height is held between `minCameraHeight` and `maxCameraHeight`.
 * - The camera is held at least `minTiltDeg` above the horizontal, seen from the look-at point: if it is lower, it is lifted
 *   (the stronger of this and the floor wins). If the ceiling would stop the lift, the camera is brought nearer to the look-at
 *   point along the ground instead, to where the angle is just right at the ceiling.
 *
 * Returns the same object when the pose is already inside the limits, and never changes the pose it is given.
 * Clamping a clamped pose changes nothing.
 */
export function clampPose(pose: CameraPose, limits: CameraLimits): CameraPose {
  const { area } = limits;
  const tx = clamp(pose.target.x, area.x, area.x + area.w);
  const ty = clamp(pose.target.y, 0, limits.maxTargetHeight);
  const tz = clamp(pose.target.z, area.z, area.z + area.d);
  const dx = tx - pose.target.x;
  const dz = tz - pose.target.z;
  const cx = dx === 0 ? pose.position.x : pose.position.x + dx;
  const cz = dz === 0 ? pose.position.z : pose.position.z + dz;
  let cx2 = cx;
  let cz2 = cz;
  let cy = clamp(pose.position.y, limits.minCameraHeight, limits.maxCameraHeight);

  if (limits.minTiltDeg > 0) {
    const slope = Math.tan((limits.minTiltDeg * Math.PI) / 180);
    const ox = cx2 - tx;
    const oz = cz2 - tz;
    const along = Math.hypot(ox, oz);
    const needed = ty + along * slope; // the lowest the camera may be here
    if (cy < needed) {
      if (needed <= limits.maxCameraHeight) {
        cy = needed;
      } else {
        // The ceiling stops the lift: come in along the ground until the angle is right at the ceiling.
        cy = limits.maxCameraHeight;
        const allowed = Math.max(0, (cy - ty) / slope) * (1 - 1e-12);
        if (along > allowed) {
          const k = along > 0 ? allowed / along : 0;
          cx2 = tx + ox * k;
          cz2 = tz + oz * k;
        }
      }
    }
  }

  if (tx === pose.target.x && ty === pose.target.y && tz === pose.target.z && cy === pose.position.y && cx2 === pose.position.x && cz2 === pose.position.z) return pose;
  return { position: vec3(cx2, cy, cz2), target: vec3(tx, ty, tz) };
}

export function movementFromKeys(pressed: ReadonlySet<string>): FlyInput {
  const input: FlyInput = { forward: 0, right: 0, up: 0 };
  for (const [codes, axis, sign] of BINDINGS) {
    if (codes.some((code) => pressed.has(code))) input[axis] += sign; // opposite keys cancel
  }
  // Arrow and letter for the same direction together count once.
  for (const axis of ['forward', 'right', 'up'] as const) input[axis] = Math.max(-1, Math.min(1, input[axis]));
  return input;
}

export const isFast = (pressed: ReadonlySet<string>): boolean => FAST_KEY_CODES.some((code) => pressed.has(code));

/** Units a second: a share of the graveyard's size, between 5 and 80, times FLY_FAST_FACTOR when Shift is held. */
export function flySpeed(boundsRadius: number, fast: boolean): number {
  const base = Math.min(80, Math.max(5, 0.15 * boundsRadius));
  return fast ? base * FLY_FAST_FACTOR : base;
}

/**
 * Keys are ignored while the user is typing, so a search box can use the letters (a later spec adds one).
 * @param tagName the tag of the element that has the focus
 */
export function isTypingElement(tagName: string | undefined, isContentEditable: boolean): boolean {
  const tag = tagName?.toUpperCase();
  return isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * One step of flying. The camera and the point it looks at both move by the same amount, so the view turns neither
 * way and the mouse still orbits around the same point.
 *
 * Forward is along the ground, in the direction the camera faces (the camera looking straight down uses
 * the negative z direction). Moving diagonally is no faster than moving straight: the three inputs together
 * are held to length 1. This does not apply any limit: the caller passes the result to `clampPose`.
 *
 * @param heading the direction the camera faces; its length does not matter
 * @param speed units a second
 * @param seconds the time since the last step
 */
export function moveCamera(pose: CameraPose, heading: Vec3, input: FlyInput, speed: number, seconds: number): CameraPose {
  // A camera looking (almost) straight down has no direction along the ground to go forward in: use negative z.
  const along = Math.hypot(heading.x, heading.z);
  const looksDown = along <= 1e-9 * Math.hypot(heading.x, heading.y, heading.z);
  const ahead = looksDown ? vec3(0, 0, -1) : vec3(heading.x / along, 0, heading.z / along);
  const right = vec3(-ahead.z, 0, ahead.x);

  let direction = vec3(
    ahead.x * input.forward + right.x * input.right,
    input.up,
    ahead.z * input.forward + right.z * input.right,
  );
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0 || speed <= 0 || seconds <= 0) return pose;
  if (length > 1) direction = scale(direction, 1 / length);

  const step = scale(direction, speed * seconds);
  return { position: add(pose.position, step), target: add(pose.target, step) };
}
