import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { ORBIT_HALF_ANGLE_DEG, ZOOM_OUT_SHARE, sceneCameraLimits } from './camera-bounds';
import { DEFAULT_FOV_Y, type CameraPose } from './camera-pose';
import { clampPose } from './fly-controls';
import { SHOT_MAX_ASPECT, SHOT_MIN_ASPECT, establishingShot, safeEstablishingShot } from './framing';
import { forestTrees, horizonPlan, nearTrees } from './horizon';
import { treesInTheWay } from './tree-sightline';
import { layout } from './layout';
import { distance, vec3 } from './vec3';

describe('sceneCameraLimits', () => {
  it('leave the opening view as it is, for any graveyard and any window from 1.0 to 2.4 wide', () => {
    fc.assert(
      fc.property(graveyardArb, fc.double({ min: 1, max: 2.4, noNaN: true }), (g, aspect) => {
        const b = layout(g).bounds;
        const shot = safeEstablishingShot(b, DEFAULT_FOV_Y, aspect);
        return clampPose(shot.pose, sceneCameraLimits(b, aspect)) === shot.pose;
      }),
      { numRuns: 60 },
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: zoom out stops at %s times the establishing shot\'s distance', (name) => {
    const b = layout(loadRealGraveyard(name)).bounds;
    for (const aspect of [1.6, 16 / 9]) {
      const { pose } = establishingShot(b, DEFAULT_FOV_Y, aspect);
      const l = sceneCameraLimits(b, aspect);
      expect(l.maxDistance).toBeCloseTo(distance(pose.position, pose.target) * ZOOM_OUT_SHARE, 9);
      const outward = { position: vec3(pose.target.x + (pose.position.x - pose.target.x) * 4, pose.target.y + (pose.position.y - pose.target.y) * 4, pose.target.z + (pose.position.z - pose.target.z) * 4), target: pose.target };
      const stopped = clampPose(outward, l);
      expect(distance(stopped.position, stopped.target)).toBeLessThanOrEqual(l.maxDistance! + 1e-9);
      expect(distance(stopped.position, stopped.target)).toBeGreaterThan(distance(pose.position, pose.target));
    }
  });

  it.each(REAL_GRAVEYARDS)('%s: every tree stands outside the region the camera is kept in: the ring\'s trees outside the circle, the nearer trees behind the line', (name) => {
    const b = layout(loadRealGraveyard(name)).bounds;
    const plan = horizonPlan(b);
    // For every window shape the scene is composed for: the limits (the circle grows with the establishing shot) stay inside the trees.
    for (const aspect of [SHOT_MIN_ASPECT, 1200 / 1450, 1, 16 / 9, SHOT_MAX_ASPECT]) {
      const l = sceneCameraLimits(b, aspect);
      for (const t of forestTrees(plan)) expect(Math.hypot(t.base.x - plan.centre.x, t.base.z - plan.centre.z)).toBeGreaterThan(l.keepInside!.radius);
      for (const t of nearTrees(plan)) expect(t.base.z).toBeLessThan(l.minZ!);
    }
  });

  it.each(REAL_GRAVEYARDS)('%s: wherever the mouse, the keys or a flight take the camera, it never reaches a tree, never gets behind one, and no tree is between it and the graveyard', (name) => {
    const b = layout(loadRealGraveyard(name)).bounds;
    const plan = horizonPlan(b);
    const trees = [...forestTrees(plan), ...nearTrees(plan)];
    const span = plan.ridgeRadius * 4;
    const coord = (c: number) => fc.double({ min: c - span, max: c + span, noNaN: true });
    const pose: fc.Arbitrary<CameraPose> = fc.record({
      position: fc.record({ x: coord(plan.centre.x), y: fc.double({ min: -50, max: 600, noNaN: true }), z: coord(plan.centre.z) }),
      target: fc.record({ x: coord(plan.centre.x), y: fc.double({ min: -10, max: 20, noNaN: true }), z: coord(plan.centre.z) }),
    });
    fc.assert(
      fc.property(pose, fc.double({ min: SHOT_MIN_ASPECT, max: SHOT_MAX_ASPECT, noNaN: true }), (p, aspect) => {
        const l = sceneCameraLimits(b, aspect);
        const clamped = clampPose(p, l);
        const { position } = clampPose(p, l);
        // Never round to the sides or the back: within ORBIT_HALF_ANGLE_DEG of the establishing shot's direction (+z, the front).
        const ox = clamped.position.x - clamped.target.x;
        const oz = clamped.position.z - clamped.target.z;
        if (Math.hypot(ox, oz) > 1e-6 && Math.abs((Math.atan2(ox, oz) * 180) / Math.PI) > ORBIT_HALF_ANGLE_DEG + 1e-6) return false;
        // Inside the ring of trees, and in front of the trees behind the back fence: every tree stands outside that region.
        const inside = Math.hypot(position.x - plan.centre.x, position.z - plan.centre.z) <= l.keepInside!.radius + 1e-9 && position.z >= l.minZ! - 1e-9;
        return inside && treesInTheWay(position, b, trees).length === 0;
      }),
      { numRuns: 150 },
    );
  });
});

describe('the sight-line test itself', () => {
  it.each(REAL_GRAVEYARDS)('%s: finds the trees in the way of a camera behind them (without the limits), and none once the limits have it', (name) => {
    const b = layout(loadRealGraveyard(name)).bounds;
    const plan = horizonPlan(b);
    const trees = [...forestTrees(plan), ...nearTrees(plan)];
    // Far out behind the back of the graveyard, low, looking at it: through the far forest and the nearer trees.
    const behind = { position: vec3(plan.centre.x, 12, plan.centre.z - plan.ridgeRadius * 1.6), target: vec3(plan.centre.x, 0, plan.centre.z) };
    expect(treesInTheWay(behind.position, b, trees).length).toBeGreaterThan(0);
    const clamped = clampPose(behind, sceneCameraLimits(b, 16 / 9));
    expect(treesInTheWay(clamped.position, b, trees)).toEqual([]);
  });
});
