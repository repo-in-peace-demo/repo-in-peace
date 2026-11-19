import {
  SCHEMA_VERSION,
  type DecayState,
  type FileEntry,
  type Folder,
  type Ghost,
  type Graveyard,
  type Thresholds,
} from '@shared/graveyard-schema';
import { intBetween, mulberry32, pick } from './prng';
import { compareCodePoint } from './sort';

/**
 * A made-up graveyard of any size, for the property tests and for the manual performance check
 * (`?synthetic=<n>` in development builds). The same options always give the same file, because the only
 * random source is a generator started from the `seed`. The result passes `validateGraveyard`.
 *
 * It is not the analyser: it draws ages, sizes and flags at random and works out the decay state and score with
 * a copy of the analyser's rules, so the file is consistent with its own thresholds.
 */

export type SyntheticShape = 'tree' | 'flat' | 'deep' | 'wide' | 'mixed';

export const SYNTHETIC_SHAPES: readonly SyntheticShape[] = ['tree', 'flat', 'deep', 'wide', 'mixed'];

/** The thresholds of the oikos_ledger test file, used when none are given. */
export const SYNTHETIC_THRESHOLDS: Thresholds = {
  staleAfterDays: 21,
  ancientAfterDays: 45,
  decayCapDays: 90,
  hotCommits: 5,
  hotWindowDays: 30,
};

export interface SyntheticOptions {
  /** Number of current files. */
  files: number;
  seed: number;
  /**
   * `tree`: random nesting with files anywhere. `flat`: every file in one folder, `src`. `deep`: a chain of
   * folders. `wide`: many sibling folders. `mixed`: a tree, a crowded folder and a chain together.
   * Default `tree`.
   */
  shape?: SyntheticShape;
  /** Length of the chain for `deep` (default: the number of files, at most 300). */
  depth?: number;
  /** Number of ghosts (default: 2% of the files). */
  ghosts?: number;
  thresholds?: Thresholds;
}

const SNAPSHOT_DATE = '2026-08-18T00:38:17.000Z';
const SNAPSHOT_MS = Date.parse(SNAPSHOT_DATE);
const MS_PER_DAY = 86_400_000;

const FOLDER_NAMES = ['alpha', 'beta', 'gamma', 'delta', 'lib', 'core', 'utils', 'ui', 'é-dir', 'sp ace'] as const;
const FILE_STEMS = ['index', 'util', 'model', 'view', 'chart', 'route', 'types', 'helpers'] as const;
const AUTHORS = ['Ann', 'Bob', 'Cy', 'Di'] as const;

/** A folder and every ancestor of it, ending at the root. */
function withAncestors(path: string): string[] {
  const result: string[] = [];
  for (let current = path; ; current = current.slice(0, current.lastIndexOf('/'))) {
    result.push(current);
    if (!current.includes('/')) break;
  }
  result.push('');
  return result;
}

function join(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

/** Which folders exist and how many files each holds. */
function buildFolders(options: SyntheticOptions, next: () => number): Map<string, number> {
  const n = options.files;
  const counts = new Map<string, number>([['', 0]]);
  const addFolder = (path: string): void => {
    for (const ancestor of withAncestors(path)) if (!counts.has(ancestor)) counts.set(ancestor, 0);
  };
  const addFiles = (path: string, count: number): void => {
    addFolder(path);
    counts.set(path, (counts.get(path) ?? 0) + count);
  };

  const buildTree = (files: number, prefix: string): void => {
    const folderCount = Math.min(400, Math.max(1, Math.round(files / 5)));
    const paths: string[] = [prefix];
    addFolder(prefix);
    for (let i = 0; i < folderCount; i++) {
      const parent = pick(next, paths);
      const path = join(parent, `${pick(next, FOLDER_NAMES)}${i}`);
      addFolder(path);
      paths.push(path);
    }
    for (let i = 0; i < files; i++) addFiles(pick(next, paths), 1);
  };

  const buildChain = (files: number, depth: number, prefix: string): void => {
    let path = prefix;
    const levels: string[] = [];
    for (let level = 0; level < depth; level++) {
      path = join(path, `level${level}`);
      levels.push(path);
      addFolder(path);
    }
    if (levels.length === 0) {
      addFiles(prefix, files);
      return;
    }
    // One file per level first, the rest at the deepest level.
    const perLevel = Math.floor(files / levels.length);
    const extra = files - perLevel * levels.length;
    levels.forEach((level, i) => addFiles(level, perLevel + (i === levels.length - 1 ? extra : 0)));
  };

  switch (options.shape ?? 'tree') {
    case 'flat':
      addFiles('src', n);
      break;
    case 'deep':
      buildChain(n, Math.max(1, Math.min(400, options.depth ?? Math.min(n, 300))), '');
      break;
    case 'wide': {
      const siblings = Math.max(1, Math.ceil(Math.sqrt(n)));
      addFolder('src');
      for (let i = 0; i < siblings; i++) addFolder(`src/pkg${i}`);
      for (let i = 0; i < n; i++) addFiles(`src/pkg${i % siblings}`, 1);
      break;
    }
    case 'mixed': {
      const crowded = Math.floor(n * 0.4);
      const chained = Math.floor(n * 0.2);
      addFiles('crowded', crowded);
      buildChain(chained, 15, 'chain');
      buildTree(n - crowded - chained, 'tree');
      break;
    }
    case 'tree':
    default:
      buildTree(n, '');
      break;
  }
  return counts;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function makeSyntheticGraveyard(options: SyntheticOptions): Graveyard {
  const next = mulberry32(options.seed);
  const thresholds = options.thresholds ?? SYNTHETIC_THRESHOLDS;
  const counts = buildFolders(options, next);

  const folderPaths = [...counts.keys()].sort(compareCodePoint);
  const folders: Folder[] = folderPaths.map((path) => ({
    path,
    parent: path === '' ? null : path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
  }));

  const files: FileEntry[] = [];
  for (const folder of folderPaths) {
    for (let i = 0; i < (counts.get(folder) ?? 0); i++) {
      const age = intBetween(next, 0, Math.floor(thresholds.decayCapDays * 1.4));
      const unused = next() < 0.1;
      const state: DecayState =
        age < thresholds.staleAfterDays ? 'fresh' : age <= thresholds.ancientAfterDays ? 'stale' : 'ancient';
      const hot = next() < 0.08;
      const recentCommits = hot ? thresholds.hotCommits + intBetween(next, 0, 5) : intBetween(next, 0, thresholds.hotCommits - 1);
      const lines = next();
      const linesOfCode =
        lines < 0.03
          ? pick(next, [0, 1])
          : lines < 0.63
            ? intBetween(next, 2, 120)
            : lines < 0.93
              ? intBetween(next, 121, 1500)
              : intBetween(next, 1501, 8000);

      files.push({
        path: join(folder, `${pick(next, FILE_STEMS)}-${i}.ts`),
        folder,
        linesOfCode,
        // Subtracting less than a day keeps the whole-day age equal to `age`.
        lastCommitDate: new Date(SNAPSHOT_MS - age * MS_PER_DAY - intBetween(next, 0, MS_PER_DAY - 1)).toISOString(),
        lastCommitAuthor: pick(next, AUTHORS),
        recentCommits,
        unused,
        decayScore: round4(
          0.4 * (Math.min(age, thresholds.decayCapDays) / thresholds.decayCapDays) + (unused ? 0.6 : 0),
        ),
        decayState: state,
        hot: recentCommits >= thresholds.hotCommits,
        eulogy: '',
      });
    }
  }

  const ghostCount = options.ghosts ?? Math.floor(options.files * 0.02);
  const ghosts: Ghost[] = [];
  for (let j = 0; j < ghostCount; j++) {
    const base = pick(next, folderPaths);
    const mode = intBetween(next, 0, 2);
    // 0: in a folder that still exists. 1: in a folder that was deleted. 2: in a deleted folder inside a deleted folder.
    const folder = mode === 0 ? base : mode === 1 ? join(base, `gone${j}`) : join(base, `gone${j}/old/deeper`);
    ghosts.push({
      path: join(folder, `removed-${j}.ts`),
      deletedInSha: 'd'.repeat(40),
      deletedDate: new Date(SNAPSHOT_MS - intBetween(next, 1, 60) * MS_PER_DAY).toISOString(),
      deletedBy: pick(next, AUTHORS),
      lastExistingSha: 'e'.repeat(40),
    });
  }

  return {
    meta: {
      name: 'synthetic',
      snapshotSha: 'f'.repeat(40),
      snapshotDate: SNAPSHOT_DATE,
      analysedAt: '2026-11-19T12:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
      thresholds,
    },
    folders,
    files,
    ghosts,
  };
}
