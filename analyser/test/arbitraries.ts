import { createHash } from 'node:crypto';
import fc from 'fast-check';
import type { Change, CommitRecord } from '../src/core/commit-record';
import type { Thresholds } from '../../shared/graveyard-schema';
import { MS_PER_DAY } from '../src/core/decay';
import { DEFAULT_THRESHOLDS, thresholdsFrom } from '../src/core/thresholds';
import type { Op, Step } from './make-repo';

/**
 * Random repository histories for property tests, and an independent model of them.
 *
 * A scenario is a list of scripted commits, oldest first. `replay` applies them
 * forward to a model repository (path -> file identity) and produces:
 *   - the CommitRecords a parsed `git log` would give (newest first),
 *   - the oracle answers (which paths exist, last removals, per-file history),
 *   - the file operations and file contents, so the same history can be built as a real git repo.
 * It is a forward pass that shares no logic with core/history.ts, which walks backward.
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

/** Like scenarioArb, with every date on a whole second, which is all git stores. */
export const wholeSecondScenarioArb: fc.Arbitrary<ScriptCommit[]> = scenarioArb.map((script) =>
  script.map((commit) => ({ ...commit, date: Math.floor(commit.date / 1000) * 1000 })),
);

/**
 * Random valid thresholds, about one time in five the defaults. The ranges straddle the ages
 * that the generated histories produce (up to about 405 days), so every state turns up.
 */
export const thresholdsArb: fc.Arbitrary<Thresholds> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(DEFAULT_THRESHOLDS) },
  {
    weight: 4,
    arbitrary: fc
      .record({
        stale: fc.integer({ min: 1, max: 400 }),
        gap: fc.integer({ min: 1, max: 600 }),
        hotCommits: fc.integer({ min: 1, max: 8 }),
        hotWindow: fc.integer({ min: 1, max: 120 }),
      })
      .map(({ stale, gap, hotCommits, hotWindow }) =>
        thresholdsFrom({
          staleAfterDays: stale,
          ancientAfterDays: stale + gap,
          hotCommits,
          hotWindowDays: hotWindow,
        }),
      ),
  },
);

/** Valid thresholds over a much wider range, for the pure decay functions, which take any age. */
export const wideThresholdsArb: fc.Arbitrary<Thresholds> = fc
  .record({
    stale: fc.integer({ min: 1, max: 5000 }),
    gap: fc.integer({ min: 1, max: 5000 }),
    hotCommits: fc.integer({ min: 1, max: 100 }),
    hotWindow: fc.integer({ min: 1, max: 3650 }),
  })
  .map(({ stale, gap, hotCommits, hotWindow }) =>
    thresholdsFrom({ staleAfterDays: stale, ancientAfterDays: stale + gap, hotCommits, hotWindowDays: hotWindow }),
  );

export interface Removal {
  kind: 'delete' | 'rename';
  /** Index of the commit, oldest first. */
  index: number;
}

export interface ExpectedFileHistory {
  lastCommitDate: string;
  lastCommitAuthor: string;
  recentCommits: number;
  lastCommitSubject: string;
}

export interface Replayed {
  /** Newest first, as parsed from git log. History is a straight line: each commit's parent is the one before it. */
  commits: CommitRecord[];
  /** Commit SHAs, oldest first. */
  shaOf: string[];
  /** Paths present after each commit, oldest-first index. */
  presentAfter: Array<Set<string>>;
  /** Paths and their file contents after each commit, oldest-first index. */
  contentAfter: Array<Map<string, string>>;
  /** The file operations of each commit, oldest-first index, ready to build a real repository. */
  ops: Op[][];
  /** Paths present at the end, before any path filter. */
  present: Set<string>;
  /** The most recent removal of each path that was ever removed. */
  lastRemoval: Map<string, Removal>;
  /** For each path present at the end, what its history should be (renames followed). */
  expectedHistory: Map<string, ExpectedFileHistory>;
}

export const shaFor = (index: number): string => (index + 1).toString(16).padStart(40, '0');

/**
 * What a file contains, from its identity and edit count. Different identities share no text,
 * so git never mistakes a delete plus an add for a rename; edits of one identity only add lines.
 */
export function contentFor(identity: number, version: number): string {
  const line = (label: string): string => `// ${createHash('sha256').update(label).digest('hex')}\n`;
  let text = '';
  for (let i = 0; i < 6; i++) text += line(`base:${identity}:${i}`);
  for (let v = 1; v <= version; v++) text += line(`edit:${identity}:${v}`);
  return text;
}

/**
 * @param snapshotMs the snapshot date, which sets the end of the window of the expected counts.
 * @param hotWindowDays the length of that window.
 */
export function replay(
  script: readonly ScriptCommit[],
  snapshotMs: number = SNAPSHOT_MS,
  hotWindowDays: number = DEFAULT_THRESHOLDS.hotWindowDays,
): Replayed {
  const identityAt = new Map<string, number>(); // path -> identity of the file living there
  const versionOf = new Map<number, number>(); // identity -> number of edits so far
  const touches = new Map<number, number[]>(); // identity -> indexes of commits that touched it
  const lastRemoval = new Map<string, Removal>();
  const presentAfter: Array<Set<string>> = [];
  const contentAfter: Array<Map<string, string>> = [];
  const opsPerCommit: Op[][] = [];
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
    const ops: Op[] = [];

    for (const intent of scripted.intents) {
      const from = PATH_POOL[intent.from]!;
      const to = PATH_POOL[intent.to]!;
      const identity = identityAt.get(from);

      switch (intent.kind) {
        case 'add':
          if (identity === undefined && !usedInCommit.has(from)) {
            const id = nextIdentity++;
            identityAt.set(from, id);
            versionOf.set(id, 0);
            touch(id, index);
            changes.push({ kind: 'add', path: from });
            ops.push({ op: 'write', path: from, content: contentFor(id, 0) });
            usedInCommit.add(from);
          }
          break;
        case 'modify':
          if (identity !== undefined && !usedInCommit.has(from)) {
            const version = (versionOf.get(identity) ?? 0) + 1;
            versionOf.set(identity, version);
            touch(identity, index);
            changes.push({ kind: 'modify', path: from });
            ops.push({ op: 'write', path: from, content: contentFor(identity, version) });
            usedInCommit.add(from);
          }
          break;
        case 'delete':
          if (identity !== undefined && !usedInCommit.has(from)) {
            identityAt.delete(from);
            lastRemoval.set(from, { kind: 'delete', index });
            changes.push({ kind: 'delete', path: from });
            ops.push({ op: 'delete', path: from });
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
            ops.push({ op: 'rename', from, to });
            usedInCommit.add(from);
            usedInCommit.add(to);
          }
          break;
      }
    }

    const sha = shaFor(index);
    shaOf.push(sha);
    presentAfter.push(new Set(identityAt.keys()));
    contentAfter.push(
      new Map([...identityAt].map(([path, id]): [string, string] => [path, contentFor(id, versionOf.get(id) ?? 0)])),
    );
    opsPerCommit.push(ops);
    records.push({
      sha,
      parents: index === 0 ? [] : [shaFor(index - 1)],
      date: new Date(scripted.date).toISOString(),
      author: scripted.author,
      authorEmail: '',
      subject: `change ${index}`,
      changes,
    });
  });

  const windowStart = snapshotMs - hotWindowDays * MS_PER_DAY;
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
      lastCommitSubject: `change ${best}`,
      recentCommits: indexes.filter((i) => {
        const date = script[i]!.date;
        return date > windowStart && date <= snapshotMs;
      }).length,
    });
  }

  return {
    commits: records.reverse(),
    shaOf,
    presentAfter,
    contentAfter,
    ops: opsPerCommit,
    present: new Set(identityAt.keys()),
    lastRemoval,
    expectedHistory,
  };
}

// ---- Building a replayed history as a real git repository, optionally with a merged side branch ----

/**
 * A side branch that leaves the main line after commit `branchAfter`, gets 1 to 3 commits
 * of its own, and is merged back (with a merge commit) after main commit `mergeAfter`.
 * It only touches files under side/, so the merge never conflicts and the main-line model stays valid.
 * Side commit 1 adds side/a.ts and side/b.ts, commit 2 deletes side/a.ts, commit 3 edits side/b.ts.
 */
export interface SideEpisode {
  branchAfter: number;
  mergeAfter: number;
  commits: Array<{ date: number; author: string }>;
}

const sideCommitArb = fc.record({
  date: fc
    .integer({ min: SNAPSHOT_MS - 400 * MS_PER_DAY, max: SNAPSHOT_MS + 5 * MS_PER_DAY })
    .map((ms) => Math.floor(ms / 1000) * 1000),
  author: fc.constantFrom('Sid', 'Sue'),
});

/** Raw choices for a side episode. `fitEpisode` turns them into a valid one for a script of a given length. */
export const episodeChoiceArb = fc.option(
  fc.record({
    branchAfter: fc.nat(30),
    gap: fc.nat(30),
    commits: fc.array(sideCommitArb, { minLength: 1, maxLength: 3 }),
  }),
  { nil: undefined, freq: 2 },
);

/** Needs at least 2 main commits: the merge must come before the last one, so the last commit is HEAD. */
export function fitEpisode(
  choice: { branchAfter: number; gap: number; commits: SideEpisode['commits'] } | undefined,
  mainCommits: number,
): SideEpisode | undefined {
  if (choice === undefined || mainCommits < 2) return undefined;
  const branchAfter = choice.branchAfter % (mainCommits - 1);
  const mergeAfter = Math.min(branchAfter + (choice.gap % mainCommits), mainCommits - 2);
  return { branchAfter, mergeAfter, commits: choice.commits };
}

export interface RepoPlan {
  steps: Step[];
  /** For each main commit (oldest first), its position in BuiltRepo.shas. */
  mainShaIndex: number[];
  /** For each side-branch commit (oldest first), its position in BuiltRepo.shas. Empty without an episode. */
  sideShaIndex: number[];
  /** Position in BuiltRepo.shas of the merge commit, if there is a side episode. */
  mergeShaIndex: number | undefined;
}

/** Added to the first commit: the analyser's fast check wants a package.json where Knip runs. */
const PACKAGE_JSON: Op = { op: 'write', path: 'package.json', content: '{"name":"generated","knip":{}}\n' };

const isoForGit = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');

export function toRepoPlan(script: readonly ScriptCommit[], replayed: Replayed, episode?: SideEpisode): RepoPlan {
  const steps: Step[] = [];
  const mainShaIndex: number[] = [];
  const sideShaIndex: number[] = [];
  let mergeShaIndex: number | undefined;
  let commitsSoFar = 0; // commit and merge steps pushed, which is the length BuiltRepo.shas will have

  script.forEach((scripted, index) => {
    const ops = index === 0 ? [PACKAGE_JSON, ...replayed.ops[index]!] : replayed.ops[index]!;
    mainShaIndex.push(commitsSoFar++);
    steps.push({
      kind: 'commit',
      message: `main ${index}`,
      author: scripted.author,
      date: isoForGit(scripted.date),
      ops,
      allowEmpty: ops.length === 0,
    });

    if (episode !== undefined && index === episode.branchAfter) {
      steps.push({ kind: 'branch', name: 'side' });
      const sideOps: Op[][] = [
        [
          { op: 'write', path: 'side/a.ts', content: contentFor(-1, 0) },
          { op: 'write', path: 'side/b.ts', content: contentFor(-2, 0) },
        ],
        [{ op: 'delete', path: 'side/a.ts' }],
        [{ op: 'write', path: 'side/b.ts', content: contentFor(-2, 1) }],
      ];
      episode.commits.forEach((side, j) => {
        sideShaIndex.push(commitsSoFar++);
        steps.push({
          kind: 'commit',
          message: `side ${j}`,
          author: side.author,
          date: isoForGit(side.date),
          ops: sideOps[j]!,
        });
      });
      steps.push({ kind: 'checkout', name: 'main' });
    }

    if (episode !== undefined && index === episode.mergeAfter) {
      mergeShaIndex = commitsSoFar++;
      steps.push({
        kind: 'merge',
        name: 'side',
        message: 'merge side',
        author: 'Merger',
        date: isoForGit(scripted.date),
      });
    }
  });

  return { steps, mainShaIndex, sideShaIndex, mergeShaIndex };
}
