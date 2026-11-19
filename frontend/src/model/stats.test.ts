import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { computeStats } from './stats';

describe('computeStats', () => {
  it('counts an empty graveyard as zeros, with the root folder', () => {
    expect(computeStats(graveyardFrom({}))).toEqual({
      files: 0, folders: 1, ghosts: 0, fresh: 0, stale: 0, ancient: 0, unused: 0, hot: 0,
    });
  });

  it('counts files by state, and unused and hot among all states', () => {
    const g = graveyardFrom({
      files: [
        { path: 'a.ts', state: 'fresh' },
        { path: 'b.ts', state: 'fresh', unused: true },
        { path: 'src/c.ts', state: 'stale', hot: true },
        { path: 'src/d.ts', state: 'stale', unused: true, hot: true },
        { path: 'src/e.ts', state: 'ancient', unused: true },
        { path: 'src/f.ts', state: 'ancient' },
      ],
      ghosts: ['gone.ts', 'src/gone.ts', 'old/gone.ts'],
    });
    expect(computeStats(g)).toEqual({
      files: 6,
      folders: 2,
      ghosts: 3,
      fresh: 2,
      stale: 2,
      ancient: 2,
      unused: 3,
      hot: 2,
    });
  });

  it('counts a fresh unused file as fresh and as unused', () => {
    const stats = computeStats(graveyardFrom({ files: [{ path: 'a.ts', state: 'fresh', unused: true }] }));
    expect(stats.fresh).toBe(1);
    expect(stats.unused).toBe(1);
    expect(stats.stale + stats.ancient).toBe(0);
  });

  it('does not change the data file it is given', () => {
    const g = graveyardFrom({ files: ['a.ts'], ghosts: ['b.ts'] });
    const before = JSON.stringify(g);
    computeStats(g);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('P11: the statistics add up', () => {
  it('has fresh, stale and ancient adding up to the number of files, for any graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const s = computeStats(g);
        return s.fresh + s.stale + s.ancient === s.files && s.files === g.files.length;
      }),
    );
  });

  it('counts unused, hot, ghosts and folders as a direct count does', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const s = computeStats(g);
        return (
          s.unused === g.files.filter((f) => f.unused).length &&
          s.hot === g.files.filter((f) => f.hot).length &&
          s.ghosts === g.ghosts.length &&
          s.folders === g.folders.length &&
          s.unused <= s.files &&
          s.hot <= s.files
        );
      }),
    );
  });

  it('counts each state as a direct count does', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const s = computeStats(g);
        return (
          s.fresh === g.files.filter((f) => f.decayState === 'fresh').length &&
          s.stale === g.files.filter((f) => f.decayState === 'stale').length &&
          s.ancient === g.files.filter((f) => f.decayState === 'ancient').length
        );
      }),
    );
  });

  it('does not depend on the order of the files', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const reversed = { ...g, files: [...g.files].reverse() };
        return JSON.stringify(computeStats(reversed)) === JSON.stringify(computeStats(g));
      }),
    );
  });
});

describe('the real test files', () => {
  it.each(REAL_GRAVEYARDS)('%s: the states add up to the files', (name) => {
    const s = computeStats(loadRealGraveyard(name));
    expect(s.fresh + s.stale + s.ancient).toBe(s.files);
  });

  it('oikos_ledger: 129 files in 68 folders, no ghosts, 12 unused and 7 hot', () => {
    expect(computeStats(loadRealGraveyard('demo.oikosledger'))).toMatchObject({
      files: 129, folders: 68, ghosts: 0, unused: 12, hot: 7,
    });
  });

  it('spatialql: 120 files in 3 folders, 2 ghosts, 2 unused and 24 hot', () => {
    expect(computeStats(loadRealGraveyard('demo.spatialql'))).toMatchObject({
      files: 120, folders: 3, ghosts: 2, unused: 2, hot: 24,
    });
  });
});
