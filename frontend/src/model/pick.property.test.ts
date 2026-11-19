import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shuffled } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { startPose } from './camera-pose';
import { layout } from './layout';
import { buildPickTargets, pickNearest, rayBoxDistance, type PickTarget } from './pick';
import { normalize, sub, vec3, type Vec3 } from './vec3';
import { stoneVisual } from './visual-params';

/**
 * P15: picking. A ray through the middle of a target's box hits that target or something nearer; a ray that misses every box
 * hits nothing; and the answer does not depend on the order of the targets. The distance to a box is also checked against a
 * slow independent method: walking along the ray in small steps and asking whether the point is inside a box.
 */

const coord = fc.double({ min: -20, max: 20, noNaN: true });

/** Some stones, some leaning, and some ghosts, with distinct paths. */
const targetsArb: fc.Arbitrary<PickTarget[]> = fc
  .record({
    stones: fc.array(
      fc.record({
        x: coord,
        z: coord,
        height: fc.double({ min: 0.6, max: 4, noNaN: true }),
        leanDegrees: fc.oneof(fc.constant(0), fc.double({ min: 2, max: 10, noNaN: true })),
      }),
      { maxLength: 6 },
    ),
    ghosts: fc.array(fc.record({ x: coord, z: coord }), { maxLength: 3 }),
  })
  .map(({ stones, ghosts }) =>
    buildPickTargets(
      stones.map((s, i) => ({ ...s, path: `s${i}.ts` })),
      ghosts.map((g, i) => ({ ...g, path: `g${i}.ts` })),
    ),
  );

const rayArb = fc.record({
  origin: fc.record({ x: fc.double({ min: -40, max: 40, noNaN: true }), y: fc.double({ min: 0.1, max: 30, noNaN: true }), z: fc.double({ min: -40, max: 40, noNaN: true }) }),
  direction: fc
    .record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: -1, max: 1, noNaN: true }), z: fc.double({ min: -1, max: 1, noNaN: true }) })
    .filter((v) => Math.hypot(v.x, v.y, v.z) > 0.1)
    .map(normalize),
});

const inBox = (t: PickTarget, p: Vec3, slack = 0): boolean =>
  p.x >= t.min.x - slack && p.x <= t.max.x + slack && p.y >= t.min.y - slack && p.y <= t.max.y + slack && p.z >= t.min.z - slack && p.z <= t.max.z + slack;

const along = (origin: Vec3, direction: Vec3, t: number): Vec3 => vec3(origin.x + direction.x * t, origin.y + direction.y * t, origin.z + direction.z * t);

describe('P15: picking', () => {
  it('a ray through the middle of a target\'s box, from in front and above, hits it or something nearer', () => {
    fc.assert(
      fc.property(targetsArb, (targets) => {
        for (const target of targets) {
          const centre = vec3(
            (target.min.x + target.max.x) / 2,
            (target.min.y + target.max.y) / 2,
            (target.min.z + target.max.z) / 2,
          );
          const origin = vec3(centre.x, centre.y + 20, centre.z + 30);
          const direction = normalize(sub(centre, origin));
          const own = rayBoxDistance(target, origin, direction);
          const picked = pickNearest(targets, origin, direction);
          if (own === undefined || picked === undefined) return false;
          const pickedDistance = rayBoxDistance(picked, origin, direction)!;
          if (pickedDistance > own + 1e-9) return false;
        }
        return true;
      }),
    );
  });

  it('a ray pointing up from above the stones hits nothing', () => {
    fc.assert(
      fc.property(targetsArb, fc.double({ min: 0, max: 1, noNaN: true }), coord, coord, (targets, up, x, z) => {
        return pickNearest(targets, vec3(x, 50, z), normalize(vec3(0.3, 0.01 + up, -0.2))) === undefined;
      }),
    );
  });

  it('a ray pointing straight down beside every box hits nothing', () => {
    fc.assert(
      fc.property(targetsArb, (targets) => {
        const farOutside = vec3(500, 40, 500);
        return pickNearest(targets, farOutside, vec3(0, -1, 0)) === undefined;
      }),
    );
  });

  it('gives the same answer whatever order the targets are in', () => {
    fc.assert(
      fc.property(targetsArb, rayArb, fc.integer({ min: 0, max: 1_000_000 }), (targets, ray, seed) => {
        return pickNearest(targets, ray.origin, ray.direction)?.path === pickNearest(shuffled(targets, seed), ray.origin, ray.direction)?.path;
      }),
    );
  });

  it('never reports a target that another is strictly nearer than', () => {
    fc.assert(
      fc.property(targetsArb, rayArb, (targets, ray) => {
        const picked = pickNearest(targets, ray.origin, ray.direction);
        if (picked === undefined) return targets.every((t) => rayBoxDistance(t, ray.origin, ray.direction) === undefined);
        const best = rayBoxDistance(picked, ray.origin, ray.direction)!;
        return targets.every((t) => {
          const d = rayBoxDistance(t, ray.origin, ray.direction);
          return d === undefined || d >= best - 1e-12;
        });
      }),
    );
  });

  it('reports a hit at a point that is on or inside the box', () => {
    fc.assert(
      fc.property(targetsArb, rayArb, (targets, ray) => {
        const picked = pickNearest(targets, ray.origin, ray.direction);
        if (picked === undefined) return true;
        const t = rayBoxDistance(picked, ray.origin, ray.direction)!;
        return inBox(picked, along(ray.origin, ray.direction, t), 1e-6);
      }),
    );
  });

  it('agrees with walking along the ray in small steps: whatever the walk finds, the answer finds at least as near', () => {
    const step = 0.02;
    fc.assert(
      fc.property(targetsArb, rayArb, (targets, ray) => {
        let walked: number | undefined;
        for (let s = 0; s <= 150 && walked === undefined; s += step) {
          const p = along(ray.origin, ray.direction, s);
          if (targets.some((t) => inBox(t, p))) walked = s;
        }
        const picked = pickNearest(targets, ray.origin, ray.direction);
        if (walked === undefined) return true; // the walk can miss a corner that the exact test finds
        if (picked === undefined) return false;
        return rayBoxDistance(picked, ray.origin, ray.direction)! <= walked + 1e-9;
      }),
      { numRuns: 150 },
    );
  });
});

describe('P15 on the real files: a ray from the starting camera to the middle of any stone hits it or something in front of it', () => {
  it.each(REAL_GRAVEYARDS)('%s', (name) => {
    const g = loadRealGraveyard(name);
    const l = layout(g);
    const stoneByPath = new Map(g.files.map((f) => [f.path, f] as const));
    const targets = buildPickTargets(
      l.stones.map((s) => ({ path: s.path, x: s.x, z: s.z, height: s.height, leanDegrees: stoneVisual(stoneByPath.get(s.path)!, g.meta).leanDegrees })),
      l.ghosts.map((q) => ({ path: q.path, x: q.x, z: q.z })),
    );
    expect(targets).toHaveLength(l.stones.length + l.ghosts.length);

    const camera = startPose(l.bounds, 50).position;
    for (const target of targets) {
      const centre = vec3((target.min.x + target.max.x) / 2, (target.min.y + target.max.y) / 2, (target.min.z + target.max.z) / 2);
      const direction = normalize(sub(centre, camera));
      const picked = pickNearest(targets, camera, direction);
      expect(picked).toBeDefined();
      expect(rayBoxDistance(picked!, camera, direction)!).toBeLessThanOrEqual(rayBoxDistance(target, camera, direction)! + 1e-9);
    }
  });

  it('a ray from straight above any stone, pointing down, finds that stone or one directly under the same line', () => {
    const g = loadRealGraveyard('demo.spatialql');
    const l = layout(g);
    const targets = buildPickTargets(
      l.stones.map((s) => ({ path: s.path, x: s.x, z: s.z, height: s.height, leanDegrees: 0 })),
      [],
    );
    for (const s of l.stones) {
      const picked = pickNearest(targets, vec3(s.x, 100, s.z), vec3(0, -1, 0));
      expect(picked?.path).toBe(s.path);
    }
  });
});
