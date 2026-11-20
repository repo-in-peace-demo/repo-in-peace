import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { DEFAULT_FOV_Y } from './camera-pose';
import { HORIZON_FROM_TOP, establishingShot, projectToFrame } from './framing';
import { FOREST_ROW_HAZE, forestMesh, forestTrees, forestTriangles, hazeBand, hazeRingMesh, horizonPlan, landHeightAt, landMesh, ridgeHeightToward, slopeShare, valleyDepth } from './horizon';
import { vec3 } from './vec3';
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
    expect(band.ceiling).toBeLessThan(plan.eye.y); // below the design eye's level: below the horizon, never over the moon
    const ring = hazeRingMesh(plan, 32);
    expect(Math.max(...ring.indices)).toBeLessThan(ring.density.length);
    expect(Math.max(...ring.density)).toBe(1);
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const ridge = ridgeHeightToward(plan, Math.cos(angle), Math.sin(angle));
      const [bottom, peak, top] = [0, 1, 2].map((row) => ring.positions[(row * 32 + i) * 3 + 1]!);
      expect(bottom).toBeLessThan(ridge); // it starts on the slope
      expect(peak).toBeGreaterThan(bottom!);
      expect(top).toBeGreaterThan(peak!);
      expect(top).toBeLessThanOrEqual(band.ceiling + 1e-9);
    }
  });
});

describe('the ridge', () => {
  it.each(REAL_GRAVEYARDS)('%s: reads as a level horizon in the opening view, not a bowl: the same height in the frame from side to side', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const shot = establishingShot(l.bounds, DEFAULT_FOV_Y, 1.6);
    const ys: number[] = [];
    for (let i = 0; i < 720; i++) {
      const angle = (i / 720) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const p = vec3(plan.centre.x + dx * plan.ridgeRadius, ridgeHeightToward(plan, dx, dz), plan.centre.z + dz * plan.ridgeRadius);
      const at = projectToFrame(shot.pose, DEFAULT_FOV_Y, 1.6, shot.viewShift, p);
      if (at && at.x > 0 && at.x < 1) ys.push(at.y);
    }
    expect(ys.length).toBeGreaterThan(50);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.005);
    expect(ys[0]!).toBeGreaterThan(HORIZON_FROM_TOP); // below the horizon
  });

  it('is never lower than straight behind, and stays under the eye', () => {
    const plan = horizonPlan({ x: 0, z: 0, w: 100, d: 80 });
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180;
      const h = ridgeHeightToward(plan, Math.cos(a), Math.sin(a));
      expect(h).toBeGreaterThanOrEqual(plan.ridgeHeight - 1e-9);
      expect(h).toBeLessThan(plan.eye.y);
    }
  });
});

describe('landMesh, along the fence', () => {
  it.each(REAL_GRAVEYARDS)('%s: the foot of the slope follows the fence lines: along each direction, the first rise starts where the hills start', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const segments = 96;
    const { positions } = landMesh(plan, segments, 24);
    for (let i = 0; i < segments; i++) {
      // Rings 0 and 1 are flat (just inside, and at where the hills start); ring 2 has risen.
      expect(positions[(0 * segments + i) * 3 + 1]!).toBe(0);
      expect(positions[(1 * segments + i) * 3 + 1]!).toBeCloseTo(0, 6);
      expect(positions[(2 * segments + i) * 3 + 1]!).toBeGreaterThan(1e-4);
    }
  });
});

describe('the forest', () => {
  it.each(REAL_GRAVEYARDS)('%s: bare twisted trees frame the left and right edges of the opening view, rising above the forest into the sky', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const trees = forestTrees(plan);
    for (const aspect of [1.6, 16 / 9]) {
      const shot = establishingShot(l.bounds, DEFAULT_FOV_Y, aspect);
      const tops = trees.map((t) => ({ t, p: projectToFrame(shot.pose, DEFAULT_FOV_Y, aspect, shot.viewShift, vec3(t.base.x, t.base.y + t.height, t.base.z)) }));
      for (const side of ['left', 'right'] as const) {
        const framing = tops.filter((x) => x.t.bare && x.t.key.startsWith('forest/framing') && x.p && (side === 'left' ? x.p.x > 0.02 && x.p.x < 0.25 : x.p.x > 0.75 && x.p.x < 0.98));
        expect(framing.length, `a framing tree on the ${side} at ${aspect.toFixed(2)}`).toBeGreaterThan(0);
        // In the sky: above the horizon, and above the highest pine top.
        for (const f of framing) {
          expect(f.p!.y).toBeLessThan(HORIZON_FROM_TOP - 0.02);
          // Above the pines around it in the frame.
          const near = tops.filter((x) => !x.t.bare && x.p && x.p.y > -1 && Math.abs(x.p.x - f.p!.x) < 0.04).map((x) => x.p!.y);
          expect(f.p!.y).toBeLessThan(Math.min(...near) - 0.02);
        }
      }
    }
  });

  it.each(REAL_GRAVEYARDS)('%s: has varied heights and gaps, back rows hazier, and the shading data for every point', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const trees = forestTrees(plan).filter((t) => !t.bare && t.row === 0);
    const heights = trees.map((t) => t.height);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const spread = Math.sqrt(heights.reduce((a, h) => a + (h - mean) ** 2, 0) / heights.length);
    expect(spread / mean).toBeGreaterThan(0.15);
    // Gaps: somewhere around the ring the front row has a break much wider than its usual spacing.
    const angles = trees.map((t) => Math.atan2(t.base.z - plan.centre.z, t.base.x - plan.centre.x)).sort((a, b) => a - b);
    const steps = angles.slice(1).map((a, i) => a - angles[i]!);
    const usual = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!;
    expect(steps.filter((s) => s > usual * 4).length).toBeGreaterThan(0);
    expect(FOREST_ROW_HAZE[0]).toBe(0);
    expect(FOREST_ROW_HAZE[2]!).toBeGreaterThan(FOREST_ROW_HAZE[1]!);
    const all = forestTrees(plan);
    const mesh = forestMesh(all);
    expect(mesh.up.length * 3).toBe(mesh.positions.length);
    expect(mesh.positions).toEqual(forestTriangles(all));
    expect(Math.min(...mesh.up)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...mesh.up)).toBeLessThanOrEqual(1);
  });
});

describe('rolling hills', () => {
  it('only rise going out from the graveyard, at any angle, from 0 at the foot to 1 at the ridge: the dips never make a hollow', () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (angle) => {
        let last = -1;
        for (let t = 0; t <= 1.0000001; t += 0.01) {
          const s = slopeShare(angle, t);
          if (s < last - 1e-12) return false;
          last = s;
        }
        return slopeShare(angle, 0) === 0 && Math.abs(slopeShare(angle, 1) - 1) < 1e-12;
      }),
      { numRuns: 300 },
    );
  });

  it('roll: around the ring, the slope halfway up is at very different heights (benches and valleys), not one even ramp', () => {
    const mids = Array.from({ length: 180 }, (_, i) => slopeShare((i / 180) * Math.PI * 2, 0.5));
    expect(Math.max(...mids) - Math.min(...mids)).toBeGreaterThan(0.15);
    expect(Math.max(...Array.from({ length: 180 }, (_, i) => valleyDepth((i / 180) * Math.PI * 2)))).toBeGreaterThan(0.3);
  });
});
