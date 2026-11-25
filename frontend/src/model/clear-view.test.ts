import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { occludersOf } from '../../test/fly-view';
import { sceneCameraLimits } from './camera-bounds';
import { NAME_NEAR } from './engraving';
import { PLATE_W, STAKE_H, stakeSpot, type GraveOverride } from './pr-scene';
import { blockersOf, clearFlyPose, faceOf, flyCandidates, plaqueFaceOf, sceneOccluders, type Face } from './clear-view';
import { clampPose } from './fly-controls';
import { buildSceneModel } from './scene-model';
import { distance, vec3 } from './vec3';

describe('a clear view for flyTo', () => {
  it('sees app/lib/db/queries/recommendations.ts with no fence rail and no stone in the way (both were before)', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.oikosledger'));
    const result = clearFlyPose(m, 'app/lib/db/queries/recommendations.ts', sceneCameraLimits(m.layout.bounds, 1280 / 720), occludersOf(m))!;
    expect(result.blockers).toEqual([]);
  });

  it.each(REAL_GRAVEYARDS)('%s: after flyTo for every stone and ghost, every box still in the way is one that fades; the pose is inside the limits, near enough to read the name, and looks at the grave', (name) => {
    const m = buildSceneModel(loadRealGraveyard(name));
    const limits = sceneCameraLimits(m.layout.bounds, 1280 / 720);
    const occluders = occludersOf(m);
    let clear = 0;
    for (const t of m.pickTargets) {
      const result = clearFlyPose(m, t.path, limits, occluders)!;
      const face = faceOf(m, t.path)!;
      expect(clampPose(result.pose, limits), `${t.path}: inside the limits`).toBe(result.pose);
      expect(distance(result.pose.position, result.pose.target), `${t.path}: near enough to read the name`).toBeLessThan(NAME_NEAR);
      expect(distance(result.pose.target, face.centre), `${t.path}: looks at the grave`).toBeLessThan(3);
      // The fade list is exactly what is in the way from the chosen pose: nothing in the way is left showing.
      expect(blockersOf(result.pose.position, face, occluders).map((b) => b.id).sort()).toEqual(result.blockers.map((b) => b.id).sort());
      if (result.blockers.length === 0) clear++;
    }
    // Most graves get a view with nothing in the way at all (and need no fade).
    expect(clear / m.pickTargets.length).toBeGreaterThan(0.95);
  });

  it('tries the candidates in order and stops at the first clear one; a grave alone on open ground is clear at once', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.spatialql'));
    const limits = sceneCameraLimits(m.layout.bounds, 1280 / 720);
    const path = m.pickTargets[0]!.path;
    const result = clearFlyPose(m, path, limits, [])!;
    expect(result.pose).toEqual(flyCandidates(m, path, limits)[0]);
    expect(result.blockers).toEqual([]);
  });
});

describe('what is in the way', () => {
  const face: Face = { path: 'me', points: [vec3(0, 1, 0)], centre: vec3(0, 1, 0), radius: 0.5 };
  const box = (x: number, z: number, h = 2) => ({ min: vec3(x - 0.5, 0, z - 0.5), max: vec3(x + 0.5, h, z + 0.5) });

  it('is a box on the line from the camera to the face, before it; not one behind it, beside it, or the grave itself', () => {
    const camera = vec3(0, 1, 10);
    const ids = (os: Array<{ id: string; box: ReturnType<typeof box> }>) => blockersOf(camera, face, os.map((o) => ({ kind: 'stone' as const, ...o }))).map((b) => b.id);
    expect(ids([{ id: 'front', box: box(0, 5) }])).toEqual(['front']);
    expect(ids([{ id: 'behind', box: box(0, -5) }])).toEqual([]);
    expect(ids([{ id: 'beside', box: box(4, 5) }])).toEqual([]);
    expect(ids([{ id: 'me', box: box(0, 5) }])).toEqual([]);
  });

  it('for any boxes: the quick test never drops a box that the rays find in the way', () => {
    const coord = fc.double({ min: -8, max: 8, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(coord, coord, fc.double({ min: 0.1, max: 3, noNaN: true })), { maxLength: 8 }), fc.record({ x: coord, y: fc.double({ min: 0.5, max: 12, noNaN: true }), z: fc.double({ min: 2, max: 15, noNaN: true }) }), (raw, camera) => {
        const occluders = raw.map(([x, z, h], i) => ({ kind: 'stone' as const, id: `s${i}`, box: box(x, z, h) }));
        const found = new Set(blockersOf(camera, face, occluders).map((b) => b.id));
        // Brute force: every box against every ray, with no quick test.
        return occluders.every((o) => {
          const t = (p: { x: number; y: number; z: number }) => {
            const d = { x: p.x - camera.x, y: p.y - camera.y, z: p.z - camera.z };
            let near = -Infinity;
            let far = Infinity;
            for (const [oc, dc, lo, hi] of [[camera.x, d.x, o.box.min.x, o.box.max.x], [camera.y, d.y, o.box.min.y, o.box.max.y], [camera.z, d.z, o.box.min.z, o.box.max.z]] as const) {
              if (Math.abs(dc) < 1e-12) { if (oc < lo || oc > hi) return false; continue; }
              const [a, b] = [(lo - oc) / dc, (hi - oc) / dc];
              near = Math.max(near, Math.min(a, b));
              far = Math.min(far, Math.max(a, b));
            }
            return near <= far && far >= 0 && Math.max(near, 0) < 1 - 1e-6;
          };
          return face.points.some(t) === found.has(o.id);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('knows every stone, post, rail and sign of a scene', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.spatialql'));
    const o = sceneOccluders(m);
    expect(o.filter((x) => x.kind === 'stone')).toHaveLength(120);
    expect(o.filter((x) => x.kind === 'sign')).toHaveLength(m.signSources.length);
    expect(o.some((x) => x.id.startsWith('rail:')) && o.some((x) => x.id.startsWith('post:'))).toBe(true);
  });
});

describe('the pull request plaque, in the way of nothing', () => {
  const model = buildSceneModel(loadRealGraveyard('demo.spatialql'));
  const ghost = model.ghosts.findIndex((g) => g.ghost.path === 'src/data/surface-placement.test.ts');
  const risen: GraveOverride = { kind: 'risen', path: model.ghosts[ghost]!.ghost.path, index: ghost, number: 1, startedAt: 0 };

  it('is a grid on the plaque board, just in front of it, at the stake', () => {
    const face = plaqueFaceOf(risen, model);
    const foot = stakeSpot(risen, model);
    expect(face.path).toBe(risen.path);
    for (const p of face.points) {
      expect(Math.abs(p.x - foot.x)).toBeLessThanOrEqual(PLATE_W / 2);
      expect(p.y).toBeLessThanOrEqual(STAKE_H);
      expect(p.z).toBeGreaterThan(foot.z);
    }
  });

  it('finds a stone that stands between the camera and the plaque, though not before the grave\'s own face', () => {
    const foot = stakeSpot(risen, model);
    // A camera low in front of the plaque, and the stone just in front of it in the row ahead.
    const camera = vec3(foot.x, 1.2, foot.z + 12);
    const blockers = blockersOf(camera, plaqueFaceOf(risen, model), sceneOccluders(model)).map((b) => b.id);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers).not.toContain(risen.path);
  });
});
