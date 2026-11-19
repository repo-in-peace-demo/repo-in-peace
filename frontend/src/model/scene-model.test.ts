import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb, shuffledGraveyard } from '../../test/arbitraries';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { DEFAULT_FOV_Y, flyToPose, startPose } from './camera-pose';
import { layout } from './layout';
import { buildLegend } from './legend';
import { pickNearest } from './pick';
import { buildSceneModel, type SceneModel } from './scene-model';
import { buildSignSources, visibleSigns } from './signs';
import { computeStats } from './stats';
import { SYNTHETIC_SHAPES, makeSyntheticGraveyard } from './synthetic';
import { normalize, sub, vec3 } from './vec3';
import { plotFloorShade, stoneVisual } from './visual-params';

/** The parts of the model that are plain data, to compare two models. (Maps do not turn into JSON.) */
const essence = (m: SceneModel): string =>
  JSON.stringify({
    layout: m.layout,
    stones: m.stones,
    ghosts: m.ghosts,
    floors: m.floors,
    stats: m.stats,
    legend: m.legend,
    signSources: m.signSources,
    pickTargets: m.pickTargets,
    start: m.start,
    lookup: [...m.lookup],
    flyTargets: [...m.flyTargets],
  });

describe('buildSceneModel', () => {
  const g = graveyardFrom({
    files: [
      { path: 'src/b.ts', state: 'stale', ageDays: 30 },
      { path: 'src/a.ts', unused: true, hot: true },
      'z.ts',
    ],
    ghosts: ['src/gone.ts'],
    name: 'demo-repo',
  });
  const model = buildSceneModel(g);

  it('has a stone for every file, in the order of the layout (by path), each with its own layout and look', () => {
    expect(model.stones.map((s) => s.file.path)).toEqual(['src/a.ts', 'src/b.ts', 'z.ts']);
    model.stones.forEach((s, i) => {
      expect(s.layout).toBe(model.layout.stones[i]);
      expect(s.layout.path).toBe(s.file.path);
      expect(s.visual).toEqual(stoneVisual(s.file, g.meta));
    });
  });

  it('shows what the files are: the unused hot file is cracked and has a candle, the stale one has moss', () => {
    const [a, b] = model.stones;
    expect(a!.visual).toMatchObject({ cracked: true, candle: true, mossAmount: 0, leanDegrees: 0 });
    expect(b!.visual.mossAmount).toBeGreaterThan(0);
    expect(b!.visual.cracked).toBe(false);
  });

  it('has a ghost for every ghost, with its own layout', () => {
    expect(model.ghosts).toHaveLength(1);
    expect(model.ghosts[0]!.layout).toBe(model.layout.ghosts[0]);
    expect(model.ghosts[0]!.ghost.path).toBe('src/gone.ts');
    expect(model.ghosts[0]!.visual.opacity).toBeGreaterThan(0);
  });

  it('finds every file and ghost by path, with the kind and the place in its list', () => {
    expect([...model.lookup.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/gone.ts', 'z.ts']);
    expect(model.lookup.get('src/b.ts')).toEqual({ kind: 'file', index: 1 });
    expect(model.lookup.get('src/gone.ts')).toEqual({ kind: 'ghost', index: 0 });
    expect(model.lookup.get('src')).toBeUndefined();
  });

  it('has one floor for every plot, tinted by its depth', () => {
    expect(model.floors.map((f) => f.plot.path)).toEqual(model.layout.plots.map((p) => p.path));
    for (const floor of model.floors) expect(floor.shade).toBe(plotFloorShade(floor.plot.depth));
    expect(model.floors[0]!.shade).toBe(1);
    expect(model.floors[1]!.shade).toBeLessThan(1);
  });

  it('is made of the same pieces that can be built apart', () => {
    expect(model.layout).toEqual(layout(g));
    expect(model.stats).toEqual(computeStats(g));
    expect(model.legend).toEqual(buildLegend(g.meta));
    expect(model.signSources).toEqual(buildSignSources(model.layout, 'demo-repo'));
    expect(model.start).toEqual(startPose(model.layout.bounds, DEFAULT_FOV_Y));
  });

  it('has a pick box and a fly target for every stone and ghost', () => {
    expect(model.pickTargets.map((t) => t.path).sort()).toEqual([...model.lookup.keys()].sort());
    expect([...model.flyTargets.keys()].sort()).toEqual([...model.lookup.keys()].sort());
    expect(flyToPose(model.flyTargets, 'src/gone.ts')).toBeDefined();
  });

  it('fits the starting view to the field of view it is given', () => {
    const narrow = buildSceneModel(g, 30);
    expect(narrow.start).toEqual(startPose(model.layout.bounds, 30));
    expect(narrow.start).not.toEqual(model.start);
  });

  it('gives a leaning stone a wider pick box than its upright self', () => {
    const ancient = graveyardFrom({ files: [{ path: 'a.ts', state: 'ancient', ageDays: 200, linesOfCode: 5000 }] });
    const upright = graveyardFrom({ files: [{ path: 'a.ts', state: 'fresh', linesOfCode: 5000 }] });
    const wide = buildSceneModel(ancient).pickTargets[0]!;
    const narrow = buildSceneModel(upright).pickTargets[0]!;
    expect(wide.max.x - wide.min.x).toBeGreaterThan(narrow.max.x - narrow.min.x);
  });

  it('works for an empty graveyard', () => {
    const empty = buildSceneModel(graveyardFrom({}));
    expect(empty.stones).toEqual([]);
    expect(empty.ghosts).toEqual([]);
    expect(empty.lookup.size).toBe(0);
    expect(empty.floors).toHaveLength(1);
    expect(empty.stats.files).toBe(0);
    expect(empty.signSources).toHaveLength(1);
  });

  it('does not change the data file it is given', () => {
    const before = JSON.stringify(g);
    buildSceneModel(g);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('the scene model of any graveyard', () => {
  it('has exactly one lookup entry for every file and ghost, and each points at the right item', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const m = buildSceneModel(g);
        if (m.lookup.size !== g.files.length + g.ghosts.length) return false;
        for (const [path, { kind, index }] of m.lookup) {
          const found = kind === 'file' ? m.stones[index]?.file.path : m.ghosts[index]?.ghost.path;
          if (found !== path) return false;
        }
        return m.stones.length === g.files.length && m.ghosts.length === g.ghosts.length;
      }),
      { numRuns: 50 },
    );
  });

  it('has one pick box, one fly target, one sign and one floor for what it should', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const m = buildSceneModel(g);
        return (
          m.pickTargets.length === g.files.length + g.ghosts.length &&
          m.flyTargets.size === g.files.length + g.ghosts.length &&
          m.signSources.length === m.layout.plots.length &&
          m.floors.length === m.layout.plots.length &&
          m.layout.plots.length <= g.folders.length
        );
      }),
      { numRuns: 50 },
    );
  });

  it('is the same every time, and does not depend on the order of the data file\'s arrays', () => {
    fc.assert(
      fc.property(graveyardArb, fc.integer({ min: 0, max: 1_000_000 }), (g, seed) => {
        const reference = essence(buildSceneModel(g));
        return essence(buildSceneModel(g)) === reference && essence(buildSceneModel(shuffledGraveyard(g, seed))) === reference;
      }),
      { numRuns: 25 },
    );
  });
});

describe('the scene model of the real test files', () => {
  it.each(REAL_GRAVEYARDS)('%s: every file and ghost can be found, flown to and picked', (name) => {
    const g = loadRealGraveyard(name);
    const m = buildSceneModel(g);
    expect(m.lookup.size).toBe(g.files.length + g.ghosts.length);
    for (const path of m.lookup.keys()) expect(flyToPose(m.flyTargets, path)).toBeDefined();
    for (const target of m.pickTargets) {
      const centre = vec3((target.min.x + target.max.x) / 2, (target.min.y + target.max.y) / 2, (target.min.z + target.max.z) / 2);
      expect(pickNearest(m.pickTargets, m.start.position, normalize(sub(centre, m.start.position)))).toBeDefined();
    }
  });

  it('oikos_ledger: the fresh unused stone is clean, upright and cracked', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.oikosledger'));
    const entry = m.lookup.get('app/components/voice/index.ts')!;
    const stone = m.stones[entry.index]!;
    expect(stone.file.decayState).toBe('fresh');
    expect(stone.visual).toMatchObject({ mossAmount: 0, leanDegrees: 0, cracked: true });
    expect(stone.visual.glow).toBeGreaterThan(0);
  });

  it('spatialql: its two ghosts are in the model with their own look', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.spatialql'));
    expect(m.ghosts.map((q) => q.ghost.path)).toEqual(['src/data/surface-placement.test.ts', 'src/surface-placement.ts']);
    expect(m.ghosts.every((q) => q.visual.opacity < 1)).toBe(true);
  });
});

describe('speed guards: these catch a slowdown that grows with the square of the size, not a few milliseconds', () => {
  const timed = <T>(fn: () => T): { result: T; ms: number } => {
    const start = performance.now();
    const result = fn();
    return { result, ms: performance.now() - start };
  };

  it.each(SYNTHETIC_SHAPES)('lays out 2,000 files of shape %s in well under a second', (shape) => {
    const g = makeSyntheticGraveyard({ files: 2000, seed: 21, shape });
    expect(timed(() => layout(g)).ms).toBeLessThan(1000);
  });

  it.each(SYNTHETIC_SHAPES)('builds the whole scene model of 2,000 files of shape %s in under two seconds', (shape) => {
    const g = makeSyntheticGraveyard({ files: 2000, seed: 21, shape });
    const { result, ms } = timed(() => buildSceneModel(g));
    expect(ms).toBeLessThan(2000);
    expect(result.stones).toHaveLength(2000);
  });

  it('lays out a chain of 1,000 folders that each hold a file without running out of stack', () => {
    const chain: string[] = [];
    for (let i = 0; i < 1000; i++) chain.push(i === 0 ? 'l0' : `${chain[i - 1]}/l${i}`);
    const g = graveyardFrom({ files: chain.map((folder) => `${folder}/f.ts`) });
    const { result, ms } = timed(() => buildSceneModel(g));
    expect(result.layout.plots).toHaveLength(1001); // a file in every folder, so none is shown with the one inside it
    expect(ms).toBeLessThan(2000);
    expect(Number.isFinite(result.layout.bounds.w)).toBe(true);
  });

  it('picks among 2,000 stones 300 times in well under a second', () => {
    const m = buildSceneModel(makeSyntheticGraveyard({ files: 2000, seed: 5, shape: 'flat' }));
    const { ms } = timed(() => {
      for (let i = 0; i < 300; i++) {
        pickNearest(m.pickTargets, m.start.position, normalize(sub(vec3(i % 50, 0, -(i % 40)), m.start.position)));
      }
    });
    expect(ms).toBeLessThan(1000);
  });

  it('chooses the signs to show for the starting view 500 times in well under a second', () => {
    const m = buildSceneModel(makeSyntheticGraveyard({ files: 2000, seed: 5, shape: 'tree' }));
    const forward = normalize(sub(m.start.target, m.start.position));
    const { ms } = timed(() => {
      for (let i = 0; i < 500; i++) {
        visibleSigns(m.signSources, { position: m.start.position, forward, fovY: DEFAULT_FOV_Y, aspect: 1.6 });
      }
    });
    expect(ms).toBeLessThan(1000);
  });
});
