import fc from 'fast-check';
import type { Change, CommitRecord } from '../src/core/commit-record';
import { HOT_WINDOW_DAYS, MS_PER_DAY } from '../src/core/decay';

/**
 * Random repository histories for property tests, and an independent model of them.
 *
 * A scenario is a list of scripted commits, oldest first. `replay` applies them
 * forward to a model repository (path -> file identity) and produces:
 *   - the CommitRecords a parsed `git log` would give (newest first),
 *   - the oracle answers (which paths exist, last removals, per-file history),
 * computed by a forward pass that shares no logic with core/history.ts, which walks backward.
 *
 * Commit dates are random and unrelated to commit order, so tests also cover the
 * out-of-order dates that merged branches produce.
 */

export const SNAPSHOT_MS = Date.parse('2026-03-01T12:00:00.000Z');

/** Includes paths the graveyard filters out, so tests exercise the filter too. */
export const PATH_POOL = [
  'index.ts',
  'src/a.ts',
  'src/b.ts',
  'src/lib/c.js',
  'lib/d.tsx',
  'e.mjs',
  'dist/x.js', // excluded directory
  'README.md', // not a source file
  'types.d.ts', // declaration file
] as const;

const AUTHORS = ['Ann', 'Bob', 'Cy'] as const;

export type IntentKind = 'add' | 'modify' | 'delete' | 'rename';

/** What a scripted commit tries to do. Intents that do not fit the current state are skipped. */
export interface Intent {
  kind: IntentKind;
  /** Index into PATH_POOL: the path acted on, or the rename source. */
  from: number;
  /** Index into PATH_POOL: the rename target. Ignored by other kinds. */
  to: number;
}

export interface ScriptCommit {
  /** Commit date in ms since the epoch. */
  date: number;
  author: string;
  intents: Intent[];
}

const intentArb: fc.Arbitrary<Intent> = fc.record({
  kind: fc.constantFrom<IntentKind>('add', 'add', 'modify', 'delete', 'rename'),
  from: fc.nat(PATH_POOL.length - 1),
  to: fc.nat(PATH_POOL.length - 1),
});

const scriptCommitArb: fc.Arbitrary<ScriptCommit> = fc.record({
  date: fc.integer({ min: SNAPSHOT_MS - 400 * MS_PER_DAY, max: SNAPSHOT_MS + 5 * MS_PER_DAY }),
  author: fc.constantFrom(...AUTHORS),
  intents: fc.array(intentArb, { minLength: 1, maxLength: 4 }),
});

/** A random history of 1 to 18 commits. */
export const scenarioArb: fc.Arbitrary<ScriptCommit[]> = fc.array(scriptCommitArb, {
  minLength: 1,
  maxLength: 18,
});

export interface Removal {
  kind: 'delete' | 'rename';
  /** Index of the commit, oldest first. */
  index: number;
}

export interface ExpectedFileHistory {
  lastCommitDate: string;
  lastCommitAuthor: string;
  commitsLast30Days: number;
}

export interface Replayed {
  /** Newest first, as parsed from git log. History is a straight line: each commit's parent is the one before it. */
  commits: CommitRecord[];
  /** Commit SHAs, oldest first. */
  shaOf: string[];
  /** Paths present after each commit, oldest-first index. */
  presentAfter: Array<Set<string>>;
  /** Paths present at the end, before any path filter. */
  present: Set<string>;
  /** The most recent removal of each path that was ever removed. */
  lastRemoval: Map<string, Removal>;
  /** For each path present at the end, what its history should be (renames followed). */
  expectedHistory: Map<string, ExpectedFileHistory>;
}

export const shaFor = (index: number): string => (index + 1).toString(16).padStart(40, '0');

export function replay(script: readonly ScriptCommit[]): Replayed {
  const identityAt = new Map<string, number>(); // path -> identity of the file living there
  const touches = new Map<number, number[]>(); // identity -> indexes of commits that touched it
  const lastRemoval = new Map<string, Removal>();
  const presentAfter: Array<Set<string>> = [];
  const shaOf: string[] = [];
  const records: CommitRecord[] = [];
  let nextIdentity = 0;

  const touch = (identity: number, index: number): void => {
    const list = touches.get(identity);
    if (list === undefined) touches.set(identity, [index]);
    else list.push(index);
  };

  script.forEach((scripted, index) => {
    const usedInCommit = new Set<string>(); // at most one change per path per commit
    const changes: Change[] = [];

    for (const intent of scripted.intents) {
      const from = PATH_POOL[intent.from]!;
      const to = PATH_POOL[intent.to]!;
      const identity = identityAt.get(from);

      switch (intent.kind) {
        case 'add':
          if (identity === undefined && !usedInCommit.has(from)) {
            identityAt.set(from, nextIdentity);
            touch(nextIdentity++, index);
            changes.push({ kind: 'add', path: from });
            usedInCommit.add(from);
          }
          break;
        case 'modify':
          if (identity !== undefined && !usedInCommit.has(from)) {
            touch(identity, index);
            changes.push({ kind: 'modify', path: from });
            usedInCommit.add(from);
          }
          break;
        case 'delete':
          if (identity !== undefined && !usedInCommit.has(from)) {
            identityAt.delete(from);
            lastRemoval.set(from, { kind: 'delete', index });
            changes.push({ kind: 'delete', path: from });
            usedInCommit.add(from);
          }
          break;
        case 'rename':
          if (
            identity !== undefined &&
            from !== to &&
            !identityAt.has(to) &&
            !usedInCommit.has(from) &&
            !usedInCommit.has(to)
          ) {
            identityAt.delete(from);
            identityAt.set(to, identity);
            touch(identity, index);
            lastRemoval.set(from, { kind: 'rename', index });
            changes.push({ kind: 'rename', oldPath: from, path: to });
            usedInCommit.add(from);
            usedInCommit.add(to);
          }
          break;
      }
    }

    const sha = shaFor(index);
    shaOf.push(sha);
    presentAfter.push(new Set(identityAt.keys()));
    records.push({
      sha,
      parents: index === 0 ? [] : [shaFor(index - 1)],
      date: new Date(scripted.date).toISOString(),
      author: scripted.author,
      changes,
    });
  });

  const windowStart = SNAPSHOT_MS - HOT_WINDOW_DAYS * MS_PER_DAY;
  const expectedHistory = new Map<string, ExpectedFileHistory>();
  for (const [path, identity] of identityAt) {
    const indexes = touches.get(identity) ?? [];
    // Oldest to newest, replacing on >=: among equal latest dates the newest commit wins,
    // which is the commit listed first in a newest-first log.
    let best = indexes[0]!;
    for (const i of indexes) if (script[i]!.date >= script[best]!.date) best = i;
    expectedHistory.set(path, {
      lastCommitDate: new Date(script[best]!.date).toISOString(),
      lastCommitAuthor: script[best]!.author,
      commitsLast30Days: indexes.filter((i) => {
        const date = script[i]!.date;
        return date > windowStart && date <= SNAPSHOT_MS;
      }).length,
    });
  }

  return {
    commits: records.reverse(),
    shaOf,
    presentAfter,
    present: new Set(identityAt.keys()),
    lastRemoval,
    expectedHistory,
  };
}
