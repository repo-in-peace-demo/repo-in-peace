import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { horizonPlan, landHeightAt, valleyDepth } from './horizon';
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
  hillMistMesh,
  hillMistWeight,
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
      if (mesh.weights[k]! > 0) expect(landHeightAt(plan, x, z)).toBe(0); // where there is mist, the hills have not started
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

describe('mist pooling on the hills', () => {
  it('is in the dips of the slopes only: none at the foot (where the graveyard mist ends) or near the ridge (the forest), and from 0 to 1', () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (angle, t) => {
        const w = hillMistWeight(angle, t);
        return w >= 0 && w <= 1 && (t > 0.08 || w === 0) && (t < 0.85 || w === 0);
      }),
      { numRuns: 400 },
    );
  });

  it('pools more in a valley than on an even stretch of slope at the same height up it', () => {
    const angles = Array.from({ length: 360 }, (_, i) => (i / 360) * Math.PI * 2);
    const deepest = angles.reduce((a, b) => (valleyDepth(b) > valleyDepth(a) ? b : a));
    const flattest = angles.reduce((a, b) => (valleyDepth(b) < valleyDepth(a) ? b : a));
    expect(hillMistWeight(deepest, 0.4)).toBeGreaterThan(hillMistWeight(flattest, 0.4));
  });

  it('lies above the land, and below the ridge', () => {
    const plan = horizonPlan({ x: 0, z: 0, w: 100, d: 80 });
    const mesh = hillMistMesh(plan, 48, 10);
    for (let k = 0; k < mesh.weights.length; k++) {
      const [x, y, z] = [mesh.positions[k * 3]!, mesh.positions[k * 3 + 1]!, mesh.positions[k * 3 + 2]!];
      expect(y).toBeGreaterThan(landHeightAt(plan, x, z));
      expect(Math.hypot(x - plan.centre.x, z - plan.centre.z)).toBeLessThan(plan.ridgeRadius);
    }
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.weights.length);
  });
});
