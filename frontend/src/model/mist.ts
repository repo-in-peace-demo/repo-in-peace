import type { HorizonPlan } from './horizon';
import { landHeightAt } from './horizon';
import { MIN_STONE_H } from './layout-constants';
import { CANDLE_HEIGHT, GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE } from './visual-constants';

/**
 * Ground mist (atmosphere, like the sky and the fog: it reads no file's facts, only the graveyard's bounds through the plan of the
 * land). A thin, see-through layer lies low over the ground and drifts between the rows of stones inside the graveyard; it thins
 * out just past the fence, so it never lies over the hills as a floor of cloud. Pure: the sheets are worked out here, the shader
 * only rolls a noise through them (`scene/Mist.tsx`).
 *
 * Readability comes first: the top sheet is under half a candle (so a candle, its flame, and the lower part of a cracked stone show
 * above it), far under a ghost's hem, and all the sheets together let at least `MIST_MIN_SEE_THROUGH` of what is behind them show.
 */

/** The sheets' heights above the ground, lowest first. */
export const MIST_LAYER_HEIGHTS: readonly number[] = [0.03, 0.07, 0.12];

/** The most one sheet covers, at the densest of the noise. */
export const MIST_LAYER_MAX_ALPHA = 0.07;

/** How much of what is behind all the sheets at least shows through, at the densest. */
export const MIST_MIN_SEE_THROUGH = 0.8;

/** How dense the mist is inside the graveyard: the whole of it. Outside it thins to nothing over MIST_EDGE units past the fence (or less, before the hills start). */
export const MIST_GRAVEYARD_WEIGHT = 1;
export const MIST_EDGE = 3;

/** The pale, moonlit grey-blue of the mist. Low saturation, so it is never taken for a ghost's cyan. */
export const MIST_COLOR = '#9aa8bd';

const smooth = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** How far a point is outside the graveyard's rectangle (0 inside). */
function outsideBy(plan: HorizonPlan, x: number, z: number): number {
  const ox = Math.max(0, Math.abs(x - plan.centre.x) - plan.halfW);
  const oz = Math.max(0, Math.abs(z - plan.centre.z) - plan.halfD);
  return Math.hypot(ox, oz);
}

/** How dense the mist is at a point of the ground, from 0 to 1 (before the rolling noise): 1 inside, thinning to 0 just past the fence. */
export function mistWeightAt(plan: HorizonPlan, x: number, z: number): number {
  return MIST_GRAVEYARD_WEIGHT * (1 - smooth(outsideBy(plan, x, z) / mistEdge(plan)));
}

/** How far past the fence the mist reaches: MIST_EDGE, or up to where the hills start if that is nearer. */
export const mistEdge = (plan: HorizonPlan): number => Math.min(MIST_EDGE, plan.gap);

/** How high above the land a sheet is: the same everywhere, low. */
export function mistLayerHeightAt(_plan: HorizonPlan, layer: number, _x: number, _z: number): number {
  return MIST_LAYER_HEIGHTS[layer]!;
}

export interface MistMesh {
  positions: Float32Array;
  /** The density weight of each point (mistWeightAt). */
  weights: Float32Array;
  /** Which sheet each point belongs to, 0 to MIST_LAYER_HEIGHTS.length - 1. */
  layers: Float32Array;
  indices: Uint32Array;
}

/** The sheets of mist: a grid over the graveyard and MIST_EDGE beyond its fence, one per height, following the land. */
export function mistMesh(plan: HorizonPlan, cellSize = 1): MistMesh {
  const halfW = plan.halfW + mistEdge(plan);
  const halfD = plan.halfD + mistEdge(plan);
  const cellsX = Math.max(2, Math.min(400, Math.ceil((2 * halfW) / cellSize)));
  const cellsZ = Math.max(2, Math.min(400, Math.ceil((2 * halfD) / cellSize)));
  const sideX = cellsX + 1;
  const sideZ = cellsZ + 1;
  const perLayer = sideX * sideZ;
  const count = perLayer * MIST_LAYER_HEIGHTS.length;
  const positions = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const layers = new Float32Array(count);
  const indices: number[] = [];
  MIST_LAYER_HEIGHTS.forEach((_h, layer) => {
    const first = layer * perLayer;
    for (let j = 0; j < sideZ; j++) {
      for (let i = 0; i < sideX; i++) {
        const x = plan.centre.x - halfW + (2 * halfW * i) / cellsX;
        const z = plan.centre.z - halfD + (2 * halfD * j) / cellsZ;
        const k = first + j * sideX + i;
        positions[k * 3] = x;
        positions[k * 3 + 1] = landHeightAt(plan, x, z) + mistLayerHeightAt(plan, layer, x, z);
        positions[k * 3 + 2] = z;
        weights[k] = mistWeightAt(plan, x, z);
        layers[k] = layer;
      }
    }
    for (let j = 0; j < cellsZ; j++) {
      for (let i = 0; i < cellsX; i++) {
        const a = first + j * sideX + i;
        const quad = [a, a + 1, a + sideX, a + sideX + 1];
        if (quad.every((q) => weights[q]! <= 0)) continue;
        // Counter-clockwise seen from above (x then z grows), so the face looks up.
        indices.push(quad[0]!, quad[2]!, quad[1]!, quad[1]!, quad[2]!, quad[3]!);
      }
    }
  });
  return { positions, weights, layers, indices: Uint32Array.from(indices) };
}

/** How much of what is behind the mist shows through at the densest, with every sheet at its most. */
export const mistSeeThrough = (): number => (1 - MIST_LAYER_MAX_ALPHA) ** MIST_LAYER_HEIGHTS.length;

/** The top sheet, as a share of the shortest stone, of a candle, and of the lowest a ghost's hem goes. */
export const mistTopShareOfShortestStone = (): number => Math.max(...MIST_LAYER_HEIGHTS) / MIN_STONE_H;
export const mistTopShareOfCandle = (): number => Math.max(...MIST_LAYER_HEIGHTS) / CANDLE_HEIGHT;
export const mistTopBelowGhostHem = (): number => GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE - Math.max(...MIST_LAYER_HEIGHTS);
