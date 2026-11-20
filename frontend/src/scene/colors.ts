/**
 * The colours of the plain render: flat, so the layout can be judged before any effect is added.
 * The effects and the night atmosphere replace these in later tasks.
 */
export const BACKGROUND_COLOR = '#05070d';
export const GROUND_COLOR = '#0a0e13';
export const FLOOR_COLOR = '#1f2d26';
export const FENCE_COLOR = '#4b5260';
export const STONE_COLOR = '#8d939e';
export const GHOST_COLOR = '#8fe8f0'; // pale cyan: the one colour that means "deleted"
export const PLAQUE_COLOR = '#6b5a44';

/**
 * Feedback colours. A stone under the pointer is tinted pale blue-white. A selected stone is NOT tinted at all (a
 * lightened stone looks like a ghost): selection is shown by the ring at its base, in a colour no effect uses.
 */
export const HOVER_COLOR = '#cfe2ff';
export const SELECTION_RING_COLOR = '#ff4fd8'; // vivid magenta

/**
 * The colours the data effects use, as they are in the plain render and the legend swatches: stone grey, moss green,
 * the red of cracks, candle yellow, ghost cyan-blue. The selection ring must stay clear of all of them (colors.test.ts).
 * Add the real colours to this list when the effects get their materials (tasks 21 to 23).
 */
export const EFFECT_COLORS = {
  stone: STONE_COLOR,
  moss: '#5f8f4a',
  unused: '#e8582a', // red-orange: a pure red (#e05050) added onto a blue-grey stone read as pink, next to the ring's magenta
  candle: '#f0c24b',
  ghost: GHOST_COLOR,
} as const;
