import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { MOONLIGHT_DIRECTION, MOON_DIRECTION, MOON_GLOW_ANGULAR_RADIUS_DEG } from './atmosphere';
import { DEFAULT_FOV_Y } from './camera-pose';
import { MIN_TILT_DEG, boundsRadius, cameraLimits, clampPose } from './fly-controls';
import {
  DEFAULT_ASPECT,
  ESTABLISHING_ELEVATION_DEG,
  FRAME_BOTTOM,
  FRAME_MARGIN_X,
  HORIZON_FROM_TOP,
  MIN_SHOT_DISTANCE,
  OPENING_ELEVATION_DEG,
  SHOT_MIN_ASPECT,
  blendShots,
  establishingShot,
  horizonInFrame,
  openingShot,
  projectToFrame,
  shiftForHorizon,
  shotIsInsideLimits,
  type Shot,
} from './framing';
import { forestTrees, forestTriangles, horizonPlan, landHeightAt, nearTrees } from './horizon';
import { layout } from './layout';
import type { Rect } from './rect';
import { distance, dot, normalize, sub, vec3, type Vec3 } from './vec3';

const FOV = DEFAULT_FOV_Y;
/** The two laptop window shapes: 16:10 and 16:9. */
const LAPTOP_ASPECTS = [1.6, 16 / 9];

/** The moon's middle in the frame, and points all around the edge of its halo. */
function moonInFrame(shot: Shot, aspect: number): { centre: { x: number; y: number }; ring: Array<{ x: number; y: number }> } {
  const m = normalize(vec3(MOON_DIRECTION.x, MOON_DIRECTION.y, MOON_DIRECTION.z));
  // Two directions at right angles to the moon's.
  const side = normalize(vec3(-m.z, 0, m.x));
  const up = vec3(side.y * m.z - side.z * m.y, side.z * m.x - side.x * m.z, side.x * m.y - side.y * m.x);
  const far = (d: Vec3) => vec3(shot.pose.position.x + d.x * 1e5, shot.pose.position.y + d.y * 1e5, shot.pose.position.z + d.z * 1e5);
  const at = (d: Vec3) => projectToFrame(shot.pose, FOV, aspect, shot.viewShift, far(d))!;
  const r = Math.tan((MOON_GLOW_ANGULAR_RADIUS_DEG * Math.PI) / 180);
  const ring = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return at(normalize(vec3(m.x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * r, m.y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * r, m.z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * r)));
  });
  return { centre: at(m), ring };
}

type P2 = { x: number; y: number };
/** True when the triangle abc and the circle overlap (touching counts). */
function triangleMeetsCircle(a: P2, b: P2, c: P2, centre: P2, radius: number): boolean {
  const cross = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, centre);
  const d2 = cross(b, c, centre);
  const d3 = cross(c, a, centre);
  const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  if (inside) return true;
  const toSegment = (p: P2, q: P2) => {
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((centre.x - p.x) * vx + (centre.y - p.y) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(p.x + vx * t - centre.x, p.y + vy * t - centre.y);
  };
  return Math.min(toSegment(a, b), toSegment(b, c), toSegment(c, a)) <= radius;
}
const tiltDeg = (pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }): number =>
  (Math.atan2(pose.position.y - pose.target.y, Math.hypot(pose.position.x - pose.target.x, pose.position.z - pose.target.z)) * 180) / Math.PI;
const cornersOf = (b: Rect) => [vec3(b.x, 0, b.z), vec3(b.x + b.w, 0, b.z), vec3(b.x, 0, b.z + b.d), vec3(b.x + b.w, 0, b.z + b.d)];

const boundsArb: fc.Arbitrary<Rect> = fc.record({
  x: fc.double({ min: 0, max: 0, noNaN: true }),
  z: fc.double({ min: 0, max: 0, noNaN: true }),
  w: fc.double({ min: 2, max: 1500, noNaN: true }),
  d: fc.double({ min: 2, max: 1500, noNaN: true }),
});
const aspectArb = fc.double({ min: 0.5, max: 3, noNaN: true });

describe('the lens shift', () => {
  it('puts the horizon where it is asked, for any tilt and any lens', () => {
    fc.assert(
      fc.property(fc.double({ min: 20, max: 60, noNaN: true }), fc.double({ min: 30, max: 80, noNaN: true }), fc.double({ min: 0.12, max: 0.4, noNaN: true }), (tilt, fov, wanted) => {
        const pose = { position: vec3(0, Math.tan((tilt * Math.PI) / 180) * 50, 50), target: vec3(0, 0, 0) };
        return Math.abs(horizonInFrame(pose, fov, 1.6, shiftForHorizon(fov, tilt, wanted)) - wanted) < 1e-4;
      }),
    );
  });
});

describe('the establishing shot', () => {
  it('looks at the middle of the graveyard from 22 degrees up, in front of it, above the 20 degree limit', () => {
    expect(ESTABLISHING_ELEVATION_DEG).toBeGreaterThanOrEqual(MIN_TILT_DEG);
    const { pose } = establishingShot({ x: 0, z: 0, w: 100, d: 80 }, FOV, 1.6);
    expect(pose.target).toEqual(vec3(50, 0, 40));
    expect(tiltDeg(pose)).toBeCloseTo(ESTABLISHING_ELEVATION_DEG, 9);
    expect(pose.position.x).toBeCloseTo(50, 9);
    expect(pose.position.z).toBeGreaterThan(40); // in front (+z)
  });

  it('has the horizon in the upper third of the frame, for any window shape', () => {
    fc.assert(
      fc.property(boundsArb, aspectArb, (b, a) => {
        const { pose, viewShift } = establishingShot(b, FOV, a);
        const horizon = horizonInFrame(pose, FOV, a, viewShift);
        return Math.abs(horizon - HORIZON_FROM_TOP) < 1e-4 && horizon < 1 / 3;
      }),
    );
  });

  it('has all four corners of the graveyard in the frame, for any graveyard and any window shape from SHOT_MIN_ASPECT up, wide or narrow', () => {
    fc.assert(
      fc.property(boundsArb, fc.double({ min: SHOT_MIN_ASPECT, max: 3, noNaN: true }), (b, a) => {
        const { pose, viewShift } = establishingShot(b, FOV, a);
        return cornersOf(b).every((c) => {
          const at = projectToFrame(pose, FOV, a, viewShift, c);
          return at !== null && at.x >= FRAME_MARGIN_X - 1e-9 && at.x <= 1 - FRAME_MARGIN_X + 1e-9 && at.y <= FRAME_BOTTOM + 1e-9 && at.y >= 0 && at.y > HORIZON_FROM_TOP;
        });
      }),
    );
  });

  it('is the shot for SHOT_MIN_ASPECT in a narrower window: it does not pull back further, and only the sides are cropped', () => {
    fc.assert(
      fc.property(boundsArb, fc.double({ min: 0.3, max: SHOT_MIN_ASPECT, noNaN: true }), (b, a) => {
        const shot = establishingShot(b, FOV, a);
        const at = establishingShot(b, FOV, SHOT_MIN_ASPECT);
        if (JSON.stringify(shot) !== JSON.stringify(at)) return false;
        // The near edge is still above the bottom of the frame: the crop is at the sides.
        return cornersOf(b).every((c) => projectToFrame(shot.pose, FOV, a, shot.viewShift, c)!.y <= FRAME_BOTTOM + 1e-9);
      }),
    );
  });

  it('is as near as it can be: a little nearer and a corner would be outside the frame (unless it is at the least distance)', () => {
    fc.assert(
      fc.property(boundsArb, aspectArb, (b, a) => {
        const { pose, viewShift } = establishingShot(b, FOV, a);
        const away = distance(pose.position, pose.target);
        if (away <= MIN_SHOT_DISTANCE + 1e-6) return true;
        const nearer = { position: vec3(pose.target.x + (pose.position.x - pose.target.x) * 0.98, pose.target.y + (pose.position.y - pose.target.y) * 0.98, pose.target.z + (pose.position.z - pose.target.z) * 0.98), target: pose.target };
        return cornersOf(b).some((c) => {
          const at = projectToFrame(nearer, FOV, a, viewShift, c)!;
          return at.x < FRAME_MARGIN_X || at.x > 1 - FRAME_MARGIN_X || at.y > FRAME_BOTTOM;
        });
      }),
    );
  });

  it('is inside every camera limit, with the 20 degree tilt, for any graveyard: the first frame is not moved by the limits', () => {
    fc.assert(
      fc.property(graveyardArb, aspectArb, (g, a) => {
        const l = layout(g);
        const shot = establishingShot(l.bounds, FOV, a);
        return shotIsInsideLimits(shot, l.bounds) && clampPose(shot.pose, cameraLimits(l.bounds)) === shot.pose;
      }),
      { numRuns: 40 },
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: on a laptop screen the land fills 55 to 70 percent of the frame, from the foot of the forest on the ridge to near the bottom, with every plot in view', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    for (const aspect of LAPTOP_ASPECTS) {
      const { pose, viewShift } = establishingShot(l.bounds, FOV, aspect);
      const ys = cornersOf(l.bounds).map((c) => projectToFrame(pose, FOV, aspect, viewShift, c)!.y);
      const near = Math.max(...ys);
      const ridge = projectToFrame(pose, FOV, aspect, viewShift, vec3(plan.centre.x, plan.ridgeHeight, plan.centre.z - plan.ridgeRadius))!.y;
      expect(near).toBeGreaterThan(0.9);
      expect(near - ridge).toBeGreaterThanOrEqual(0.55);
      expect(near - ridge).toBeLessThanOrEqual(0.7);
    }
  });

  it.each(REAL_GRAVEYARDS)('%s: between the back fence and the horizon there is no empty band: the nearer trees stand behind the fence and the far forest rises behind them', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const { pose, viewShift } = establishingShot(l.bounds, FOV, 1.6);
    const b = l.bounds;
    const at = (p: Vec3) => projectToFrame(pose, FOV, 1.6, viewShift, p)!;
    const fence = at(vec3(b.x + b.w / 2, 0, b.z)).y;
    const inView = (p: Vec3) => projectToFrame(pose, FOV, 1.6, viewShift, p) !== null;
    // The middle column, from the fence up: the nearer trees reach up past the far forest's foot, and the far forest's tops
    // reach above the horizon, so every height of the band has a tree in it.
    const middle = (t: { base: Vec3; height: number }) => inView(t.base) && Math.abs(at(t.base).x - 0.5) < 0.1;
    const nearTops = nearTrees(plan).filter(middle).map((t) => at(vec3(t.base.x, t.base.y + t.height, t.base.z)).y);
    const farFoot = at(vec3(plan.centre.x, 0, plan.centre.z - plan.ridgeRadius)).y;
    expect(fence).toBeGreaterThan(farFoot);
    expect(Math.min(...nearTops)).toBeLessThan(farFoot);
    const farTops = forestTrees(plan).filter((t) => t.row === 0 && !t.bare && middle(t)).map((t) => at(vec3(t.base.x, t.base.y + t.height, t.base.z)).y);
    expect(Math.min(...farTops)).toBeLessThan(HORIZON_FROM_TOP);
    // And the ground is flat.
    for (let z = b.z; z >= plan.centre.z - plan.ridgeRadius; z -= 2) expect(landHeightAt(plan, plan.centre.x, z)).toBe(0);
  });

  it.each(REAL_GRAVEYARDS)('%s: the moon and its halo are fully in the frame, in the upper sky above the horizon, on any laptop screen', (name) => {
    const l = layout(loadRealGraveyard(name));
    for (const aspect of [1.4, ...LAPTOP_ASPECTS, 2.2]) {
      const shot = establishingShot(l.bounds, FOV, aspect);
      const halo = moonInFrame(shot, aspect);
      expect(halo.centre.y).toBeLessThan(HORIZON_FROM_TOP * 0.6); // the upper part of the sky
      expect(halo.centre.x).toBeGreaterThan(0.1);
      expect(halo.centre.x).toBeLessThan(0.9);
      for (const p of halo.ring) {
        expect(p.x).toBeGreaterThan(0.01);
        expect(p.x).toBeLessThan(0.99);
        expect(p.y).toBeGreaterThan(0.01);
        expect(p.y).toBeLessThan(HORIZON_FROM_TOP);
      }
    }
  });

  it.each(REAL_GRAVEYARDS)('%s: no tree covers the moon or its halo in the default view, at both laptop window shapes, and the forest dips into a clearing under it', (name) => {
    const l = layout(loadRealGraveyard(name));
    const plan = horizonPlan(l.bounds);
    const trees = forestTrees(plan);
    const triangles = forestTriangles(trees);
    for (const aspect of LAPTOP_ASPECTS) {
      const shot = establishingShot(l.bounds, FOV, aspect);
      const halo = moonInFrame(shot, aspect);
      const radius = Math.max(...halo.ring.map((p) => Math.hypot(p.x - halo.centre.x, p.y - halo.centre.y)));
      let inFrame = 0;
      for (let i = 0; i < triangles.length; i += 9) {
        const corners = [0, 3, 6].map((k) => projectToFrame(shot.pose, FOV, aspect, shot.viewShift, vec3(triangles[i + k]!, triangles[i + k + 1]!, triangles[i + k + 2]!)));
        if (corners.some((c) => c === null)) continue; // behind the camera
        const [a, b, c] = corners as Array<{ x: number; y: number }>;
        if ([a!, b!, c!].some((p) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)) inFrame++;
        expect(triangleMeetsCircle(a!, b!, c!, halo.centre, radius)).toBe(false);
      }
      expect(inFrame).toBeGreaterThan(300); // a dense forest is in the frame

      // The clearing: under the moon the treetops are lower than to its sides.
      const topsNear = (fromX: number, toX: number): number => {
        let top = 1;
        for (const t of trees) {
          const p = projectToFrame(shot.pose, FOV, aspect, shot.viewShift, vec3(t.base.x, t.base.y + t.height, t.base.z));
          if (p && p.x >= fromX && p.x <= toX) top = Math.min(top, p.y);
        }
        return top;
      };
      const under = topsNear(halo.centre.x - 0.02, halo.centre.x + 0.02);
      expect(under).toBeGreaterThan(HORIZON_FROM_TOP); // below the horizon under the moon
      expect(topsNear(0.6, 0.95)).toBeLessThan(HORIZON_FROM_TOP - 0.03); // elsewhere the forest rises into the sky
    }
  });

  it('is the same for the same graveyard and window, and bigger graveyards are seen from further away', () => {
    const small = establishingShot({ x: 0, z: 0, w: 30, d: 30 }, FOV, 1.6);
    const big = establishingShot({ x: 0, z: 0, w: 300, d: 300 }, FOV, 1.6);
    expect(JSON.stringify(establishingShot({ x: 0, z: 0, w: 30, d: 30 }, FOV, 1.6))).toBe(JSON.stringify(small));
    expect(distance(big.pose.position, big.pose.target)).toBeGreaterThan(distance(small.pose.position, small.pose.target) * 5);
  });

  it('is further away for a narrow window than for a wide one: a narrow window is limited by its width', () => {
    const b = { x: 0, z: 0, w: 100, d: 60 };
    const wide = establishingShot(b, FOV, 2);
    const narrow = establishingShot(b, FOV, 0.8);
    expect(distance(narrow.pose.position, narrow.pose.target)).toBeGreaterThan(distance(wide.pose.position, wide.pose.target));
  });
});

describe('the opening shot', () => {
  it('is close to eye level: 10 degrees above the horizontal, in front of the graveyard, looking across the front rows', () => {
    expect(OPENING_ELEVATION_DEG).toBeGreaterThanOrEqual(8);
    expect(OPENING_ELEVATION_DEG).toBeLessThanOrEqual(12);
    fc.assert(
      fc.property(boundsArb, aspectArb, (b, a) => {
        const shot = openingShot(b, FOV, a);
        const t = tiltDeg(shot.pose);
        return t >= 8 && t <= 12 && shot.pose.position.z > b.z + b.d && shot.pose.position.y >= 1 && shot.viewShift === 0;
      }),
    );
  });

  it('is lower than the camera limit, so the move needs its exception, and nearer to the front rows than the establishing shot', () => {
    const b = { x: 0, z: 0, w: 100, d: 80 };
    const opening = openingShot(b, FOV, 1.6);
    const establishing = establishingShot(b, FOV, 1.6);
    expect(tiltDeg(opening.pose)).toBeLessThan(MIN_TILT_DEG);
    expect(opening.pose.position.y).toBeLessThan(establishing.pose.position.y);
    expect(opening.pose.position.z).toBeLessThan(establishing.pose.position.z);
  });

  it('has the moon in view and in the upper half, and the front rows in the lower half', () => {
    const b = { x: 0, z: 0, w: 100, d: 80 };
    const { pose, viewShift } = openingShot(b, FOV, 1.6);
    const far = vec3(pose.position.x + MOON_DIRECTION.x * 1e5, pose.position.y + MOON_DIRECTION.y * 1e5, pose.position.z + MOON_DIRECTION.z * 1e5);
    const moon = projectToFrame(pose, FOV, 1.6, viewShift, far)!;
    expect(moon.y).toBeGreaterThan(0.02);
    expect(moon.y).toBeLessThan(0.5);
    expect(moon.x).toBeGreaterThan(0.05);
    expect(moon.x).toBeLessThan(0.95);
    const front = projectToFrame(pose, FOV, 1.6, viewShift, vec3(50, 0, 80))!;
    expect(front.y).toBeGreaterThan(0.5);
  });
});

describe('blendShots', () => {
  const a = openingShot({ x: 0, z: 0, w: 100, d: 80 }, FOV, 1.6);
  const b = establishingShot({ x: 0, z: 0, w: 100, d: 80 }, FOV, 1.6);

  it('is the first shot at 0 and the second at 1, and in between both the pose and the shift are between them', () => {
    expect(blendShots(a, b, 0)).toEqual(a);
    const end = blendShots(a, b, 1);
    expect(end.pose.position.y).toBeCloseTo(b.pose.position.y, 9);
    expect(end.viewShift).toBeCloseTo(b.viewShift, 12);
    const mid = blendShots(a, b, 0.5);
    expect(mid.viewShift).toBeCloseTo(b.viewShift / 2, 12);
    expect(mid.pose.position.y).toBeGreaterThan(a.pose.position.y);
    expect(mid.pose.position.y).toBeLessThan(b.pose.position.y);
  });

  it('keeps the camera above the ground all the way', () => {
    for (let t = 0; t <= 1; t += 0.05) expect(blendShots(a, b, t).pose.position.y).toBeGreaterThan(0.9);
  });

  it('rises from the low shot into the establishing shot: the tilt only grows', () => {
    let last = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const tilt = tiltDeg(blendShots(a, b, t).pose);
      expect(tilt).toBeGreaterThanOrEqual(last - 1e-9);
      last = tilt;
    }
    void sub;
    void boundsRadius;
  });
});
