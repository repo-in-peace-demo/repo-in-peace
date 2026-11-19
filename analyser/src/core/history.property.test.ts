import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_MS, replay, scenarioArb, thresholdsArb } from '../../test/arbitraries';
import { isTrackedSourcePath } from './files';
import { analyseHistory } from './history';

/** The files the real pipeline would pass in: paths present at the end that the graveyard shows. */
const currentOf = (present: Set<string>): Set<string> =>
  new Set([...present].filter(isTrackedSourcePath));

describe('P3: no ghost path also appears among the current files', () => {
  it('holds for random histories, including re-adds, renames and out-of-order dates', () => {
    fc.assert(
      fc.property(scenarioArb, thresholdsArb, (script, t) => {
        const r = replay(script, SNAPSHOT_MS, t.hotWindowDays);
        const currentPaths = currentOf(r.present);
        const { ghosts } = analyseHistory({ commits: r.commits, currentPaths, snapshotMs: SNAPSHOT_MS, hotWindowDays: t.hotWindowDays });

        const ghostPaths = ghosts.map((g) => g.path);
        return (
          ghostPaths.every((p) => !currentPaths.has(p)) &&
          new Set(ghostPaths).size === ghostPaths.length &&
          ghostPaths.every(isTrackedSourcePath)
        );
      }),
    );
  });
});

describe('ghosts match an independent forward replay', () => {
  it('finds exactly the paths whose most recent removal is a deletion, and the right commits', () => {
    fc.assert(
      fc.property(scenarioArb, thresholdsArb, (script, t) => {
        const r = replay(script, SNAPSHOT_MS, t.hotWindowDays);
        const currentPaths = currentOf(r.present);
        const { ghosts } = analyseHistory({ commits: r.commits, currentPaths, snapshotMs: SNAPSHOT_MS, hotWindowDays: t.hotWindowDays });

        const expected = [...r.lastRemoval]
          .filter(([path, removal]) => removal.kind === 'delete' && !currentPaths.has(path) && isTrackedSourcePath(path))
          .map(([path]) => path)
          .sort();
        expect(ghosts.map((g) => g.path).sort()).toEqual(expected);

        for (const ghost of ghosts) {
          const removal = r.lastRemoval.get(ghost.path)!;
          expect(ghost.deletedInSha).toBe(r.shaOf[removal.index]);
          expect(ghost.deletedBy).toBe(script[removal.index]!.author);
          expect(ghost.deletedDate).toBe(new Date(script[removal.index]!.date).toISOString());
          // The last existing commit is the one before the deletion, and the file is in it.
          expect(ghost.lastExistingSha).toBe(r.shaOf[removal.index - 1]);
          expect(r.presentAfter[removal.index - 1]!.has(ghost.path)).toBe(true);
          // And the deleting commit itself no longer has it.
          expect(r.presentAfter[removal.index]!.has(ghost.path)).toBe(false);
        }
        return true;
      }),
    );
  });
});

describe('per-file history matches an independent forward replay', () => {
  it('gives the right last commit and 30-day count for every current file, through renames', () => {
    fc.assert(
      fc.property(scenarioArb, thresholdsArb, (script, t) => {
        const r = replay(script, SNAPSHOT_MS, t.hotWindowDays);
        const currentPaths = currentOf(r.present);
        const { perFile } = analyseHistory({ commits: r.commits, currentPaths, snapshotMs: SNAPSHOT_MS, hotWindowDays: t.hotWindowDays });

        expect([...perFile.keys()].sort()).toEqual([...currentPaths].sort());
        for (const path of currentPaths) {
          expect(perFile.get(path)).toEqual(r.expectedHistory.get(path));
        }
        return true;
      }),
    );
  });

  it('gives the same answer for the same input every time', () => {
    fc.assert(
      fc.property(scenarioArb, thresholdsArb, (script, t) => {
        const r = replay(script, SNAPSHOT_MS, t.hotWindowDays);
        const input = { commits: r.commits, currentPaths: currentOf(r.present), snapshotMs: SNAPSHOT_MS, hotWindowDays: t.hotWindowDays };
        const first = analyseHistory(input);
        const second = analyseHistory(input);
        expect(JSON.stringify([...second.perFile])).toBe(JSON.stringify([...first.perFile]));
        expect(second.ghosts).toEqual(first.ghosts);
        return true;
      }),
    );
  });
});

describe('the generator covers the interesting cases', () => {
  it('produces histories with ghosts, with renames, and with filtered paths', () => {
    const counts = { ghost: 0, rename: 0, filtered: 0, runs: 0 };
    fc.assert(
      fc.property(scenarioArb, thresholdsArb, (script, t) => {
        const r = replay(script, SNAPSHOT_MS, t.hotWindowDays);
        const current = currentOf(r.present);
        counts.runs++;
        const removals = [...r.lastRemoval];
        if (removals.some(([p, x]) => x.kind === 'delete' && !current.has(p) && isTrackedSourcePath(p))) {
          counts.ghost++;
        }
        if (removals.some(([, x]) => x.kind === 'rename')) counts.rename++;
        if (removals.some(([p]) => !isTrackedSourcePath(p))) counts.filtered++;
        return true;
      }),
      { numRuns: 300 },
    );
    // If the generator stopped producing these cases, the properties above would pass for the wrong reason.
    expect(counts.ghost).toBeGreaterThan(counts.runs * 0.1);
    expect(counts.rename).toBeGreaterThan(counts.runs * 0.05);
    expect(counts.filtered).toBeGreaterThan(0);
  });
});
