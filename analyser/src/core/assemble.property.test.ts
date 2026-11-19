import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateGraveyard } from '../../../shared/graveyard-schema';
import { PATH_POOL, SNAPSHOT_MS, replay, scenarioArb } from '../../test/arbitraries';
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
});

function buildInput(
  script: Parameters<typeof replay>[0],
  unusedPaths: readonly string[],
  analysedAt: string,
): AssembleInput {
  const r = replay(script);
  const current = new Set([...r.present].filter(isTrackedSourcePath));
  const { perFile, ghosts } = analyseHistory({ commits: r.commits, currentPaths: current, snapshotMs: SNAPSHOT_MS });
  return {
    repoName: 'prop',
    snapshotSha: 'f'.repeat(40),
    snapshotDate: new Date(SNAPSHOT_MS).toISOString(),
    analysedAt,
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
      fc.property(inputArb, ({ script, unused }) => {
        const input = buildInput(script, unused, ANALYSED_AT);
        return toJson(assembleGraveyard(input)) === toJson(assembleGraveyard(input));
      }),
    );
  });

  it('gives the same text whatever order files, history, Knip results and ghosts arrive in', () => {
    fc.assert(
      fc.property(inputArb, fc.integer(), ({ script, unused }, seed) => {
        const input = buildInput(script, unused, ANALYSED_AT);
        return toJson(assembleGraveyard(input)) === toJson(assembleGraveyard(reordered(input, seed)));
      }),
    );
  });

  it('gives the same text when the history is rebuilt from scratch', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused }) => {
        const first = toJson(assembleGraveyard(buildInput(script, unused, ANALYSED_AT)));
        const second = toJson(assembleGraveyard(buildInput(script, unused, ANALYSED_AT)));
        return first === second;
      }),
    );
  });

  it('changes only meta.analysedAt when the analysis timestamp changes', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused }) => {
        const a = assembleGraveyard(buildInput(script, unused, '2026-03-02T09:30:00.000Z'));
        const b = assembleGraveyard(buildInput(script, unused, '2031-12-31T23:59:59.999Z'));
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
      fc.property(inputArb, ({ script, unused }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT));
        expect(validateGraveyard(g)).toEqual({ ok: true });
        return g.files.every((f) => f.eulogy === '');
      }),
    );
  });

  it('flags a file unused exactly when Knip listed it and it is a current file', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT));
        return g.files.every((f) => f.unused === unused.includes(f.path));
      }),
    );
  });

  it('lists files and ghosts sorted and without duplicates', () => {
    fc.assert(
      fc.property(inputArb, ({ script, unused }) => {
        const g = assembleGraveyard(buildInput(script, unused, ANALYSED_AT));
        const sorted = (paths: string[]) =>
          JSON.stringify(paths) === JSON.stringify([...new Set(paths)].sort(compareCodePoint));
        return sorted(g.files.map((f) => f.path)) && sorted(g.ghosts.map((x) => x.path));
      }),
    );
  });
});
