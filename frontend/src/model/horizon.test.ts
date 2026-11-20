import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { forestTrees, hazeBand, hazeRingMesh, horizonPlan, landHeightAt, landMesh } from './horizon';
import { layout } from './layout';

describe('landMesh', () => {
  it.each(REAL_GRAVEYARDS)('%s: every triangle faces up, so the moonlight lights the hills from above', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const { positions, indices } = landMesh(plan, 64, 24);
    expect(indices.length).toBeGreaterThan(0);
    const p = (i: number) => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!] as const;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [p(indices[t]!), p(indices[t + 1]!), p(indices[t + 2]!)];
      // (b - a) × (c - a): the normal three.js works out for a counter-clockwise face.
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normalY = u[2]! * v[0]! - u[0]! * v[2]!;
      expect(normalY).toBeGreaterThan(0);
    }
  });

  it('puts every point on the land', () => {
    const plan = horizonPlan({ x: 0, z: 0, w: 100, d: 80 });
    const { positions } = landMesh(plan, 32, 12);
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i + 1]!).toBeCloseTo(landHeightAt(plan, positions[i]!, positions[i + 2]!), 3);
    }
  });
});

describe('the haze where the hills meet the forest', () => {
  it.each(REAL_GRAVEYARDS)('%s: stands in front of the forest, from the upper slope up into the trees, below the horizon', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const band = hazeBand(plan);
    const trees = forestTrees(plan);
    expect(band.radius).toBeLessThan(Math.min(...trees.map((t) => Math.hypot(t.base.x - plan.centre.x, t.base.z - plan.centre.z))));
    expect(band.bottom).toBeLessThan(plan.ridgeHeight);
    expect(band.peak).toBeGreaterThan(plan.ridgeHeight);
    expect(band.top).toBeGreaterThan(band.peak);
    expect(band.top).toBeLessThan(plan.eye.y); // below the design eye's level: below the horizon, never over the moon
    const ring = hazeRingMesh(plan, 32);
    expect(Math.max(...ring.indices)).toBeLessThan(ring.density.length);
    expect(Math.max(...ring.density)).toBe(1);
  });
});
