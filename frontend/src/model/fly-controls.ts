import type { CameraPose } from './camera-pose';
import type { Rect } from './rect';
import { add, normalize, scale, vec3, type Vec3 } from './vec3';

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
const KEYS: Record<string, keyof FlyInput | undefined> = {};
const BINDINGS: ReadonlyArray<[codes: readonly string[], axis: keyof FlyInput, sign: 1 | -1]> = [
  [['KeyW', 'ArrowUp'], 'forward', 1],
  [['KeyS', 'ArrowDown'], 'forward', -1],
  [['KeyD', 'ArrowRight'], 'right', 1],
  [['KeyA', 'ArrowLeft'], 'right', -1],
  [['KeyE'], 'up', 1],
  [['KeyQ'], 'up', -1],
];
void KEYS;

/** Every key code that moves the camera. */
export const FLY_KEY_CODES: ReadonlySet<string> = new Set(BINDINGS.flatMap(([codes]) => codes));

/** The keys that make the camera go faster while held. */
export const FAST_KEY_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];

/** How much faster Shift makes the camera. */
export const FLY_FAST_FACTOR = 3;

/** The camera never goes lower than this, so it cannot end up inside the ground. */
export const MIN_CAMERA_HEIGHT = 1;

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
 * are held to length 1. The look-at point is held inside `limits` (the graveyard and a margin), and the camera
 * never goes below MIN_CAMERA_HEIGHT.
 *
 * @param heading the direction the camera faces; its length does not matter
 * @param speed units a second
 * @param seconds the time since the last step
 */
export function moveCamera(pose: CameraPose, heading: Vec3, input: FlyInput, speed: number, seconds: number, limits: Rect): CameraPose {
  const flat = normalize(vec3(heading.x, 0, heading.z));
  const ahead = flat.x === 0 && flat.z === 0 ? vec3(0, 0, -1) : flat;
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
  const wanted = add(pose.target, step);
  const target = vec3(
    Math.min(limits.x + limits.w, Math.max(limits.x, wanted.x)),
    Math.max(0, wanted.y),
    Math.min(limits.z + limits.d, Math.max(limits.z, wanted.z)),
  );
  // Whatever the limits took off the look-at point is taken off the camera too, so the two stay together.
  const moved = add(add(pose.position, step), vec3(target.x - wanted.x, target.y - wanted.y, target.z - wanted.z));
  return { position: vec3(moved.x, Math.max(MIN_CAMERA_HEIGHT, moved.y), moved.z), target };
}
