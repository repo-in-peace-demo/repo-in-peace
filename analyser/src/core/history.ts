import type { CommitRecord } from './commit-record';
import { MS_PER_DAY } from './decay';
import { isTrackedSourcePath } from './files';

/**
 * Per-file history and ghosts from the parsed git log. Pure.
 *
 * Which paths are current is decided by the caller from the snapshot tree
 * (`currentPaths`), never by replaying history. History only supplies dates,
 * authors, counts, and each ghost's deleting commit.
 */

export interface HistoryInput {
  /** Newest first, in the order `git log --topo-order` printed them. */
  commits: readonly CommitRecord[];
  /** Tracked source files in the snapshot tree, after the path filters. */
  currentPaths: ReadonlySet<string>;
  snapshotMs: number;
  /** Length of the hot window: commits count when dated after `snapshotMs` minus this many days. */
  hotWindowDays: number;
}

export interface FileHistory {
  lastCommitDate: string;
  lastCommitAuthor: string;
  recentCommits: number;
}

export interface RawGhost {
  path: string;
  deletedInSha: string;
  deletedDate: string;
  deletedBy: string;
  /** First parent of the deleting commit. */
  lastExistingSha: string;
}

export interface HistoryResult {
  perFile: Map<string, FileHistory>;
  /** In discovery order. The caller sorts. */
  ghosts: RawGhost[];
}

export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryError';
  }
}

interface Accumulator {
  lastMs: number;
  lastDate: string;
  lastAuthor: string;
  count: number;
}

export function analyseHistory(input: HistoryInput): HistoryResult {
  const { commits, currentPaths, snapshotMs, hotWindowDays } = input;
  const windowStartMs = snapshotMs - hotWindowDays * MS_PER_DAY;

  // Walking from newest to oldest, `tracked` maps a path name as it was just after
  // the commit being read to the current file it belongs to. Renames move the key
  // back to the old name, so earlier history stays attached to the same file.
  const tracked = new Map<string, string>();
  for (const path of currentPaths) tracked.set(path, path);

  const accumulators = new Map<string, Accumulator>();
  const decidedPaths = new Set<string>();
  const ghosts: RawGhost[] = [];

  for (const commit of commits) {
    const commitMs = Date.parse(commit.date);
    const inWindow = commitMs > windowStartMs && commitMs <= snapshotMs;

    const touchedFiles = new Set<string>();
    const trackersToDrop: string[] = [];
    const trackersToAdd: Array<[path: string, file: string]> = [];

    // Pass 1: read every change against the state after this commit.
    for (const change of commit.changes) {
      if (change.kind === 'delete') {
        decideRemoval(change.path, 'delete', commit);
        continue;
      }

      const file = tracked.get(change.path);
      if (file !== undefined) {
        touchedFiles.add(file);
        if (change.kind === 'add' || change.kind === 'rename') trackersToDrop.push(change.path);
        if (change.kind === 'rename') trackersToAdd.push([change.oldPath, file]);
      }
      if (change.kind === 'rename') decideRemoval(change.oldPath, 'rename', commit);
    }

    // Pass 2: undo this commit's effect on the names, removals first.
    for (const path of trackersToDrop) tracked.delete(path);
    for (const [path, file] of trackersToAdd) tracked.set(path, file);

    for (const file of touchedFiles) {
      let entry = accumulators.get(file);
      if (entry === undefined) {
        entry = { lastMs: Number.NEGATIVE_INFINITY, lastDate: '', lastAuthor: '', count: 0 };
        accumulators.set(file, entry);
      }
      // Latest date wins. On a tie the commit listed first wins, because this only replaces on greater.
      if (commitMs > entry.lastMs) {
        entry.lastMs = commitMs;
        entry.lastDate = commit.date;
        entry.lastAuthor = commit.author;
      }
      if (inWindow) entry.count++;
    }
  }

  /**
   * The most recent event that removed a path decides its fate: a deletion makes a
   * ghost, a rename away does not (the file lives on under a new name). Paths that
   * are current, or that the graveyard would not show alive, are never ghosts.
   */
  function decideRemoval(path: string, kind: 'delete' | 'rename', commit: CommitRecord): void {
    if (currentPaths.has(path) || decidedPaths.has(path) || !isTrackedSourcePath(path)) return;
    decidedPaths.add(path);
    if (kind === 'rename') return;

    const lastExistingSha = commit.parents[0];
    if (lastExistingSha === undefined) {
      throw new HistoryError(`commit ${commit.sha} deletes "${path}" but has no parent commit`);
    }
    ghosts.push({
      path,
      deletedInSha: commit.sha,
      deletedDate: commit.date,
      deletedBy: commit.author,
      lastExistingSha,
    });
  }

  const perFile = new Map<string, FileHistory>();
  for (const path of currentPaths) {
    const entry = accumulators.get(path);
    if (entry === undefined) {
      throw new HistoryError(
        `"${path}" is in the snapshot tree but no commit in the git log changed it. ` +
          'This can happen when a file only arrived through a merge commit.',
      );
    }
    perFile.set(path, {
      lastCommitDate: entry.lastDate,
      lastCommitAuthor: entry.lastAuthor,
      recentCommits: entry.count,
    });
  }

  return { perFile, ghosts };
}
