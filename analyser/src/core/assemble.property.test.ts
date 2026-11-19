import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateGraveyard } from '../../../shared/graveyard-schema';
import { PATH_POOL, SNAPSHOT_MS, replay, scenarioArb, thresholdsArb } from '../../test/arbitraries';
import type { Thresholds } from '../../../shared/graveyard-schema';
import { MS_PER_DAY } from './decay';
import { DEFAULT_THRESHOLDS } from './thresholds';
import { assembleGraveyard, type AssembleInput } from './assemble';
import { isTrackedSourcePath } from './files';
import { analyseHistory } from './history';
import { toJson } from './serialise';
import { compareCodePoint } from './sort';

/** Deterministic shuffle (Fisher-Yates driven by a small LCG), so a failing case can be replayed from its seed. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Lines of code as a fixed function of the path, so two builds of the same snapshot agree. */
const locOf = (path: string): number => [...path].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 400;

const EXTRA_UNUSED = 'not/in/the/tree.ts'; // Knip can name paths that are not current files

const inputArb = fc.record({
  script: scenarioArb,
  unused: fc.subarray([...PATH_POOL, EXTRA_UNUSED]),
  thresholds: thresholdsArb,
});

function buildInput(
  script: Parameters<typeof replay>[0],
  unusedPaths: readonly string[],
  analysedAt: string,
  thresholds: Thresholds,
): AssembleInput {
  const r = replay(script, SNAPSHOT_MS, thresholds.hotWindowDays);
  const current = new Set([...r.present].filter(isTrackedSourcePath));
  const { perFile, ghosts } = analyseHistory({ commits: r.commits, currentPaths: current, snapshotMs: SNAPSHOT_MS, hotWindowDays: thresholds.hotWindowDays });
  return {
    repoName: 'prop',
    snapshotSha: 'f'.repeat(40),
    snapshotDate: new Date(SNAPSHOT_MS).toISOString(),
    analysedAt,
    thresholds,
    files: [...current].map((path) => ({ path, linesOfCode: locOf(path) })),
    history: perFile,
    unused: new Set(unusedPaths),
    ghosts,
  };
}

/** Same data, every collection in a different order. */
function reordered(input: AssembleInput, seed: number): AssembleInput {
  return {
    ...input,
    files: shuffle(input.files, seed),
    history: new Map(shuffle([...input.history], seed + 1)),
    unused: new Set(shuffle([...input.unused], seed + 2)),
    ghosts: shuffle(input.ghosts, seed + 3),
  };
}

const ANALYSED_AT = '2026-03-02T09:30:00.000Z';

describe('P2: running the analyser twice on the same snapshot gives identical output (pure tier)', () => {
  it('gives the same text for the same input', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const input = buildInput(script, unused, ANALYSED_AT, thresholds);
        return toJson(assembleGraveyard(input)) === toJson(assembleGraveyard(input));
      }),
    );
  });

  it('gives the same text whatever order files, history, Knip results and ghosts arrive in', () => {
    fc.assert(
      fc.property(inputArb, fc.integer(), ({ script, unused, thresholds }, seed) => {
        const input = buildInput(script, unused, ANALYSED_AT, thresholds);
        return toJson(assembleGraveyard(input)) === toJson(assembleGraveyard(reordered(input, seed)));
      }),
    );
  });

  it('gives the same text when the history is rebuilt from scratch', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const first = toJson(assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds)));
        const second = toJson(assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds)));
        return first === second;
      }),
    );
  });

  it('changes only meta.analysedAt when the analysis timestamp changes', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const a = assembleGraveyard(buildInput(script, unused, '2026-03-02T09:30:00.000Z', thresholds));
        const b = assembleGraveyard(buildInput(script, unused, '2031-12-31T23:59:59.999Z', thresholds));
        expect(b.files).toEqual(a.files);
        expect(b.folders).toEqual(a.folders);
        expect(b.ghosts).toEqual(a.ghosts);
        expect({ ...b.meta, analysedAt: '' }).toEqual({ ...a.meta, analysedAt: '' });
        return a.meta.analysedAt !== b.meta.analysedAt;
      }),
    );
  });
});

describe('assembled output for random histories', () => {
  it('always passes the shared schema validator, with empty eulogies', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        expect(validateGraveyard(g)).toEqual({ ok: true });
        return g.files.every((f) => f.eulogy === '');
      }),
    );
  });

  it('flags a file unused exactly when Knip listed it and it is a current file', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        return g.files.every((f) => f.unused === unused.includes(f.path));
      }),
    );
  });

  it('lists files and ghosts sorted and without duplicates', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        const sorted = (paths: string[]) =>
          JSON.stringify(paths) === JSON.stringify([...new Set(paths)].sort(compareCodePoint));
        return sorted(g.files.map((f) => f.path)) && sorted(g.ghosts.map((x) => x.path));
      }),
    );
  });
});

describe('thresholds in the assembled output', () => {
  it('are recorded in the metadata exactly as given', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        return JSON.stringify(g.meta.thresholds) === JSON.stringify(thresholds);
      }),
    );
  });

  it('P7: every file state agrees with its age and meta.thresholds, by a formula written out in the test', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused, thresholds }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        const t = g.meta.thresholds;
        const snapshotMs = Date.parse(g.meta.snapshotDate);
        return g.files.every((f) => {
          const age = Math.max(0, Math.floor((snapshotMs - Date.parse(f.lastCommitDate)) / MS_PER_DAY));
          const expectedState = age < t.staleAfterDays ? 'fresh' : age <= t.ancientAfterDays ? 'stale' : 'ancient';
          const expectedScore =
            Math.round((0.4 * (Math.min(age, t.decayCapDays) / t.decayCapDays) + (f.unused ? 0.6 : 0)) * 10_000) / 10_000;
          return f.decayState === expectedState && f.decayScore === expectedScore && f.hot === f.recentCommits >= t.hotCommits;
        });
      }),
    );
  });

  it('with the default thresholds, match the old fixed rules (90, 360, 720, 5)', () => {
    fc.assert(
      fc.property(scenarioArb, fc.subarray([...PATH_POOL]), (script, unused) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, DEFAULT_THRESHOLDS));
        const snapshotMs = Date.parse(g.meta.snapshotDate);
        return g.files.every((f) => {
          const age = Math.max(0, Math.floor((snapshotMs - Date.parse(f.lastCommitDate)) / MS_PER_DAY));
          return (
            f.decayState === (age < 90 ? 'fresh' : age <= 360 ? 'stale' : 'ancient') &&
            f.decayScore === Math.round((0.4 * (Math.min(age, 720) / 720) + (f.unused ? 0.6 : 0)) * 10_000) / 10_000 &&
            f.hot === f.recentCommits >= 5
          );
        });
      }),
    );
  });

  it('change only the decay fields when only the thresholds change', () => {
    fc.assert(
      fc.property(inputArb, thresholdsArb, ({ script, unused, thresholds }, other) => {
        // The hot window changes the commit counts too, so hold it fixed and vary the rest.
        const second: Thresholds = { ...other, hotWindowDays: thresholds.hotWindowDays };
        const a = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, thresholds));
        const b = assembleGraveyard(buildInput(script, unused, ANALYSED_AT, second));
        const stable = (g: typeof a) =>
          g.files.map(({ decayScore: _s, decayState: _d, hot: _h, ...rest }) => rest);
        return (
          JSON.stringify(stable(a)) === JSON.stringify(stable(b)) &&
          JSON.stringify(a.folders) === JSON.stringify(b.folders) &&
          JSON.stringify(a.ghosts) === JSON.stringify(b.ghosts)
        );
      }),
    );
  });
});
