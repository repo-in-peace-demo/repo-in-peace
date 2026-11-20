import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { sceneCameraLimits } from './camera-bounds';
import { DEFAULT_FOV_Y } from './camera-pose';
import { clampPose } from './fly-controls';
import { SHOT_MAX_ASPECT, SHOT_MIN_ASPECT, blendShots, openingShot, safeEstablishingShot, type Shot } from './framing';
import { forestTrees, horizonPlan, nearTrees } from './horizon';
import { layout } from './layout';
import type { Rect } from './rect';
import { treeProblems } from './tree-sightline';

/**
 * The trees and the camera, for every window shape the scene is composed for (SHOT_MIN_ASPECT to SHOT_MAX_ASPECT wide to tall):
 * in the establishing shot (the first frame and Reset view) and at every moment of the opening move, no tree stands between the
 * camera and the graveyard, the camera is inside the ring of trees and inside its own limits, and no tree shows in the frame nearer
 * than the graveyard's front fence (pine tops across the bottom of the frame, or a branch across the graveyard).
 */

const FOV = DEFAULT_FOV_Y;

/** The opening move's poses, from the low shot to the establishing shot. */
const moveShots = (b: Rect, aspect: number): Shot[] => {
  const from = openingShot(b, FOV, aspect);
  const to = safeEstablishingShot(b, FOV, aspect);
  return [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1].map((t) => blendShots(from, to, t));
};

const aspectArb = fc.double({ min: SHOT_MIN_ASPECT, max: SHOT_MAX_ASPECT, noNaN: true });

describe('trees and the camera for every window shape from SHOT_MIN_ASPECT to SHOT_MAX_ASPECT', () => {
  it.each(REAL_GRAVEYARDS)('%s: the establishing shot (and Reset view) and the whole opening move: no tree in the way, the camera inside the trees and its limits', (name) => {
    const b = layout(loadRealGraveyard(name)).bounds;
    const plan = horizonPlan(b);
    const ring = forestTrees(plan);
    const trees = [...ring, ...nearTrees(plan)];
    for (const aspect of [SHOT_MIN_ASPECT, 900 / 1200, 1200 / 1450, 1, 1.25, 1.6, 16 / 9, 2, SHOT_MAX_ASPECT]) {
      const establishing = safeEstablishingShot(b, FOV, aspect);
      expect(clampPose(establishing.pose, sceneCameraLimits(b, aspect)), `the establishing shot at ${aspect.toFixed(2)} is inside the limits`).toBe(establishing.pose);
      for (const shot of moveShots(b, aspect)) expect(treeProblems(b, trees, ring, shot, aspect, FOV), `${name} at ${aspect.toFixed(2)}`).toEqual([]);
    }
  });

  it('for any graveyard size and window shape', () => {
    fc.assert(
      fc.property(fc.double({ min: 4, max: 400, noNaN: true }), fc.double({ min: 4, max: 400, noNaN: true }), aspectArb, (w, d, aspect) => {
        const b: Rect = { x: 0, z: 0, w, d };
        const plan = horizonPlan(b);
        const ring = forestTrees(plan);
        const trees = [...ring, ...nearTrees(plan)];
        return moveShots(b, aspect).every((shot) => treeProblems(b, trees, ring, shot, aspect, FOV).length === 0);
      }),
      { numRuns: 60 },
    );
  });
});
