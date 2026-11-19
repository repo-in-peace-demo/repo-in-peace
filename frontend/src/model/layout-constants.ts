/**
 * Every number that sets the layout, in one place (requirement 3.7). Units are about one metre.
 * The sizes below are first values: a task near the end of the rendering work reviews the density on
 * the real test files and tunes them once. Whatever the values, the tests in `layout-constants.test.ts`
 * and the layout properties must still pass.
 */

// ---- Stone height (tombstone-height.ts) ----

/** The height of the smallest stone: a file of 0 or 1 lines. */
export const MIN_STONE_H = 0.6;

/** The height of the largest stone: a file of LOC_AT_MAX_HEIGHT lines or more. */
export const MAX_STONE_H = 4.0;

/**
 * From this many lines upward a stone is at its largest. Real files range from 1 to 6,451 lines in
 * the test data, so the largest files are clamped rather than dwarfing everything else.
 */
export const LOC_AT_MAX_HEIGHT = 5000;
