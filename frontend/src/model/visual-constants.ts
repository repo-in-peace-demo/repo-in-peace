/**
 * The numbers behind the visual effects. Each effect has one source (requirement 5): moss and lean read the
 * file's age and the thresholds, the cracks read `unused`, the candle reads `hot`, the ground tint reads the
 * nesting depth. These are the shapes of the curves; tune them here, and the tests in `visual-params.test.ts`
 * and `visual-params.property.test.ts` keep the ordering between them honest.
 */

// ---- Moss (visual-params.ts: mossAmount) ----

/** Moss amount of a stale stone on its first stale day: a first touch of green at the foot. */
export const MOSS_STALE_MIN = 0.1;

/** How much more moss a stale stone gets by its last stale day. The stale range ends just below MOSS_HEAVY. */
export const MOSS_STALE_SPAN = 0.55;

/** The least moss an ancient stone has: "heavily overgrown". Everything a stale stone can show is below it. */
export const MOSS_HEAVY = 0.7;

// ---- Lean (visual-params.ts: leanDegrees) ----

/** The lean of an ancient stone on its first ancient day, in degrees. The largest lean is MAX_LEAN_DEG (layout-constants.ts). */
export const LEAN_MIN_DEG = 2;

// ---- Cracks ----

/**
 * The strength of the faint red glow in the cracks of an unused stone, 0 to 1. The same for every unused
 * stone, so the glow means "unused" and nothing else.
 */
export const GLOW = 0.35;

// ---- Ghosts ----

/** How see-through a ghost is: 0 invisible, 1 solid. */
export const GHOST_OPACITY = 0.45;

/** How far a ghost bobs up and down, and how fast (radians a second). */
export const GHOST_FLOAT_AMPLITUDE = 0.15;
export const GHOST_FLOAT_SPEED = 0.6;

/**
 * The size of a ghost's figure, and how high above the ground its lowest point floats at rest: with the bob, the gap under it
 * is always at least GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE, so it clearly floats. The camera aims at its middle.
 */
export const GHOST_HEIGHT = 1.6;
export const GHOST_FLOAT_BASE = 0.7;

/** The ground a ghost's figure covers, along x and along z: a round figure, so the same both ways. It is inside its cell (2.4 by 1.8). */
export const GHOST_W = 1.0;
export const GHOST_D = 1.0;

// ---- Plot floors ----

/** The darkest a plot's floor gets, as a share of the root's: 0.7 is 30% darker. Subtle on purpose. */
export const FLOOR_SHADE_MIN = 0.7;

/** From this nesting depth on, the floor does not get any darker. */
export const FLOOR_SHADE_DEPTH_LIMIT = 6;

// ---- Candles (scene/Candles.tsx, model/candle-placement.ts) ----

/** The wax: a short thick candle, lower than the shortest stone (MIN_STONE_H) so it never reaches the mist and never hides a stone. */
export const CANDLE_RADIUS = 0.09;
export const CANDLE_HEIGHT = 0.3;

/** The flame on top of the wax, and the size of the soft glow around it (a camera-facing quad), in world units. */
export const FLAME_HEIGHT = 0.24;
export const CANDLE_GLOW_SIZE = 2.0;

/** The gap between the front of the stone's base and the candle's edge: the candle stands just in front of the stone. */
export const CANDLE_GAP = 0.25;

/**
 * How far to the right of the stone's middle the candle stands, still inside the stone's cell. A stone that is alone in its
 * plot stands right behind the plot's sign board, which would hide a candle placed straight in front of it from the front.
 */
export const CANDLE_SIDE_OFFSET = 0.9;
