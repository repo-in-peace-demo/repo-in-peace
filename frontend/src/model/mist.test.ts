import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { horizonPlan, landHeightAt } from './horizon';
import { layout } from './layout';
import {
  MIST_GRAVEYARD_WEIGHT,
  MIST_LAYER_HEIGHTS,
  MIST_MIN_SEE_THROUGH,
  mistLayerHeightAt,
  mistMesh,
  mistSeeThrough,
  mistTopShareOfShortestStone,
  mistWeightAt,
} from './mist';
import type { Rect } from './rect';

const boundsArb: fc.Arbitrary<Rect> = fc.record({
  x: fc.double({ min: -200, max: 200, noNaN: true }),
  z: fc.double({ min: -200, max: 200, noNaN: true }),
  w: fc.double({ min: 4, max: 800, noNaN: true }),
  d: fc.double({ min: 4, max: 800, noNaN: true }),
});

describe('ground mist', () => {
  it('stays readable: low inside the graveyard and see-through at its densest', () => {
    expect(mistTopShareOfShortestStone()).toBeLessThanOrEqual(0.6);
    expect(mistSeeThrough()).toBeGreaterThanOrEqual(MIST_MIN_SEE_THROUGH);
  });

  it('has a density from 0 to 1 everywhere, the graveyard weight inside, and none beyond the ridge', () => {
    fc.assert(
      fc.property(boundsArb, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), (b, u, v, far) => {
        const plan = horizonPlan(b);
        const inside = mistWeightAt(plan, b.x + u * b.w, b.z + v * b.d);
        const angle = u * Math.PI * 2;
        const r = plan.ridgeRadius * (1.05 + far);
        const beyond = mistWeightAt(plan, plan.centre.x + Math.cos(angle) * r, plan.centre.z + Math.sin(angle) * r);
        const anywhere = mistWeightAt(plan, plan.centre.x + (u - 0.5) * 4 * plan.ridgeRadius, plan.centre.z + (v - 0.5) * 4 * plan.ridgeRadius);
        return Math.abs(inside - MIST_GRAVEYARD_WEIGHT) < 1e-9 && beyond === 0 && anywhere >= 0 && anywhere <= 1;
      }),
      { numRuns: 200 },
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: pools on the hills, denser at the foot of the slopes than between the rows, and thinner at the ridge', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const back = plan.centre.z - plan.halfD - plan.gap; // where the hills start behind the back fence
    const foot = mistWeightAt(plan, plan.centre.x, back - 0.12 * (back - (plan.centre.z - plan.ridgeRadius)));
    const ridge = mistWeightAt(plan, plan.centre.x, plan.centre.z - plan.ridgeRadius * 0.98);
    expect(foot).toBeGreaterThan(MIST_GRAVEYARD_WEIGHT + 0.1);
    expect(ridge).toBeLessThan(foot * 0.5);
  });

  it('lies on the land: every point is above the ground by its sheet height, lifting on the hills, and the sheets keep their order', () => {
    const plan = horizonPlan({ x: 0, z: 0, w: 100, d: 80 });
    const mesh = mistMesh(plan, 40);
    for (let k = 0; k < mesh.weights.length; k++) {
      const [x, y, z] = [mesh.positions[k * 3]!, mesh.positions[k * 3 + 1]!, mesh.positions[k * 3 + 2]!];
      const layer = mesh.layers[k]!;
      const above = y - landHeightAt(plan, x, z);
      expect(above).toBeCloseTo(mistLayerHeightAt(plan, layer, x, z), 3);
      expect(above).toBeGreaterThanOrEqual(MIST_LAYER_HEIGHTS[layer]! - 1e-6);
      if (layer > 0) expect(above).toBeGreaterThan(mistLayerHeightAt(plan, layer - 1, x, z));
    }
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.weights.length);
  });

  it('is the same for the same bounds', () => {
    const b = { x: 0, z: 0, w: 60, d: 40 };
    expect(mistMesh(horizonPlan(b), 20)).toEqual(mistMesh(horizonPlan(b), 20));
  });
});
