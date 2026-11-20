import { describe, expect, it, vi } from 'vitest';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import {
  buildFlyTargets,
  easeInOutCubic,
  flyToPose,
  interpolatePose,
  startPose,
  type CameraPose,
} from './camera-pose';
import { establishingShot, legacyShot, minFovForShot } from './framing';
import { MIN_TILT_DEG } from './fly-controls';
import { layout } from './layout';
import { buildSignSources, visibleSigns } from './signs';
import { makeSyntheticGraveyard } from './synthetic';
import { stoneHeight } from './tombstone-height';
import { NAME_NEAR } from './engraving';
import { distance, normalize, sub, vec3 } from './vec3';
import { GHOST_FLOAT_BASE, GHOST_HEIGHT } from './visual-constants';

const FOV = 50;

describe('easeInOutCubic', () => {
  it('is 0 at the start, 1 at the end and 0.5 in the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });

  it('is slow at both ends: a quarter of the time covers well under a quarter of the way', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.9);
  });

  it('never goes backwards, and is the same read from either end', () => {
    let last = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const e = easeInOutCubic(t);
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e + easeInOutCubic(1 - t)).toBeCloseTo(1, 12);
      last = e;
    }
  });

  it('holds its input to 0 to 1', () => {
    expect(easeInOutCubic(-5)).toBe(0);
    expect(easeInOutCubic(7)).toBe(1);
  });
});

describe('startPose', () => {
  it('looks at the middle of the graveyard on the ground', () => {
    const pose = startPose({ x: 10, z: 20, w: 100, d: 60 }, FOV);
    expect(pose.target).toEqual({ x: 60, y: 0, z: 50 });
  });

  it('stands in front of the graveyard and above it, on the middle line', () => {
    const pose = startPose({ x: 0, z: 0, w: 200, d: 200 }, FOV);
    expect(pose.position.x).toBeCloseTo(pose.target.x, 9);
    expect(pose.position.z).toBeGreaterThan(pose.target.z);
    expect(pose.position.y).toBeGreaterThan(0);
  });

  it('is never closer than 20 units, even for a tiny graveyard', () => {
    const pose = startPose({ x: 0, z: 0, w: 3, d: 3 }, FOV);
    expect(distance(pose.position, pose.target)).toBeCloseTo(20, 9);
  });

  // How far back the shot stands, with every corner of the graveyard in the frame and no nearer, is tested in framing.test.ts.

  it('stands further back for a bigger graveyard, and for a narrower field of view', () => {
    const small = startPose({ x: 0, z: 0, w: 100, d: 100 }, FOV);
    const big = startPose({ x: 0, z: 0, w: 400, d: 400 }, FOV);
    // 40 degrees: narrower than FOV, but over the narrowest field of view the establishing shot exists for (minFovForShot, about 32.4).
    const narrow = startPose({ x: 0, z: 0, w: 100, d: 100 }, 40);
    expect(distance(big.position, big.target)).toBeGreaterThan(distance(small.position, small.target));
    expect(distance(narrow.position, narrow.target)).toBeGreaterThan(distance(small.position, small.target));
  });

  it('never throws: for a field of view too narrow for the shot it falls back to the legacy pose, with a development warning', () => {
    const bounds = { x: 0, z: 0, w: 100, d: 100 };
    expect(minFovForShot()).toBeGreaterThan(30);
    // The search itself fails with a clear message instead of searching forever.
    expect(() => establishingShot(bounds, 30, 1.6)).toThrow(/field of view must be over 32\.4 degrees/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const pose = startPose(bounds, 30);
      expect(pose).toEqual(legacyShot(bounds, 30).pose);
      // The legacy distance: 1.15 × radius / sin(fov / 2).
      expect(distance(pose.position, pose.target)).toBeCloseTo((1.15 * Math.hypot(100, 100)) / 2 / Math.sin((30 * Math.PI) / 360), 6);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/falling back to the legacy starting view.*32\.4 degrees/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('flyToPose', () => {
  const g = graveyardFrom({
    files: [{ path: 'src/tiny.ts', linesOfCode: 1 }, { path: 'src/huge.ts', linesOfCode: 6451 }, { path: 'src/mid.ts', linesOfCode: 120 }],
    ghosts: ['src/gone.ts'],
  });
  const l = layout(g);
  const targets = buildFlyTargets(l);

  it('has a target for every file and every ghost, and no other', () => {
    expect([...targets.keys()].sort()).toEqual(['src/gone.ts', 'src/huge.ts', 'src/mid.ts', 'src/tiny.ts']);
    expect(targets.get('src/gone.ts')!.kind).toBe('ghost');
    expect(targets.get('src/mid.ts')!.kind).toBe('file');
  });

  it('looks at the middle of a stone\'s face, from in front and above', () => {
    const stone = l.stones.find((s) => s.path === 'src/mid.ts')!;
    const pose = flyToPose(targets, 'src/mid.ts')!;
    expect(pose.target.x).toBeCloseTo(stone.x, 9);
    expect(pose.target.z).toBeCloseTo(stone.z, 9);
    expect(pose.target.y).toBeCloseTo(0.55 * stoneHeight(120), 9);
    const offset = sub(pose.position, pose.target);
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.z).toBeGreaterThan(0);
    expect(offset.y / offset.z).toBeCloseTo(0.375, 9);
    // Above the camera's tilt limit, so clampPose leaves a flight's end where it is.
    expect((Math.atan(offset.y / offset.z) * 180) / Math.PI).toBeGreaterThan(MIN_TILT_DEG);
  });

  it('stands further back from a taller stone', () => {
    const away = (path: string) => {
      const pose = flyToPose(targets, path)!;
      return distance(pose.position, pose.target);
    };
    expect(away('src/tiny.ts')).toBeLessThan(away('src/mid.ts'));
    expect(away('src/mid.ts')).toBeLessThan(away('src/huge.ts'));
  });

  it('keeps the distance between 8 and 14 units: 2 × height + 5 in between', () => {
    const tiny = flyToPose(targets, 'src/tiny.ts')!;
    const huge = flyToPose(targets, 'src/huge.ts')!;
    expect(distance(tiny.position, tiny.target)).toBeCloseTo(Math.max(8, 2 * stoneHeight(1) + 5), 9);
    expect(distance(huge.position, huge.target)).toBeCloseTo(2 * stoneHeight(6451) + 5, 9);
  });

  it('stands every stone within the distance its engraved name is fully readable from', () => {
    for (const path of ['src/tiny.ts', 'src/mid.ts', 'src/huge.ts']) {
      const pose = flyToPose(targets, path)!;
      expect(distance(pose.position, pose.target)).toBeLessThan(NAME_NEAR);
    }
  });

  it('aims at a ghost at the middle of its floating figure', () => {
    const ghost = l.ghosts[0]!;
    const pose = flyToPose(targets, 'src/gone.ts')!;
    expect(pose.target.x).toBeCloseTo(ghost.x, 9);
    expect(pose.target.z).toBeCloseTo(ghost.z, 9);
    expect(pose.target.y).toBeCloseTo(GHOST_FLOAT_BASE + 0.55 * GHOST_HEIGHT, 9);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it('does nothing for a path that is neither a file nor a ghost', () => {
    expect(flyToPose(targets, 'nope.ts')).toBeUndefined();
    expect(flyToPose(targets, '')).toBeUndefined();
    expect(flyToPose(targets, 'src')).toBeUndefined(); // a folder
    expect(flyToPose(targets, 'src/')).toBeUndefined();
  });

  it('can fly to the fresh unused stone of the oikos file, and to both spatialql ghosts', () => {
    const oikos = layout(loadRealGraveyard('demo.oikosledger'));
    const voice = flyToPose(buildFlyTargets(oikos), 'app/components/voice/index.ts')!;
    expect(voice).toBeDefined();
    expect(voice.position.y).toBeGreaterThan(0);

    const spatial = buildFlyTargets(layout(loadRealGraveyard('demo.spatialql')));
    for (const path of ['src/surface-placement.ts', 'src/data/surface-placement.test.ts']) {
      expect(spatial.get(path)!.kind).toBe('ghost');
      expect(flyToPose(spatial, path)).toBeDefined();
    }
  });
});

describe('interpolatePose', () => {
  const a: CameraPose = { position: vec3(0, 10, 0), target: vec3(0, 0, -10) };
  const farAway: CameraPose = { position: vec3(1000, 10, 0), target: vec3(1000, 0, -10) };
  const near: CameraPose = { position: vec3(100, 10, 0), target: vec3(100, 0, -10) };

  it('is the start pose at 0 and the end pose at 1, and holds outside', () => {
    expect(interpolatePose(a, farAway, 0)).toBe(a);
    expect(interpolatePose(a, farAway, 1)).toBe(farAway);
    expect(interpolatePose(a, farAway, -1)).toBe(a);
    expect(interpolatePose(a, farAway, 2)).toBe(farAway);
  });

  it('is half way, and as high as it rises, in the middle of the time', () => {
    const middle = interpolatePose(a, farAway, 0.5);
    expect(middle.position.x).toBeCloseTo(500, 9);
    expect(middle.target.x).toBeCloseTo(500, 9);
    expect(middle.position.y).toBeCloseTo(10 + 30, 9); // a flight of 1000 rises 30, the most it ever does
  });

  it('rises by 15% of the length for a short flight', () => {
    expect(interpolatePose(a, near, 0.5).position.y).toBeCloseTo(10 + 15, 9);
  });

  it('does not rise for a flight that stays where it is', () => {
    expect(interpolatePose(a, a, 0.5).position.y).toBeCloseTo(10, 9);
  });

  it('moves slowly at first: a quarter of the time covers well under a quarter of the way', () => {
    expect(interpolatePose(a, farAway, 0.25).position.x).toBeLessThan(100);
  });

  it('does not change the poses it is given', () => {
    const before = JSON.stringify([a, farAway]);
    interpolatePose(a, farAway, 0.3);
    expect(JSON.stringify([a, farAway])).toBe(before);
  });
});

describe('the root sign from the starting view (the last part of P14)', () => {
  const view = (g: ReturnType<typeof makeSyntheticGraveyard>, aspect = 1.6) => {
    const l = layout(g);
    const pose = startPose(l.bounds, FOV);
    const forward = normalize(sub(pose.target, pose.position));
    const rootPath = l.plots.find((p) => p.parent === null)!.path; // the plot that holds the root folder
    return { sources: buildSignSources(l, g.meta.name), rootPath, camera: { position: pose.position, forward, fovY: FOV, aspect } };
  };

  it.each(REAL_GRAVEYARDS)('shows the name of the repository in %s', (name) => {
    const g = loadRealGraveyard(name);
    const { sources, camera, rootPath } = view(g);
    const root = visibleSigns(sources, camera).find((s) => s.path === rootPath);
    expect(root).toBeDefined();
    expect(root!.label.startsWith(g.meta.name)).toBe(true); // the name, and for oikos_ledger also the folder that the root only holds
    expect(root!.opacity).toBeGreaterThan(0.3);
  });

  it.each(['tree', 'flat', 'deep', 'wide', 'mixed'] as const)('shows it for a graveyard of 2,000 files, shape %s', (shape) => {
    const g = makeSyntheticGraveyard({ files: 2000, seed: 3, shape });
    const { sources, camera, rootPath } = view(g);
    expect(visibleSigns(sources, camera).find((s) => s.path === rootPath)?.opacity ?? 0).toBeGreaterThan(0);
  });

  it('shows it for a graveyard of one file, and for an empty one', () => {
    for (const g of [graveyardFrom({ files: ['a.ts'] }), graveyardFrom({})]) {
      const { sources, camera, rootPath } = view(g);
      expect(visibleSigns(sources, camera).find((s) => s.path === rootPath)?.opacity ?? 0).toBeGreaterThan(0);
    }
  });

  it('shows only a few signs at the starting view of a deep tree, not all of its 68 folders', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const { sources, camera } = view(g);
    const shown = visibleSigns(sources, camera);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(sources.length);
  });
});
