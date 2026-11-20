import type { HorizonPlan } from './horizon';
import { landHeightAt, nearBand } from './horizon';
import { MIN_STONE_H } from './layout-constants';
import { CANDLE_HEIGHT, GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE } from './visual-constants';

/**
 * Ground mist (atmosphere, like the sky and the fog: it reads no file's facts, only the graveyard's bounds through the plan of the
 * land). A thin, see-through layer lies low over the ground and drifts between the rows of stones inside the graveyard; it thins
 * out just past the fence. Behind the back fence a separate low mist lies around the bases of the nearer trees (below). Pure: the sheets are worked out here, the shader
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

/** How dense the mist is inside the graveyard: the whole of it. Outside it thins to nothing over MIST_EDGE units past the fence (or less, before the nearest trees). */
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

/** How far past the fence the mist reaches: MIST_EDGE, or up to where the nearest trees may stand if that is nearer. */
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

// ---- Low mist around the nearer trees, behind the back fence ----

/**
 * Behind the back fence, apart from the graveyard's mist: faint, low sheets around the bases of the nearer layer of trees
 * (`nearTrees`), from where the graveyard's mist ends to the far forest, fading out to the sides and at both ends. Their heights
 * are a share of how tall those trees are, so they lie around the trunks and well under the treetops.
 */
export const BACK_MIST_LAYER_SHARES: readonly number[] = [0.015, 0.035, 0.06];
export const BACK_MIST_MAX_ALPHA = 0.12;

/** How dense the back mist is at a point, 0 to 1: only behind the graveyard's mist, between it and the far forest. */
export function backMistWeightAt(plan: HorizonPlan, x: number, z: number): number {
  const { firstZ, lastZ } = nearBand(plan);
  const start = plan.centre.z - plan.halfD - mistEdge(plan); // where the graveyard's mist has ended
  const end = Math.max(lastZ - (firstZ - lastZ) * 0.15, plan.centre.z - plan.ridgeRadius * 0.98); // before the far forest
  if (z >= start || z <= end) return 0;
  const inFrom = smooth((start - z) / Math.max(1e-6, start - firstZ + 2));
  const outTo = smooth((z - end) / Math.max(1e-6, (firstZ - lastZ) * 0.3));
  const side = Math.abs(x - plan.eye.x) / Math.max(1e-6, (plan.eye.z - z) * Math.tan((55 * Math.PI) / 180));
  return Math.max(0, Math.min(1, inFrom * outTo * (1 - smooth((side - 0.8) / 0.2))));
}

/** The back mist as flat sheets over the ground behind the back fence. */
export function backMistMesh(plan: HorizonPlan, cells = 120): MistMesh {
  const { lastZ } = nearBand(plan);
  const typical = Math.max(1, plan.eye.y - plan.ridgeHeight);
  const zFrom = plan.centre.z - plan.halfD - mistEdge(plan);
  const zTo = lastZ - Math.abs(zFrom - lastZ) * 0.2;
  const halfX = (plan.eye.z - zTo) * Math.tan((55 * Math.PI) / 180);
  const side = cells + 1;
  const perLayer = side * side;
  const count = perLayer * BACK_MIST_LAYER_SHARES.length;
  const positions = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const layers = new Float32Array(count);
  const indices: number[] = [];
  BACK_MIST_LAYER_SHARES.forEach((share, layer) => {
    const first = layer * perLayer;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const x = plan.eye.x - halfX + (2 * halfX * i) / cells;
        const z = zFrom + ((zTo - zFrom) * j) / cells;
        const k = first + j * side + i;
        positions[k * 3] = x;
        positions[k * 3 + 1] = typical * share;
        positions[k * 3 + 2] = z;
        weights[k] = backMistWeightAt(plan, x, z);
        layers[k] = layer;
      }
    }
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = first + j * side + i;
        const quad = [a, a + 1, a + side, a + side + 1];
        if (quad.every((q) => weights[q]! <= 0)) continue;
        indices.push(quad[0]!, quad[2]!, quad[1]!, quad[1]!, quad[2]!, quad[3]!);
      }
    }
  });
  return { positions, weights, layers, indices: Uint32Array.from(indices) };
}
