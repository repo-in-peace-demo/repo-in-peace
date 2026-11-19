/**
 * One commit from `git log`, reduced to what the analyser needs.
 * Produced by io/git-log-parse.ts, consumed by core/history.ts.
 */

export type Change =
  | { kind: 'add' | 'modify' | 'delete'; path: string }
  | { kind: 'rename'; oldPath: string; path: string };

export interface CommitRecord {
  sha: string;
  /** Parent SHAs in git's order. The first parent is the branch the commit was made on. Empty for a root commit. */
  parents: string[];
  /** Committer date as ISO 8601 UTC, for example 2026-01-03T18:00:00.000Z. */
  date: string;
  /** Author name. */
  author: string;
  /** File changes. Empty for merge commits and empty commits, since plain `git log` shows no diff for merges. */
  changes: Change[];
}
