import {
  SCHEMA_VERSION,
  type FileEntry,
  type Ghost,
  type Graveyard,
  type Thresholds,
} from '../../../shared/graveyard-schema';
import { ageDays, decayScore, decayState, isHot } from './decay';
import { deriveFolders, folderOf } from './folders';
import type { FileHistory, RawGhost } from './history';
import { compareCodePoint } from './sort';

/**
 * Builds the graveyard data object from plain data. Pure: no clock, no git, no files.
 * Every list is sorted by path, so the order the inputs arrive in never shows in the output.
 */

export interface AssembleInput {
  repoName: string;
  snapshotSha: string;
  /** Committer date of the snapshot commit. Any ISO 8601 form; written as UTC. */
  snapshotDate: string;
  /** Any ISO 8601 form; written as UTC. */
  analysedAt: string;
  /** The decay thresholds to score with. Written to `meta.thresholds`. */
  thresholds: Thresholds;
  /** Current files from the snapshot tree, after the path filters. */
  files: ReadonlyArray<{ path: string; linesOfCode: number }>;
  /** From analyseHistory. Must have an entry for every file. */
  history: ReadonlyMap<string, FileHistory>;
  /** Files Knip reports unused. Paths that are not current files are ignored. */
  unused: ReadonlySet<string>;
  ghosts: readonly RawGhost[];
}

export class AssembleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssembleError';
  }
}

export function assembleGraveyard(input: AssembleInput): Graveyard {
  const snapshotMs = parseDate(input.snapshotDate, 'snapshotDate');
  const analysedMs = parseDate(input.analysedAt, 'analysedAt');

  const files: FileEntry[] = input.files
    .map((file): FileEntry => {
      const history = input.history.get(file.path);
      if (history === undefined) {
        throw new AssembleError(`no history for current file "${file.path}"`);
      }
      const unused = input.unused.has(file.path);
      const age = ageDays(parseDate(history.lastCommitDate, `lastCommitDate of ${file.path}`), snapshotMs);
      return {
        path: file.path,
        folder: folderOf(file.path),
        linesOfCode: file.linesOfCode,
        lastCommitDate: history.lastCommitDate,
        lastCommitAuthor: history.lastCommitAuthor,
        recentCommits: history.recentCommits,
        unused,
        decayScore: decayScore(age, unused, input.thresholds),
        decayState: decayState(age, input.thresholds),
        hot: isHot(history.recentCommits, input.thresholds),
        eulogy: '',
      };
    })
    .sort((a, b) => compareCodePoint(a.path, b.path));

  const ghosts: Ghost[] = input.ghosts
    .map((ghost): Ghost => ({
      path: ghost.path,
      deletedInSha: ghost.deletedInSha,
      deletedDate: ghost.deletedDate,
      deletedBy: ghost.deletedBy,
      lastExistingSha: ghost.lastExistingSha,
    }))
    .sort((a, b) => compareCodePoint(a.path, b.path));

  return {
    meta: {
      name: input.repoName,
      snapshotSha: input.snapshotSha,
      snapshotDate: new Date(snapshotMs).toISOString(),
      analysedAt: new Date(analysedMs).toISOString(),
      schemaVersion: SCHEMA_VERSION,
      thresholds: { ...input.thresholds },
    },
    folders: deriveFolders(files.map((f) => f.path)),
    files,
    ghosts,
  };
}

function parseDate(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new AssembleError(`${label} is not a valid date: "${value}"`);
  return ms;
}
