import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { DEFAULT_FOV_Y } from './camera-pose';
import { HORIZON_FROM_TOP, establishingShot, projectToFrame } from './framing';
import {
  FOREST_ROW_HAZE,
  NEAR_HAZE_TO,
  forestMesh,
  forestTrees,
  forestTriangles,
  hazeBand,
  hazeRingMesh,
  horizonPlan,
  landHeightAt,
  nearBand,
  nearTrees,
} from './horizon';
import { layout } from './layout';
import { vec3 } from './vec3';

describe('the ground beyond the fence', () => {
  it('is flat: no hills or terrain anywhere', () => {
    fc.assert(
      fc.property(fc.double({ min: -2000, max: 2000, noNaN: true }), fc.double({ min: -2000, max: 2000, noNaN: true }), (x, z) => landHeightAt(horizonPlan({ x: 0, z: 0, w: 120, d: 90 }), x, z) === 0),
    );
  });
});

describe('the far forest', () => {
  it.each(REAL_GRAVEYARDS)('%s: stands on the ground in a line whose foot is level across the opening view, not a bowl', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    for (const aspect of [1.6, 16 / 9]) {
      const shot = establishingShot(l.bounds, DEFAULT_FOV_Y, aspect);
      const feet = forestTrees(plan)
        .filter((t) => t.row === 0 && !t.key.startsWith('forest/framing'))
        .map((t) => projectToFrame(shot.pose, DEFAULT_FOV_Y, aspect, shot.viewShift, vec3(t.base.x, 0, t.base.z)))
        .filter((p): p is { x: number; y: number } => p !== null && p.x > 0 && p.x < 1);
      expect(feet.length).toBeGreaterThan(30);
      const ys = feet.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys), 'the foot of the far forest across the frame').toBeLessThan(0.02);
    }
  });
});

describe('the haze at the far forest\'s foot', () => {
  it.each(REAL_GRAVEYARDS)('%s: is a level strip just in front of the far forest, from the ground up into the trees, below the horizon', (name) => {
    const plan = horizonPlan(layout(loadRealGraveyard(name)).bounds);
    const band = hazeBand(plan);
    const ring = hazeRingMesh(plan, 32);
    expect(Math.max(...ring.indices)).toBeLessThan(ring.density.length);
    expect(Math.max(...ring.density)).toBe(1);
    const zs = new Set(Array.from({ length: ring.density.length }, (_, k) => ring.positions[k * 3 + 2]));
    expect(zs.size).toBe(1); // one straight line
    const lineZ = [...zs][0]!;
    const farFront = Math.min(...forestTrees(plan).filter((t) => t.row === 0 && t.key.includes('/line/')).map((t) => plan.centre.z - t.base.z));
    expect(plan.centre.z - lineZ).toBeLessThan(farFront + 1); // in front of the far forest
    expect(band.top).toBeLessThan(plan.eye.y); // below the design eye's level: below the horizon, never over the moon
    expect(band.peak).toBeGreaterThan(0);
  });
});

describe('the nearer layer of trees', () => {
  it.each(REAL_GRAVEYARDS)('%s: stands on the ground behind the back fence, below the horizon, lighter and hazier than the foreground and less hazy than the far forest', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const trees = nearTrees(plan);
    expect(trees.length).toBeGreaterThan(60);
    expect(trees.some((t) => t.bare)).toBe(true);
    expect(trees.some((t) => !t.bare)).toBe(true);
    for (const t of trees) {
      expect(t.base.z).toBeLessThan(l.bounds.z - plan.gap); // behind the back fence, never touching it
      expect(t.base.y).toBeLessThanOrEqual(0);
      expect(t.base.y + t.height).toBeLessThan(plan.eye.y); // below the design eye's level: below the horizon
      expect(t.haze!).toBeGreaterThan(0);
      expect(t.haze!).toBeLessThanOrEqual(NEAR_HAZE_TO);
    }
    expect(NEAR_HAZE_TO).toBeLessThan(FOREST_ROW_HAZE[0]!);
  });

  it.each(REAL_GRAVEYARDS)('%s: fills the band between the back fence and the far forest in the opening view, at both laptop shapes', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const { firstZ } = nearBand(plan);
    for (const aspect of [1.6, 16 / 9]) {
      const shot = establishingShot(l.bounds, DEFAULT_FOV_Y, aspect);
      const at = (x: number, y: number, z: number) => projectToFrame(shot.pose, DEFAULT_FOV_Y, aspect, shot.viewShift, vec3(x, y, z))!;
      const fence = at(plan.centre.x, 0, l.bounds.z).y;
      const farFoot = at(plan.centre.x, 0, plan.centre.z - plan.ridgeRadius).y;
      // The first row stands just behind the fence on the screen; some trees reach up past the far forest's foot.
      expect(fence - at(plan.centre.x, 0, firstZ).y).toBeLessThan(0.05);
      const tops = nearTrees(plan).map((t) => at(t.base.x, t.base.y + t.height, t.base.z)).filter((p) => p.x > 0.3 && p.x < 0.7);
      expect(Math.min(...tops.map((p) => p.y))).toBeLessThan(farFoot);
      expect(Math.min(...tops.map((p) => p.y))).toBeGreaterThan(HORIZON_FROM_TOP); // below the horizon
    }
  });

  it('is the same for the same bounds', () => {
    const plan = horizonPlan({ x: 0, z: 0, w: 60, d: 40 });
    expect(JSON.stringify(nearTrees(plan))).toBe(JSON.stringify(nearTrees(horizonPlan({ x: 0, z: 0, w: 60, d: 40 }))));
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
    // Varied heights: the treetops spread over a good part of a tree's typical height (they stand on flat ground, so the
    // heights are large and the spread is measured against the typical size, not the mean).
    const heights = trees.map((t) => t.height);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const spread = Math.sqrt(heights.reduce((a, h) => a + (h - mean) ** 2, 0) / heights.length);
    expect(spread / Math.max(1, plan.eye.y - plan.ridgeHeight)).toBeGreaterThan(0.15);
    // Gaps: somewhere around the ring the front row has a break much wider than its usual spacing.
    const angles = trees.map((t) => Math.atan2(t.base.z - plan.centre.z, t.base.x - plan.centre.x)).sort((a, b) => a - b);
    const steps = angles.slice(1).map((a, i) => a - angles[i]!);
    const usual = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!;
    expect(steps.filter((s) => s > usual * 4).length).toBeGreaterThan(0);
    expect(FOREST_ROW_HAZE[1]!).toBeGreaterThan(FOREST_ROW_HAZE[0]!);
    expect(FOREST_ROW_HAZE[2]!).toBeGreaterThan(FOREST_ROW_HAZE[1]!);
    const all = forestTrees(plan);
    const mesh = forestMesh(all);
    expect(mesh.up.length * 3).toBe(mesh.positions.length);
    expect(mesh.positions).toEqual(forestTriangles(all));
    expect(Math.min(...mesh.up)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...mesh.up)).toBeLessThanOrEqual(1);
  });
});
