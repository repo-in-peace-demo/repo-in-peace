import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { horizonPlan, landHeightAt, nearBand, nearTrees } from './horizon';
import { layout } from './layout';
import {
  MIST_EDGE,
  MIST_GRAVEYARD_WEIGHT,
  MIST_LAYER_HEIGHTS,
  MIST_MIN_SEE_THROUGH,
  mistMesh,
  mistSeeThrough,
  mistTopBelowGhostHem,
  mistTopShareOfCandle,
  mistTopShareOfShortestStone,
  mistWeightAt,
  BACK_MIST_LAYER_SHARES,
  backMistMesh,
  backMistWeightAt,
  mistEdge,
} from './mist';
import type { Rect } from './rect';

const boundsArb: fc.Arbitrary<Rect> = fc.record({
  x: fc.double({ min: -200, max: 200, noNaN: true }),
  z: fc.double({ min: -200, max: 200, noNaN: true }),
  w: fc.double({ min: 4, max: 800, noNaN: true }),
  d: fc.double({ min: 4, max: 800, noNaN: true }),
});

describe('ground mist', () => {
  it('stays readable: thin, low, below a candle, a ghost\'s hem and most of the shortest stone, and see-through at its densest', () => {
    expect(mistTopShareOfCandle()).toBeLessThanOrEqual(0.5);
    expect(mistTopShareOfShortestStone()).toBeLessThanOrEqual(0.25);
    expect(mistTopBelowGhostHem()).toBeGreaterThan(0.25);
    expect(mistSeeThrough()).toBeGreaterThanOrEqual(MIST_MIN_SEE_THROUGH);
  });

  it('is in the graveyard, between its rows, and thins to nothing just past its fence: no floor of cloud over the hills', () => {
    fc.assert(
      fc.property(boundsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), (b, u, v, far) => {
        const plan = horizonPlan(b);
        const inside = mistWeightAt(plan, b.x + u * b.w, b.z + v * b.d);
        const angle = u * Math.PI * 2;
        const r = Math.hypot(b.w, b.d) / 2 + MIST_EDGE + far * 100;
        const beyond = mistWeightAt(plan, plan.centre.x + Math.cos(angle) * r, plan.centre.z + Math.sin(angle) * r);
        return Math.abs(inside - MIST_GRAVEYARD_WEIGHT) < 1e-9 && beyond === 0;
      }),
      { numRuns: 200 },
    );
  });

  it('lies flat over the land at its sheet heights, and nowhere over the rising hills', () => {
    for (const b of [{ x: 0, z: 0, w: 100, d: 80 }, { x: 0, z: 0, w: 6, d: 5 }]) {
    const plan = horizonPlan(b);
    const mesh = mistMesh(plan, 2);
    for (let k = 0; k < mesh.weights.length; k++) {
      const [x, y, z] = [mesh.positions[k * 3]!, mesh.positions[k * 3 + 1]!, mesh.positions[k * 3 + 2]!];
      expect(y - landHeightAt(plan, x, z)).toBeCloseTo(MIST_LAYER_HEIGHTS[mesh.layers[k]!]!, 5);
      if (mesh.weights[k]! > 0) expect(landHeightAt(plan, x, z)).toBe(0); // the ground is flat
    }
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.weights.length);
    }
  });

  it('is the same for the same bounds', () => {
    const b = { x: 0, z: 0, w: 60, d: 40 };
    expect(mistMesh(horizonPlan(b), 4)).toEqual(mistMesh(horizonPlan(b), 4));
  });
});

describe('low mist around the nearer trees, behind the back fence', () => {
  it('starts where the graveyard\'s mist ends and stops before the far forest, from 0 to 1', () => {
    fc.assert(
      fc.property(boundsArb, fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (b, u, v) => {
        const plan = horizonPlan(b);
        const fence = b.z;
        const x = plan.centre.x + u * plan.ridgeRadius;
        const inGraveyardMist = backMistWeightAt(plan, x, fence + v * b.d) === 0 && backMistWeightAt(plan, x, fence - mistEdge(plan) + 1e-6) === 0;
        const beyond = backMistWeightAt(plan, x, plan.centre.z - plan.ridgeRadius * (1 + v)) === 0;
        const z = fence - mistEdge(plan) - v * (fence - nearBand(plan).lastZ);
        const w = backMistWeightAt(plan, x, z);
        return inGraveyardMist && beyond && w >= 0 && w <= 1;
      }),
      { numRuns: 200 },
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: lies low around the trunks, well under the treetops, and is there in the band', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const mesh = backMistMesh(plan, 40);
    const shortest = Math.min(...nearTrees(plan).map((t) => t.base.y + t.height));
    expect(Math.max(...Array.from({ length: mesh.weights.length }, (_, k) => mesh.positions[k * 3 + 1]!))).toBeLessThan(shortest * 0.25);
    expect(Math.max(...mesh.weights)).toBeGreaterThan(0.5);
    expect(BACK_MIST_LAYER_SHARES.every((s, i) => i === 0 || s > BACK_MIST_LAYER_SHARES[i - 1]!)).toBe(true);
  });
});
