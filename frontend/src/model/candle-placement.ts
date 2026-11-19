import { STONE_D } from './layout-constants';
import type { StoneModel } from './scene-model';
import { CANDLE_GAP, CANDLE_RADIUS, CANDLE_SIDE_OFFSET } from './visual-constants';

/**
 * Where the candles stand. Pure. A stone with `hot: true` gets one candle, just in front of its base (toward +z, the
 * side the opening view looks from) and a little to the right of its middle, so the plot's sign board cannot hide it,
 * inside the stone's own cell, so the candle can never overlap another stone, a ghost
 * or a plot (the overlap properties of the layout cover the whole cell).
 */

export interface CandleSpot {
  /** The stone this candle belongs to. */
  path: string;
  /** The centre of the candle's base on the ground. */
  x: number;
  z: number;
  /** Where in its flicker the candle starts, in radians, from a hash of the path. */
  phase: number;
}

/** The centre of the candle for a stone whose base is centred at (x, z). */
export const candleCentre = (x: number, z: number): { x: number; z: number } => ({
  x: x + CANDLE_SIDE_OFFSET,
  z: z + STONE_D / 2 + CANDLE_GAP + CANDLE_RADIUS,
});

/** One candle for each hot stone, in the order of the stones. */
export function candleSpots(stones: readonly StoneModel[]): CandleSpot[] {
  const spots: CandleSpot[] = [];
  for (const { file, layout, visual } of stones) {
    if (!visual.candle) continue;
    spots.push({ path: file.path, ...candleCentre(layout.x, layout.z), phase: visual.flickerPhase });
  }
  return spots;
}
