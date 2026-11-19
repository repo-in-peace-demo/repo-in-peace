import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateGraveyard } from '@shared/graveyard-schema';
import { syntheticOptionsArb } from '../../test/arbitraries';
import { SYNTHETIC_SHAPES, SYNTHETIC_THRESHOLDS, makeSyntheticGraveyard } from './synthetic';

describe('makeSyntheticGraveyard', () => {
  it('gives the same file for the same options', () => {
    fc.assert(
      fc.property(syntheticOptionsArb, (options) => {
        return JSON.stringify(makeSyntheticGraveyard(options)) === JSON.stringify(makeSyntheticGraveyard(options));
      }),
      { numRuns: 40 },
    );
  });

  it('gives a different file for a different seed', () => {
    const a = makeSyntheticGraveyard({ files: 50, seed: 1 });
    const b = makeSyntheticGraveyard({ files: 50, seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('passes the shared validator, whatever the shape, size and thresholds', () => {
    fc.assert(
      fc.property(syntheticOptionsArb, (options) => {
        const result = validateGraveyard(makeSyntheticGraveyard(options));
        expect(result).toEqual({ ok: true });
        return true;
      }),
      { numRuns: 150 },
    );
  });

  it('has exactly the number of files asked for, in every shape', () => {
    fc.assert(
      fc.property(syntheticOptionsArb, (options) => makeSyntheticGraveyard(options).files.length === options.files),
      { numRuns: 100 },
    );
  });

  it('has exactly the number of ghosts asked for, and 2% of the files when not asked', () => {
    expect(makeSyntheticGraveyard({ files: 100, seed: 1, ghosts: 7 }).ghosts).toHaveLength(7);
    expect(makeSyntheticGraveyard({ files: 200, seed: 1 }).ghosts).toHaveLength(4);
    expect(makeSyntheticGraveyard({ files: 10, seed: 1 }).ghosts).toHaveLength(0);
  });

  it('works for no files at all, in every shape', () => {
    for (const shape of SYNTHETIC_SHAPES) {
      const g = makeSyntheticGraveyard({ files: 0, seed: 1, shape });
      expect(g.files).toEqual([]);
      expect(validateGraveyard(g)).toEqual({ ok: true });
    }
  });

  it('uses the thresholds it is given, and the oikos ones when not', () => {
    expect(makeSyntheticGraveyard({ files: 5, seed: 1 }).meta.thresholds).toEqual(SYNTHETIC_THRESHOLDS);
    const custom = { staleAfterDays: 7, ancientAfterDays: 20, decayCapDays: 40, hotCommits: 2, hotWindowDays: 14 };
    expect(makeSyntheticGraveyard({ files: 5, seed: 1, thresholds: custom }).meta.thresholds).toEqual(custom);
  });

  it('is consistent with its own thresholds: every state agrees with the age, and hot with the commits', () => {
    fc.assert(
      fc.property(syntheticOptionsArb, (options) => {
        const g = makeSyntheticGraveyard(options);
        const t = g.meta.thresholds;
        const snapshot = Date.parse(g.meta.snapshotDate);
        return g.files.every((f) => {
          const age = Math.floor((snapshot - Date.parse(f.lastCommitDate)) / 86_400_000);
          const state = age < t.staleAfterDays ? 'fresh' : age <= t.ancientAfterDays ? 'stale' : 'ancient';
          return f.decayState === state && f.hot === f.recentCommits >= t.hotCommits && f.decayScore >= 0 && f.decayScore <= 1;
        });
      }),
      { numRuns: 60 },
    );
  });

  describe('shapes', () => {
    it('flat: every file is in src', () => {
      const g = makeSyntheticGraveyard({ files: 120, seed: 4, shape: 'flat' });
      expect(g.folders.map((f) => f.path)).toEqual(['', 'src']);
      expect(g.files.every((f) => f.folder === 'src')).toBe(true);
    });

    it('deep: a chain of the asked depth, with the deepest folder holding the rest of the files', () => {
      const g = makeSyntheticGraveyard({ files: 50, seed: 4, shape: 'deep', depth: 20 });
      expect(g.folders).toHaveLength(21); // the root and 20 levels
      const deepest = g.folders.map((f) => f.path).sort((a, b) => b.length - a.length)[0]!;
      expect(deepest.split('/')).toHaveLength(20);
    });

    it('deep: reaches 300 levels', () => {
      const g = makeSyntheticGraveyard({ files: 300, seed: 4, shape: 'deep', depth: 300 });
      expect(g.folders).toHaveLength(301);
    });

    it('wide: many siblings under src, a similar number of files in each', () => {
      const g = makeSyntheticGraveyard({ files: 100, seed: 4, shape: 'wide' });
      const siblings = g.folders.filter((f) => f.parent === 'src');
      expect(siblings).toHaveLength(10);
      const perFolder = new Map<string, number>();
      for (const f of g.files) perFolder.set(f.folder, (perFolder.get(f.folder) ?? 0) + 1);
      expect(Math.max(...perFolder.values())).toBe(10);
    });

    it('mixed: has a crowded folder, a chain and a tree', () => {
      const g = makeSyntheticGraveyard({ files: 200, seed: 4, shape: 'mixed' });
      const paths = g.folders.map((f) => f.path);
      expect(paths).toContain('crowded');
      expect(paths.some((p) => p.startsWith('chain/level0/level1'))).toBe(true);
      expect(paths.some((p) => p.startsWith('tree/'))).toBe(true);
      expect(g.files.filter((f) => f.folder === 'crowded')).toHaveLength(80);
    });

    it('tree: nests folders, with files at several depths', () => {
      const g = makeSyntheticGraveyard({ files: 300, seed: 9, shape: 'tree' });
      const depths = new Set(g.files.map((f) => (f.folder === '' ? 0 : f.folder.split('/').length)));
      expect(depths.size).toBeGreaterThan(2);
    });
  });

  it('gives a mix of the three states and some unused and hot files in a large tree with the oikos thresholds', () => {
    const g = makeSyntheticGraveyard({ files: 700, seed: 11, shape: 'tree' });
    expect(new Set(g.files.map((f) => f.decayState))).toEqual(new Set(['fresh', 'stale', 'ancient']));
    expect(g.files.some((f) => f.unused)).toBe(true);
    expect(g.files.some((f) => f.hot)).toBe(true);
  });

  it('puts ghosts in folders that exist and in folders that do not', () => {
    const g = makeSyntheticGraveyard({ files: 200, seed: 12, shape: 'tree', ghosts: 60 });
    const folders = new Set(g.folders.map((f) => f.path));
    const inExisting = g.ghosts.filter((x) => folders.has(x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : ''));
    expect(inExisting.length).toBeGreaterThan(0);
    expect(inExisting.length).toBeLessThan(g.ghosts.length);
  });

  it('never gives a ghost the path of a file', () => {
    fc.assert(
      fc.property(syntheticOptionsArb, (options) => {
        const g = makeSyntheticGraveyard(options);
        const files = new Set(g.files.map((f) => f.path));
        return g.ghosts.every((x) => !files.has(x.path));
      }),
      { numRuns: 60 },
    );
  });
});
