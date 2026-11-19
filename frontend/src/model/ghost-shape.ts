import { GHOST_D, GHOST_HEIGHT, GHOST_PICK_HALF, GHOST_W } from './visual-constants';

/**
 * The look of a ghost, as numbers, so it can be tested and so the shader and the tests use the same ones. Our own design: a
 * classic sheet ghost, a rounded head and a body that widens slightly toward the hem, turned on a lathe so that it is round.
 * Not a copy of any brand's mascot.
 *
 * Three details make it recognisable and make it ours:
 *  - the hem, the bottom edge of the sheet, is cut in the shape of curly braces `{ }` (a code ghost), see `hemHeight`;
 *  - two dark eye holes on the side that faces the camera's default direction (+z), see `GHOST_EYES`;
 *  - a small toe tag with the deleted file's type, see `GHOST_TAG` and `model/ghost-tag.ts`.
 */

/**
 * The outline of the sheet: (radius, height above the lowest point), from the hem up to the top of the head. The body
 * widens slightly downward, the head is a rounded dome. Height is `GHOST_HEIGHT`.
 */
export const GHOST_PROFILE: ReadonlyArray<readonly [radius: number, height: number]> = [
  [0.44, 0.0],
  [0.44, 0.06],
  [0.44, 0.12],
  [0.44, 0.19],
  [0.438, 0.27],
  [0.435, 0.36],
  [0.42, 0.45],
  [0.395, 0.75],
  [0.365, 1.05],
  [0.34, 1.3],
  [0.335, 1.45],
  [0.32, 1.62],
  [0.28, 1.78],
  [0.2, 1.92],
  [0.1, 1.985],
  [0.0, 2.0],
];

/** The widest the figure gets. */
export const GHOST_MAX_RADIUS = Math.max(...GHOST_PROFILE.map(([radius]) => radius));

/** The height of the figure: what the camera aims at, what the picking box covers and what the ring sits under. */
export const GHOST_TOP = Math.max(...GHOST_PROFILE.map(([, height]) => height));

/** The hem and the body drift sideways by at most this far (the shader's sway), so the figure stays inside its ground. */
export const GHOST_SWAY = 0.06;

// ---- The hem: curly braces ----

/** How many braces the hem has all the way round. Seen from the front, which is half of the way round, there is a pair: `{ }`. */
export const HEM_BRACES = 4;

/** The depth of the brace pattern: the difference between its lowest tip and its highest end. */
export const HEM_DEPTH = 0.3;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The height of the hem's edge above the figure's lowest point, along one brace, for u from 0 to 1. A curly brace laid on its
 * side (`︸`): the two ends curl up, a flat run, and a tip that points down in the middle. The sheet is cut away below this
 * line, and the shader uses the same formula. The tip is at 0, the flat runs at half of HEM_DEPTH, the ends at 1.45 times it.
 */
export function hemHeight(u: number): number {
  const fromEnd = Math.min(u, 1 - u);
  const endsUp = 1 - smoothstep(0, 0.16, fromEnd);
  const tipDown = 1 - smoothstep(0, 0.1, Math.abs(u - 0.5));
  return HEM_DEPTH * (0.95 * endsUp + 0.5 * (1 - tipDown));
}

/** The hem's height at an angle around the figure, in radians: the braces repeat HEM_BRACES times in a turn. */
export function hemHeightAt(angle: number): number {
  const turns = (angle / (2 * Math.PI)) * HEM_BRACES;
  return hemHeight(turns - Math.floor(turns));
}

/**
 * The two tips on the front half curl outward, away from the body, like the ends of `{` and `}`: near the bottom of a tip
 * the sheet bends out by up to GHOST_CURL, most at the lowest point and fading to nothing by GHOST_CURL_HEIGHT above it.
 * The shader applies `tipCurl` to the radius and the hem cut stays where it was, so the points hook out.
 */
export const GHOST_CURL = 0.13;
export const GHOST_CURL_HEIGHT = 0.3;

/** How far outward (along the radius) a point of the figure at this angle and height above the hem is moved: only near a tip, only low down. */
export function tipCurl(angle: number, height: number): number {
  const turns = (angle / (2 * Math.PI)) * HEM_BRACES;
  const u = turns - Math.floor(turns);
  const nearTip = 1 - smoothstep(0, 0.14, Math.abs(u - 0.5));
  const low = 1 - smoothstep(0, GHOST_CURL_HEIGHT, height);
  return GHOST_CURL * nearTip * low * low;
}

// ---- The face ----

/** The eye holes, on the side facing +z (the camera's default direction): centre in x and in height, and the size of each. */
export const GHOST_EYES = {
  left: { x: -0.13, y: 1.5 },
  right: { x: 0.13, y: 1.5 },
  radiusX: 0.065,
  radiusY: 0.1,
} as const;

// ---- The tag ----

/**
 * The toe tag. It hangs from a thread fastened to the body at the front right (an angle from +z toward +x, at a height),
 * and the card hangs `THREAD` below that point and a little in front of the body. Positions are relative to the middle of the
 * ghost on the ground, with heights above its lowest point; the card faces the camera.
 */
export const GHOST_TAG = {
  /** Where the thread is fastened to the body, as an angle from +z toward +x, and the height. */
  attachAngle: 0.65,
  attachHeight: 1.0,
  /** The length of the thread, and how far in front of the body the card hangs. */
  thread: 0.16,
  standOff: 0.09,
  /** The size of the card. */
  width: 0.42,
  height: 0.22,
} as const;

/** The radius of the figure at a height, from its outline. */
export function ghostRadiusAt(height: number): number {
  for (let i = 1; i < GHOST_PROFILE.length; i++) {
    const [r0, h0] = GHOST_PROFILE[i - 1]!;
    const [r1, h1] = GHOST_PROFILE[i]!;
    if (height <= h1) return r0 + ((r1 - r0) * (height - h0)) / (h1 - h0);
  }
  return 0;
}

/** Where the thread is fastened and where the middle of the card hangs, relative to the ghost's middle on the ground (heights above its lowest point). */
export function ghostTagPlacement(): { attach: { x: number; y: number; z: number }; card: { x: number; y: number; z: number } } {
  const { attachAngle, attachHeight, thread, standOff } = GHOST_TAG;
  const r = ghostRadiusAt(attachHeight);
  const attach = { x: r * Math.sin(attachAngle), y: attachHeight, z: r * Math.cos(attachAngle) };
  const out = r + standOff;
  return { attach, card: { x: out * Math.sin(attachAngle), y: attachHeight - thread - GHOST_TAG.height / 2, z: out * Math.cos(attachAngle) } };
}

/** The farthest any part of the tag reaches from the ghost's middle on the ground, with its sway. */
export function ghostTagReach(): number {
  const { card } = ghostTagPlacement();
  return Math.hypot(card.x, card.z) + GHOST_TAG.width / 2 + GHOST_SWAY;
}

/** True when the body, with its curled tips and its sway, fits inside the ground given to the ghost, and the tag inside its picking box. */
export const ghostFits = (): boolean =>
  GHOST_MAX_RADIUS + GHOST_CURL + GHOST_SWAY <= Math.min(GHOST_W, GHOST_D) / 2 + 1e-9 && GHOST_TOP <= GHOST_HEIGHT + 1e-9 && ghostTagReach() <= GHOST_PICK_HALF;
