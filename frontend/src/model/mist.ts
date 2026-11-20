import type { HorizonPlan } from './horizon';
import { landHeightAt, slopeShare, valleyDepth } from './horizon';
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

// ---- Mist pooling on the hills ----

/**
 * On the hills, apart from the graveyard's mist: faint sheets lie in the dips of the rolling slopes (on the benches and in the
 * valleys of `slopeShare`), fading out toward the foot of the slope and toward the ridge, so they never meet the graveyard's mist
 * at a line and never reach the forest. Their heights are a share of how tall the hills are, so the mist is in proportion to them.
 */
export const HILL_MIST_LAYER_SHARES: readonly number[] = [0.02, 0.045, 0.075];
export const HILL_MIST_MAX_ALPHA = 0.17;

/** From this far up the slope (t) the hill mist fades in, and it has faded out by HILL_MIST_TO. */
const HILL_MIST_FROM = 0.08;
const HILL_MIST_TO = 0.85;

/** How much the hill mist pools at this point of the slope (angle around the ring, t up it): in the valleys and on the bench. */
export function hillMistWeight(angle: number, t: number): number {
  if (t <= HILL_MIST_FROM || t >= HILL_MIST_TO) return 0;
  const band = smooth((t - HILL_MIST_FROM) / 0.15) * (1 - smooth((t - 0.55) / (HILL_MIST_TO - 0.55)));
  // A bench is where the slope is flatter than its average: compare the rise over a short step with the average rise.
  const step = 0.04;
  const gradient = (slopeShare(angle, t + step) - slopeShare(angle, t - step)) / (2 * step);
  const bench = 1 - smooth(gradient / 1.1);
  const valley = valleyDepth(angle) / 0.45;
  return Math.max(0, Math.min(1, band * (0.25 + 0.5 * bench + 0.6 * valley)));
}

/** The hill mist as sheets following the slope, in rings that follow the fence like the land (`landMesh`). */
export function hillMistMesh(plan: HorizonPlan, segments = 256, steps = 28): MistMesh {
  const typical = Math.max(1, plan.eye.y - plan.ridgeHeight);
  const side = steps + 1;
  const perLayer = segments * side;
  const count = perLayer * HILL_MIST_LAYER_SHARES.length;
  const positions = new Float32Array(count * 3);
  const weights = new Float32Array(count);
  const layers = new Float32Array(count);
  const indices: number[] = [];
  HILL_MIST_LAYER_SHARES.forEach((share, layer) => {
    const first = layer * perLayer;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const start = hillStartAlong(plan, dx, dz);
      const R = Math.max(start + 1, plan.ridgeRadius);
      for (let j = 0; j < side; j++) {
        const t = HILL_MIST_FROM + ((HILL_MIST_TO - HILL_MIST_FROM) * j) / steps;
        const r = start + (R - start) * t;
        const x = plan.centre.x + dx * r;
        const z = plan.centre.z + dz * r;
        const k = first + j * segments + i;
        positions[k * 3] = x;
        positions[k * 3 + 1] = landHeightAt(plan, x, z) + typical * share;
        positions[k * 3 + 2] = z;
        weights[k] = hillMistWeight(angle, t);
        layers[k] = layer;
      }
    }
    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < segments; i++) {
        const a = first + j * segments + i;
        const b = first + j * segments + ((i + 1) % segments);
        if ([a, b, a + segments, b + segments].every((q) => weights[q]! <= 0)) continue;
        indices.push(a, b, a + segments, b, b + segments, a + segments);
      }
    }
  });
  return { positions, weights, layers, indices: Uint32Array.from(indices) };
}

/** Where the hills start along this direction from the middle: the fence and the gap, as the land has it. */
function hillStartAlong(plan: HorizonPlan, dx: number, dz: number): number {
  const ax = Math.abs(dx) < 1e-9 ? Infinity : plan.halfW / Math.abs(dx);
  const az = Math.abs(dz) < 1e-9 ? Infinity : plan.halfD / Math.abs(dz);
  return Math.min(ax, az) + plan.gap;
}
