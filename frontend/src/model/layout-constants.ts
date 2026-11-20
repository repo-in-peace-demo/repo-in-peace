/**
 * Every number that sets the layout, in one place (requirement 3.7). Units are about one metre.
 * The sizes below are first values: a task near the end of the rendering work reviews the density on
 * the real test files and tunes them once. Whatever the values, the tests in `layout-constants.test.ts`
 * and the layout properties must still pass.
 */

// ---- Stone height (tombstone-height.ts) ----

/** The height of the smallest stone: a file of 0 or 1 lines. */
export const MIN_STONE_H = 0.8; // task 25: 0.6 read as a pebble from the overview

/** The height of the largest stone: a file of LOC_AT_MAX_HEIGHT lines or more. */
export const MAX_STONE_H = 4.0;

/**
 * From this many lines upward a stone is at its largest. Real files range from 1 to 6,451 lines in
 * the test data, so the largest files are clamped rather than dwarfing everything else.
 */
export const LOC_AT_MAX_HEIGHT = 5000;

// ---- Stones and cells ----

/** The base of a tombstone slab, along x and along z. */
export const STONE_W = 1.4; // task 25: 1.0 by 0.4 left most of each cell bare
export const STONE_D = 0.5;

/**
 * The largest lean any stone can have, in degrees. Only ancient stones lean (visual-params.ts), and
 * never by more than this.
 */
export const MAX_LEAN_DEG = 8; // task 25: from 10, so the reservation for the lean (below) takes less of each cell

/**
 * How far a leaning stone's top can reach beyond its base on the ground, reserved around every stone so that a
 * leaning stone never reaches into a neighbour. It must be at least `MAX_STONE_H * sin(MAX_LEAN_DEG)` (0.557).
 * The reservation is the same for every stone, whether it leans or not, so the rows stay regular.
 */
export const LEAN_REACH = 0.56;

/** A cell is the ground one stone (or ghost) reserves: its base plus the reach on every side. */
export const CELL_W = STONE_W + 2 * LEAN_REACH;
export const CELL_D = STONE_D + 2 * LEAN_REACH;

/** The gap between neighbouring cells, along x and along z. */
export const CELL_GAP = 0.3;

/** Distance from one cell's corner to the next one's, along x and along z. */
export const CELL_PITCH_X = CELL_W + CELL_GAP;
export const CELL_PITCH_Z = CELL_D + CELL_GAP;

// ---- Plots ----

/** The inset between a plot's outer rectangle (its fence line) and what it holds. */
export const FENCE_BAND = 1.5;

/** The gap between the things a plot holds: its block of stones and its child plots. */
export const ITEM_GAP = 2.5;

/**
 * How many strip widths the packer tries for a plot's contents, between the widest item and about twice the side of
 * a square of the same total area. The packing with the shortest longer side wins, which is the one closest to a square.
 * More widths pack a little better and take a little longer; the speed guards in scene-model.test.ts keep it honest.
 */
export const PACK_WIDTH_CANDIDATES = 25;

// ---- Signs ----

/** The plaque at the front of a plot: its footprint along x and along z. It lies inside the fence band. */
export const SIGN_W = 1.6;
export const SIGN_D = 0.5;

/**
 * The least distance between the centres of any two plaques on the ground. A board is 1.4 wide, so plaques this far apart
 * (about twice that) never overlap on the screen: a plot and the one inside it must not have their front fences so near that
 * the two signs cross. A property of the layout checks it for every tree.
 */
export const SIGN_MIN_SEPARATION = 3;

/**
 * Extra depth added to the front band of a plot that holds child plots, so a child in the front row has its own plaque at
 * least SIGN_MIN_SEPARATION behind the plaque of the plot around it (the two stand on the same middle line when the child
 * is as wide as what is beside it). A plot with no child plots does not need it. With FENCE_BAND this is exactly enough.
 */
export const FRONT_BAND_EXTRA = SIGN_MIN_SEPARATION - FENCE_BAND;
