import type { HorizonPlan } from './horizon';
import { landHeightAt } from './horizon';
import { MIN_STONE_H } from './layout-constants';

/**
 * Ground mist (atmosphere, like the sky and the fog: it reads no file's facts, only the graveyard's bounds through the plan of the
 * land). A few thin, faint sheets lie over the ground: low between the rows of stones, and thicker and denser as they pool on the
 * hills at the foot of the slopes, fading out toward the ridge. Pure: the sheets are worked out here, the shader only rolls a
 * noise through them (`scene/Mist.tsx`).
 *
 * Readability comes first: inside the graveyard the top sheet is below the shortest stone's 60% (so moss and cracks on a stone
 * show above it), and all the sheets together let at least `MIST_MIN_SEE_THROUGH` of the stones show through.
 */

/** The sheets' heights above the ground inside the graveyard, lowest first. */
export const MIST_LAYER_HEIGHTS: readonly number[] = [0.06, 0.16, 0.28];

/** The most one sheet covers, at the densest of the noise and the pool. */
export const MIST_LAYER_MAX_ALPHA = 0.14;

/** How much of what is behind all the sheets at least shows through, at the densest. */
export const MIST_MIN_SEE_THROUGH = 0.6;

/** How dense the mist is inside the graveyard, between the rows, and at its densest on the hills (the pool). */
export const MIST_GRAVEYARD_WEIGHT = 0.75;
export const MIST_POOL_WEIGHT = 1;

/** On the hills the sheets lift and spread: their height grows to this many times its graveyard height at the ridge. */
export const MIST_HILL_LIFT = 10;

/** The mist ends at this share of the ridge's radius, fading out from MIST_FADE_FROM. */
const MIST_END = 1.04;
const MIST_FADE_FROM = 0.86;

/** The pale, moonlit grey-blue of the mist. Low saturation, so it is never taken for a ghost's cyan. */
export const MIST_COLOR = '#9aa8bd';

const smooth = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** How far the hills start from the middle along this direction (the fence and the gap), as `landHeightAt` does. */
function hillStart(plan: HorizonPlan, dx: number, dz: number): number {
  const ax = Math.abs(dx) < 1e-9 ? Infinity : plan.halfW / Math.abs(dx);
  const az = Math.abs(dz) < 1e-9 ? Infinity : plan.halfD / Math.abs(dz);
  return Math.min(ax, az) + plan.gap;
}

/**
 * Where a point of the ground is, from the mist's point of view: `slope` from 0 at the foot of the hills (and inside) to 1 at the
 * ridge, and `fade` from 1 to 0 toward the end of the mist.
 */
function placeOf(plan: HorizonPlan, x: number, z: number): { slope: number; fade: number; inside: boolean } {
  const ox = x - plan.centre.x;
  const oz = z - plan.centre.z;
  const r = Math.hypot(ox, oz);
  const R = plan.ridgeRadius;
  const start = r < 1e-9 ? Infinity : hillStart(plan, ox / r, oz / r);
  const slope = r <= start ? 0 : smooth((r - start) / Math.max(1e-6, R - start));
  const fade = 1 - smooth((r / R - MIST_FADE_FROM) / (MIST_END - MIST_FADE_FROM));
  return { slope, fade, inside: r <= start };
}

/**
 * How dense the mist is at a point of the ground, from 0 to 1 (before the rolling noise): MIST_GRAVEYARD_WEIGHT inside the
 * graveyard, rising to MIST_POOL_WEIGHT where it pools at the foot of the hills, thinning up the slopes, and 0 beyond the ridge.
 */
export function mistWeightAt(plan: HorizonPlan, x: number, z: number): number {
  const { slope, fade, inside } = placeOf(plan, x, z);
  if (inside) return MIST_GRAVEYARD_WEIGHT * fade;
  // A pool at the foot of the slope (thickest a little way up), thinning toward the ridge.
  const pool = Math.exp(-(((slope - 0.12) / 0.32) ** 2));
  const base = MIST_GRAVEYARD_WEIGHT + (MIST_POOL_WEIGHT - MIST_GRAVEYARD_WEIGHT) * pool;
  return Math.max(0, Math.min(1, base * (1 - 0.7 * slope) * fade));
}

/** How high above the land a sheet is at a point: its graveyard height inside, lifting up the slopes. */
export function mistLayerHeightAt(plan: HorizonPlan, layer: number, x: number, z: number): number {
  const { slope } = placeOf(plan, x, z);
  return MIST_LAYER_HEIGHTS[layer]! * (1 + (MIST_HILL_LIFT - 1) * slope);
}

export interface MistMesh {
  positions: Float32Array;
  /** The density weight of each point (mistWeightAt). */
  weights: Float32Array;
  /** Which sheet each point belongs to, 0 to MIST_LAYER_HEIGHTS.length - 1. */
  layers: Float32Array;
  indices: Uint32Array;
}

/** The sheets of mist: a square grid over the graveyard and the hills up to the ridge, one per height, following the land. */
export function mistMesh(plan: HorizonPlan, cells = 140): MistMesh {
  const half = plan.ridgeRadius * MIST_END;
  const side = cells + 1;
  const count = side * side * MIST_LAYER_HEIGHTS.length;
  const positions = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const layers = new Float32Array(count);
  const indices: number[] = [];
  MIST_LAYER_HEIGHTS.forEach((_h, layer) => {
    const first = layer * side * side;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const x = plan.centre.x - half + (2 * half * i) / cells;
        const z = plan.centre.z - half + (2 * half * j) / cells;
        const k = first + j * side + i;
        positions[k * 3] = x;
        positions[k * 3 + 1] = landHeightAt(plan, x, z) + mistLayerHeightAt(plan, layer, x, z);
        positions[k * 3 + 2] = z;
        weights[k] = mistWeightAt(plan, x, z);
        layers[k] = layer;
      }
    }
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = first + j * side + i;
        const quad = [a, a + 1, a + side, a + side + 1];
        if (quad.every((q) => weights[q]! <= 0)) continue; // beyond the ridge: no mist
        // Counter-clockwise seen from above (x then z grows), so the face looks up.
        indices.push(quad[0]!, quad[2]!, quad[1]!, quad[1]!, quad[2]!, quad[3]!);
      }
    }
  });
  return { positions, weights, layers, indices: Uint32Array.from(indices) };
}

/** How much of what is behind the mist shows through at the densest, with every sheet at its most. */
export const mistSeeThrough = (): number => (1 - MIST_LAYER_MAX_ALPHA) ** MIST_LAYER_HEIGHTS.length;

/** The top sheet inside the graveyard, as a share of the shortest stone. */
export const mistTopShareOfShortestStone = (): number => Math.max(...MIST_LAYER_HEIGHTS) / MIN_STONE_H;
