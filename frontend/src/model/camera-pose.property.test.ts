import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { buildFlyTargets, easeInOutCubic, flyToPose, interpolatePose, startPose, type CameraPose } from './camera-pose';
import { layout } from './layout';
import { buildSignSources, visibleSigns } from './signs';
import { distance, length, normalize, sub, vec3, type Vec3 } from './vec3';

/**
 * P12: `flyTo` poses. P16: the steps between two poses. And the last part of P14: the root's sign is readable
 * from the starting view, for graveyards of any size.
 */

const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('P12: flyTo gives a usable pose for every file and ghost', () => {
  it('is finite, above the ground, aimed inside the graveyard, and between 8 and 40 units from its target', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const targets = buildFlyTargets(l);
        const pad = 5; // a stone is at most 4 high; a ghost floats a little
        for (const path of targets.keys()) {
          const pose = flyToPose(targets, path);
          if (pose === undefined || !finite(pose.position) || !finite(pose.target)) return false;
          if (pose.position.y <= 0) return false;
          const { x, z, w, d } = l.bounds;
          if (pose.target.x < x - pad || pose.target.x > x + w + pad || pose.target.z < z - pad || pose.target.z > z + d + pad) return false;
          if (pose.target.y < 0 || pose.target.y > pad) return false;
          const away = distance(pose.position, pose.target);
          if (away < 8 - 1e-9 || away > 40 + 1e-9) return false;
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('has a target for exactly the files and ghosts of the data file', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const targets = buildFlyTargets(layout(g));
        const expected = [...g.files.map((f) => f.path), ...g.ghosts.map((x) => x.path)].sort();
        return JSON.stringify([...targets.keys()].sort()) === JSON.stringify(expected);
      }),
      { numRuns: 60 },
    );
  });

  it('gives nothing for a path that is not a file or a ghost', () => {
    fc.assert(
      fc.property(graveyardArb, fc.string({ maxLength: 40 }), (g, path) => {
        const targets = buildFlyTargets(layout(g));
        return targets.has(path) || flyToPose(targets, path) === undefined;
      }),
      { numRuns: 60 },
    );
  });

  it('gives nothing for a folder path', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const targets = buildFlyTargets(layout(g));
        return g.folders.every((f) => targets.has(f.path) || flyToPose(targets, f.path) === undefined);
      }),
      { numRuns: 60 },
    );
  });

  it('looks at the stone it flies to: the stone is in front of the camera', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const targets = buildFlyTargets(l);
        return l.stones.slice(0, 50).every((s) => {
          const pose = flyToPose(targets, s.path)!;
          const toStone = normalize(sub(vec3(s.x, 0, s.z), pose.position));
          const forward = normalize(sub(pose.target, pose.position));
          return toStone.x * forward.x + toStone.y * forward.y + toStone.z * forward.z > 0.5; // well within the view
        });
      }),
      { numRuns: 40 },
    );
  });
});

describe('P16: camera interpolation', () => {
  const coord = fc.double({ min: -2000, max: 2000, noNaN: true });
  const pose: fc.Arbitrary<CameraPose> = fc.record({
    position: fc.record({ x: coord, y: fc.double({ min: 0.5, max: 500, noNaN: true }), z: coord }),
    target: fc.record({ x: coord, y: fc.double({ min: 0, max: 20, noNaN: true }), z: coord }),
  });
  const unit = fc.double({ min: 0, max: 1, noNaN: true });

  it('reaches both end poses', () => {
    fc.assert(
      fc.property(pose, pose, (a, b) => interpolatePose(a, b, 0) === a && interpolatePose(a, b, 1) === b),
    );
  });

  it('gives finite numbers at any time', () => {
    fc.assert(
      fc.property(pose, pose, fc.double({ min: -2, max: 3, noNaN: true }), (a, b, t) => {
        const p = interpolatePose(a, b, t);
        return finite(p.position) && finite(p.target);
      }),
    );
  });

  it('keeps the camera above the ground between two poses that are above it', () => {
    fc.assert(
      fc.property(pose, pose, unit, (a, b, t) => {
        const p = interpolatePose(a, b, t);
        return p.position.y >= Math.min(a.position.y, b.position.y) - 1e-9 && p.position.y > 0;
      }),
    );
  });

  it('rises at most 30 units above the straight line, and the target moves in a straight line', () => {
    fc.assert(
      fc.property(pose, pose, unit, (a, b, t) => {
        const p = interpolatePose(a, b, t);
        const e = easeInOutCubic(t);
        const straightY = a.position.y + (b.position.y - a.position.y) * e;
        const targetOnLine =
          Math.abs(p.target.x - (a.target.x + (b.target.x - a.target.x) * e)) < 1e-6 &&
          Math.abs(p.target.z - (a.target.z + (b.target.z - a.target.z) * e)) < 1e-6;
        return p.position.y - straightY <= 30 + 1e-6 && p.position.y - straightY >= -1e-6 && targetOnLine;
      }),
    );
  });

  it('makes progress along the way: the horizontal position never goes backwards as time goes on', () => {
    fc.assert(
      fc.property(pose, pose, unit, unit, (a, b, t1, t2) => {
        const [early, late] = t1 <= t2 ? [t1, t2] : [t2, t1];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const along = (t: number) => {
          const p = interpolatePose(a, b, t).position;
          return (p.x - a.position.x) * dx + (p.z - a.position.z) * dz;
        };
        return along(early) <= along(late) + 1e-6;
      }),
    );
  });

  it('is the same pose every time for the same time', () => {
    fc.assert(
      fc.property(pose, pose, unit, (a, b, t) => JSON.stringify(interpolatePose(a, b, t)) === JSON.stringify(interpolatePose(a, b, t))),
    );
  });
});

describe('P14, last part: the root\'s sign from the starting view', () => {
  it('is shown, and in view, for graveyards of any size and shape, with the scene\'s field of view or wider', () => {
    fc.assert(
      fc.property(graveyardArb, fc.double({ min: 45, max: 100, noNaN: true }), fc.double({ min: 1, max: 2.4, noNaN: true }), (g, fovY, aspect) => {
        const l = layout(g);
        const pose = startPose(l.bounds, fovY);
        const forward = normalize(sub(pose.target, pose.position));
        const shown = visibleSigns(buildSignSources(l, g.meta.name), { position: pose.position, forward, fovY, aspect });
        const rootPath = l.plots.find((p) => p.parent === null)!.path; // the plot that holds the root folder
        const root = shown.find((s) => s.path === rootPath);
        return root !== undefined && root.opacity > 0;
      }),
      { numRuns: 80 },
    );
  });

  it('has the starting camera above the ground, in front of the graveyard and at least 20 units from its centre', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const pose = startPose(l.bounds, 50);
        return (
          finite(pose.position) &&
          pose.position.y > 0 &&
          pose.position.z > pose.target.z &&
          length(sub(pose.position, pose.target)) >= 20 - 1e-9 &&
          pose.target.x >= l.bounds.x &&
          pose.target.x <= l.bounds.x + l.bounds.w &&
          pose.target.z >= l.bounds.z &&
          pose.target.z <= l.bounds.z + l.bounds.d
        );
      }),
    );
  });
});
