import fc from 'fast-check';
import {
  SCHEMA_VERSION,
  type DecayState,
  type FileEntry,
  type Graveyard,
  type RepoMeta,
  type Thresholds,
} from '@shared/graveyard-schema';
import { mulberry32 } from '../src/model/prng';
import {
  SYNTHETIC_SHAPES,
  SYNTHETIC_THRESHOLDS,
  makeSyntheticGraveyard,
  type SyntheticOptions,
} from '../src/model/synthetic';

/**
 * Generators shared by the property tests. They are built on `makeSyntheticGraveyard`, the same builder the
 * manual performance check uses (requirement 12.4), so tests and the check describe the same kinds of graveyard.
 */

export const DEFAULT_THRESHOLDS: Thresholds = {
  staleAfterDays: 90,
  ancientAfterDays: 360,
  decayCapDays: 720,
  hotCommits: 5,
  hotWindowDays: 30,
};

/** The numbers of a valid set of thresholds; the decay cap is always twice `ancientAfterDays`. */
export function makeThresholds(staleAfterDays: number, gap: number, hotCommits: number, hotWindowDays: number): Thresholds {
  const ancientAfterDays = staleAfterDays + gap;
  return { staleAfterDays, ancientAfterDays, decayCapDays: 2 * ancientAfterDays, hotCommits, hotWindowDays };
}

/**
 * Valid thresholds: the defaults (90/360), those of the oikos file (21/45) and random ones, so every state turns
 * up and the code never relies on one set of numbers.
 */
export const thresholdsArb: fc.Arbitrary<Thresholds> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(DEFAULT_THRESHOLDS) },
  { weight: 1, arbitrary: fc.constant(SYNTHETIC_THRESHOLDS) },
  {
    weight: 4,
    arbitrary: fc
      .record({
        stale: fc.integer({ min: 1, max: 400 }),
        gap: fc.integer({ min: 1, max: 600 }),
        hotCommits: fc.integer({ min: 1, max: 8 }),
        hotWindow: fc.integer({ min: 1, max: 120 }),
      })
      .map(({ stale, gap, hotCommits, hotWindow }) => makeThresholds(stale, gap, hotCommits, hotWindow)),
  },
);

/** Options for graveyards of every shape: random trees, one crowded folder, chains up to 300 deep, wide trees, mixtures. */
export const syntheticOptionsArb: fc.Arbitrary<SyntheticOptions> = fc.record({
  files: fc.integer({ min: 0, max: 700 }),
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  shape: fc.constantFrom(...SYNTHETIC_SHAPES),
  depth: fc.integer({ min: 1, max: 300 }),
  ghosts: fc.integer({ min: 0, max: 15 }),
  thresholds: thresholdsArb,
});

/** A valid graveyard of any shape. */
export const graveyardArb: fc.Arbitrary<Graveyard> = syntheticOptionsArb.map(makeSyntheticGraveyard);

/** A small graveyard, for tests that are slow per case. */
export const smallGraveyardArb: fc.Arbitrary<Graveyard> = syntheticOptionsArb.map((options) =>
  makeSyntheticGraveyard({ ...options, files: options.files % 41, depth: 1 + ((options.depth ?? 1) % 12) }),
);

/** One crowded folder: 500 to 800 files in `src`, nothing else. */
export const crowdedGraveyardArb: fc.Arbitrary<Graveyard> = fc
  .record({
    files: fc.integer({ min: 500, max: 800 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    ghosts: fc.integer({ min: 0, max: 15 }),
    thresholds: thresholdsArb,
  })
  .map((options) => makeSyntheticGraveyard({ ...options, shape: 'flat' }));

/** A chain of folders, 100 to 300 deep. */
export const deepGraveyardArb: fc.Arbitrary<Graveyard> = fc
  .record({
    files: fc.integer({ min: 0, max: 200 }),
    depth: fc.integer({ min: 100, max: 300 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    ghosts: fc.integer({ min: 0, max: 15 }),
  })
  .map((options) => makeSyntheticGraveyard({ ...options, shape: 'deep' }));

/** The items in a different order. The same seed gives the same order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = mulberry32(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** The same data file with the folders, files and ghosts in another order. */
export function shuffledGraveyard(graveyard: Graveyard, seed: number): Graveyard {
  return {
    meta: graveyard.meta,
    folders: shuffled(graveyard.folders, seed),
    files: shuffled(graveyard.files, seed + 1),
    ghosts: shuffled(graveyard.ghosts, seed + 2),
  };
}

// ---- Single files with a consistent state, score and age, for the visual properties ----

const SNAPSHOT_DATE = '2026-08-18T00:38:17.000Z';
const MS_PER_DAY = 86_400_000;

/** The analyser's rule for the decay state, written out here as the oracle: fresh below stale-after, stale up to and including ancient-after. */
export function decayStateFor(age: number, t: Thresholds): DecayState {
  return age < t.staleAfterDays ? 'fresh' : age <= t.ancientAfterDays ? 'stale' : 'ancient';
}

/** The analyser's rule for the decay score, written out here as the oracle (0.4 for age up to the cap, 0.6 when unused). */
export function decayScoreFor(age: number, unused: boolean, t: Thresholds): number {
  const capped = Math.min(age, t.decayCapDays);
  return Math.round((0.4 * (capped / t.decayCapDays) + (unused ? 0.6 : 0)) * 10_000) / 10_000;
}

/** A file, the metadata it belongs to, and the age it was built from. */
export interface FileCase {
  file: FileEntry;
  meta: RepoMeta;
  age: number;
}

export interface FileCaseOptions {
  path?: string;
  /** Whole days between the last commit and the snapshot. */
  age: number;
  unused: boolean;
  hot: boolean;
  linesOfCode?: number;
  thresholds: Thresholds;
}

/** A file whose state, score and `hot` flag agree with its age and the thresholds, as the analyser would write it. */
export function makeFileCase(options: FileCaseOptions): FileCase {
  const { age, unused, hot, thresholds } = options;
  const meta: RepoMeta = {
    name: 'case',
    snapshotSha: 'a'.repeat(40),
    snapshotDate: SNAPSHOT_DATE,
    analysedAt: '2026-11-19T12:00:00.000Z',
    schemaVersion: SCHEMA_VERSION,
    thresholds,
  };
  const file: FileEntry = {
    path: options.path ?? 'src/example.ts',
    folder: 'src',
    linesOfCode: options.linesOfCode ?? 50,
    lastCommitDate: new Date(Date.parse(SNAPSHOT_DATE) - age * MS_PER_DAY).toISOString(),
    lastCommitAuthor: 'Ann',
    recentCommits: hot ? thresholds.hotCommits : 0,
    unused,
    decayScore: decayScoreFor(age, unused, thresholds),
    decayState: decayStateFor(age, thresholds),
    hot,
    eulogy: '',
  };
  return { file, meta, age };
}

/** An age from just now to one and a half times the decay cap, so every state turns up. `thousandths` is 0 to 1500. */
export function ageFromThousandths(thousandths: number, t: Thresholds): number {
  return Math.floor((t.decayCapDays * thousandths) / 1000);
}

export const filePathArb: fc.Arbitrary<string> = fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.ts$/);

/** A consistent file of any age, under any valid thresholds. */
export const fileCaseArb: fc.Arbitrary<FileCase> = fc
  .record({
    thresholds: thresholdsArb,
    thousandths: fc.integer({ min: 0, max: 1500 }),
    unused: fc.boolean(),
    hot: fc.boolean(),
    path: filePathArb,
    linesOfCode: fc.integer({ min: 0, max: 10_000 }),
  })
  .map(({ thresholds, thousandths, ...rest }) => makeFileCase({ ...rest, thresholds, age: ageFromThousandths(thousandths, thresholds) }));
