# Design: Repo analyser

Implements `requirements.md` in this folder. Requirement numbers below refer to it.

## Decisions on the open questions

The requirements left five questions open. This design takes the proposed answer for each:

1. Renames are followed. A path removed by a rename is not a ghost.
2. `--analysed-at` overrides the analysis timestamp. The clock is read once, in `cli.ts`.
3. A Knip failure aborts the run. Every Knip error message ends with the likely cause and fix: dependencies are probably not installed in the clone, and the user installs them and re-runs.
4. The hot threshold is 5 commits in the 30 days before the snapshot (`HOT_COMMIT_THRESHOLD`).
5. Merge commits are ignored for per-file change detection. Plain `git log` (no `-m`) shows no file changes for merges, so this needs no special code. Known limitation: edits made only inside a merge (conflict resolutions) are not seen. Branch commits still carry the real changes. The analyser README documents this.
6. Current vs ghost is decided from the snapshot tree, not history order. A ghost's last existing commit is the first parent of its most recent deleting commit.
7. Knip uses the clone's own configuration, with an optional `--knip-config` override and a stderr warning when no config exists.

Additions from your review:
- Only git-tracked files count (read from the snapshot tree), and the build-output folders `dist`, `build`, `coverage`, `.next`, `out` are excluded along with `node_modules`, for current files and ghosts alike.
- Lines of code means non-blank lines.
- Ghosts use the same path filter as current files.
- Unused means Knip's unused files only.

If you want any of these changed, say so before tasks are generated.

## Module layout

```
shared/
  graveyard-schema.ts        types, SCHEMA_VERSION, validateGraveyard()
  graveyard-schema.test.ts

analyser/
  package.json, tsconfig.json
  src/
    cli.ts                   arg parsing, reads clock, wires I/O to pure core, exit codes
    pipeline.ts              orchestrates: I/O modules -> pure core -> validated output
    core/                    PURE: no fs, process, git, or clock
      decay.ts               ageDays, decayState, decayScore, isHot, constants
      files.ts               isTrackedSourcePath(), countNonBlankLines()
      folders.ts             deriveFolders(), folderOf()
      history.ts             analyseHistory(): per-file last commit, recent count, ghosts
      knip-parse.ts          parseKnipOutput()
      knip-config.ts         hasKnipConfig()
      assemble.ts            assembleGraveyard(): builds and sorts the final object
      serialise.ts           toJson(): fixed key order, 2-space indent, trailing newline
    io/                      I/O only, returns plain data
      git.ts                 repo checks, snapshot commit, tree listing, blob reads, log
      git-log-parse.ts       parses `git log` text into CommitRecord[] (pure, but kept next to git.ts)
      knip.ts                runs Knip, returns stdout text and exit code
      write-output.ts        atomic write (temp file, then rename)
```

Each pure file has `*.test.ts` and, where a correctness property applies, `*.property.test.ts` beside it. `git-log-parse.ts` is pure and lives under `io/` only because it is tied to git's output format. It is tested with plain strings.

Dependency direction: `cli` → `pipeline` → (`io/*`, `core/*`) → `shared`. `core` imports nothing from `io`.

## Shared schema (`shared/graveyard-schema.ts`)

```ts
export const SCHEMA_VERSION = 1;

export type DecayState = 'fresh' | 'stale' | 'ancient';

export interface RepoMeta {
  name: string;
  snapshotSha: string;
  snapshotDate: string;     // ISO 8601 UTC, e.g. 2026-03-01T12:00:00.000Z
  analysedAt: string;       // ISO 8601 UTC
  schemaVersion: number;
}

export interface Folder { path: string; parent: string | null } // root: path "", parent null

export interface FileEntry {
  path: string;
  folder: string;
  linesOfCode: number;      // non-blank lines
  lastCommitDate: string;
  lastCommitAuthor: string;
  commitsLast30Days: number;
  unused: boolean;
  decayScore: number;       // 0..1, rounded to 4 decimals
  decayState: DecayState;
  hot: boolean;
  eulogy: string;           // always "" from the analyser
}

export interface Ghost {
  path: string;
  deletedInSha: string;
  deletedDate: string;
  deletedBy: string;
  lastExistingSha: string;
}

export interface Graveyard {
  meta: RepoMeta;
  folders: Folder[];
  files: FileEntry[];
  ghosts: Ghost[];
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };
export function validateGraveyard(value: unknown): ValidationResult;
```

`validateGraveyard` checks shape and types, `schemaVersion === SCHEMA_VERSION`, ISO date format, score range, and the structural rules that the data file must hold: every file's folder is in the folder list, parents exist, no cycles, no path is both file and ghost. The structural checks give the pipeline a final safety net (Req 2.7, 9.4) and give the frontend the same guarantees. They do not replace properties P3 and P4, which test the code that builds the data.

Key order in the types above is the output key order (Req 9.2). Folder `parent` is `null` for the root, not omitted, so the key is always present.

## Pure core

### `decay.ts` (Req 7)

```ts
export const MS_PER_DAY = 86_400_000;
export const FRESH_MAX_DAYS = 90;        // fresh: ageDays < 90
export const ANCIENT_MIN_DAYS = 360;     // ancient: ageDays > 360
export const AGE_CAP_DAYS = 720;         // age component stops growing here
export const AGE_WEIGHT = 0.4;
export const UNUSED_WEIGHT = 0.6;
export const HOT_WINDOW_DAYS = 30;
export const HOT_COMMIT_THRESHOLD = 5;

ageDays(lastCommitMs: number, snapshotMs: number): number
  // Math.max(0, Math.floor((snapshotMs - lastCommitMs) / MS_PER_DAY))
decayState(ageDays: number): DecayState
decayScore(ageDays: number, unused: boolean): number
  // round4( AGE_WEIGHT * min(ageDays, AGE_CAP_DAYS) / AGE_CAP_DAYS + (unused ? UNUSED_WEIGHT : 0) )
isHot(commitsLast30Days: number): boolean   // >= HOT_COMMIT_THRESHOLD
```

Why these numbers:
- A used file scores from 0 to 0.4. An unused file scores from 0.6 to 1.0. Even a brand-new unused file (0.6) outranks the oldest used file (0.4), which satisfies Req 7.2 with room to spare.
- `AGE_WEIGHT / AGE_CAP_DAYS` is about 0.00056 per day, so rounding to 4 decimals still increases the score every day of age until the cap. Req 7.4 (strictly increasing through the stale range) holds. Ancient files keep rising until 720 days, so a three-year-old file looks no worse than a two-year-old one. The cap keeps the score in range and stops one very old file from compressing the rest of the scale.
- Rounding to 4 decimals keeps JSON stable and short. `Math.round` of a non-decreasing function is non-decreasing, so P1 is unaffected.
- The state boundaries use whole days against fixed counts (Req 7.1): 89 is fresh, 90 and 360 are stale, 361 is ancient.

The frontend maps stale-range scores to moss amount and ancient-range scores to lean. That mapping is not this spec's concern.

### `files.ts` (Req 3)

- `isTrackedSourcePath(path)`: extension in the allowed set, no path segment equal to `node_modules`, `dist`, `build`, `coverage`, `.next`, or `out`, and not `.d.ts`/`.d.mts`/`.d.cts`. Used for both current files and ghosts, so the graveyard never shows a ghost for a file type or folder it would not show alive. The segment match is on any directory segment, so `packages/a/dist/x.js` is excluded, and so is a hand-written `src/build/x.ts`. That is the cost of a simple rule.
- `countNonBlankLines(content: Uint8Array)`: decode as UTF-8, split on `\n`, count lines that contain at least one non-whitespace character. `\r` counts as whitespace, so CRLF files give the same result as LF. Empty content gives 0; a file of only blank lines gives 0.

"Only git-tracked files count" is met by `listTree`, which reads the snapshot commit's tree, so `.gitignore`d and untracked files are never seen.

### `folders.ts` (Req 4)

`deriveFolders(filePaths: string[]): Folder[]` adds the root plus every ancestor of every file path. Folder paths use `/` and no trailing slash. `folderOf(path)` returns the path up to the last `/`, or `""`. The output is sorted by path. Folders are derived only from current files, so a folder holding only ghosts does not appear (Req 4.2).

### `history.ts` (Req 5, 8)

Input, produced by `io/git-log-parse.ts` from `git log`:

```ts
interface CommitRecord {
  sha: string;
  parents: string[];
  date: string;            // committer date, ISO UTC
  author: string;          // author name
  changes: Change[];
}
type Change =
  | { kind: 'add' | 'modify' | 'delete'; path: string }
  | { kind: 'rename'; oldPath: string; path: string };
```

Copies (`C`) are read as `add`. Type changes (`T`) are read as `modify`.

```ts
analyseHistory(input: {
  commits: CommitRecord[];            // newest first, as git emits with --topo-order
  currentPaths: Set<string>;          // tracked source files in the snapshot tree
  snapshotMs: number;
}): { perFile: Map<string, FileHistory>; ghosts: GhostRaw[] }
```

The function walks commits newest to oldest in one pass.

**Per-file history with rename following.** It keeps `tracked: Map<pathAtThisPoint, currentPath>`, seeded so each current path maps to itself.
- For `add`, `modify`, or the new side of a `rename`: if the path is in `tracked`, the commit touched that current file. A file's last commit is the touching commit with the latest commit date. On equal dates the one listed first in the log wins. (Log order is topological, so a merged branch's older-dated commit can be listed before a newer-dated one. Date decides, because decay is about time.) If the commit date is `> snapshot − 30 days` and `<= snapshot`, the file's recent count goes up by one. An `add` also removes the entry from `tracked`, because older history belongs to a different incarnation of the path. A `delete` never touches a tracked file, since a tracked path exists after the commit.
- Changes inside one commit are read against the state after that commit, then applied together: first every lookup, then every tracker removal (`add`, and the new side of a `rename`), then every tracker insertion (the old side of a `rename`). This keeps a commit that renames `a.ts` to `b.ts` and also creates a new `a.ts` correct.
- For a `rename`: after counting, `tracked` re-keys from `path` to `oldPath`, so earlier history continues under the old name.
- A commit counts once per file even if it lists the file twice.

**Ghosts.** Current vs ghost is decided from the snapshot tree, never from history order. `currentPaths` is exactly what `git ls-tree -r` lists at the snapshot after the `isTrackedSourcePath` filter. A ghost is a path that appears in any change in the log, passes `isTrackedSourcePath`, is not in `currentPaths`, and whose most recent removal event is a `delete`. A `rename` away from the path as its most recent removal means it is not a ghost. "Most recent" means first in the log's newest-first (`--topo-order`) listing, which is deterministic even when branch commits have out-of-order dates. History replay supplies only the dates, authors, counts, and each ghost's deleting commit.

The record keeps the deleting commit's SHA, date, author, and its **first parent** as `lastExistingSha`. A root commit cannot delete anything, so the parent always exists. A path that has no removal event in the log at all (and is not current) is skipped, since there is no deleting commit to record.

Because rename-away of a path makes it "not a ghost", a file renamed `a.ts → b.ts` then deleted as `b.ts` yields a ghost for `b.ts` only.

`lastExistingSha` is the first parent of the deleting commit. Merge commits show no changes, so a deleting commit is never a merge and has exactly one parent, which holds the file.

**Lines changed on the same path in multiple commits are fine**; the latest-dated touching commit gives the last commit, and every touching commit within the window counts toward the recent total, once per commit.

A current file with no commit record is impossible in a full clone. If it happens, `analyseHistory` throws an error naming the path, and the run fails. (This could occur if the log was filtered wrongly.)

### `knip-parse.ts` (Req 6)

`parseKnipOutput(stdout: string): Set<string>` returns repo-relative unused file paths, and throws `KnipOutputError` on bad input.

Knip's JSON reporter prints one line: `{ "issues": [ { "file": "...", "files": [ { "name": "..." } ], ... } ] }`. A file is unused when its entry has a non-empty `files` array. The parser:
1. Parses JSON. Not an object, or no `issues` array: throw.
2. For each issue whose `files` is a non-empty array, adds `issue.file` (normalised to `/` separators).
3. Also accepts the older shape `{ "files": ["a.ts"], ... }` by adding those strings, in case the clone pins an older Knip. The two sources are unioned.

The analyser then intersects Knip's set with the current tracked source paths. Knip paths outside that set are dropped. Knip is run with `--include files` so unused exports and dependencies, which the product spec does not use, are not computed or parsed.

Reference: Knip JSON reporter and exit codes at knip.dev/features/reporters and knip.dev/reference/cli.

### `assemble.ts` and `serialise.ts` (Req 9)

`assembleGraveyard(input)` takes plain data (meta fields, current file records, ghosts, unused set) and returns a `Graveyard`. It computes each file's `ageDays`, state, score, and hot flag, derives folders, sorts everything by path, and never reads a clock.

Sorting uses code-point order: `a < b ? -1 : a > b ? 1 : 0`, not `localeCompare`, which depends on the machine's locale.

`toJson(graveyard)` builds each object with keys in a fixed order (the order in the schema interfaces), then `JSON.stringify(obj, null, 2) + '\n'`. Building objects literally, rather than relying on insertion order from spread, keeps order stable.

Dates are normalised once to `new Date(ms).toISOString()` (always `Z`, millisecond precision).

## I/O modules

All use `child_process.execFile` with argument arrays. No shell is involved, so paths with spaces or odd characters cannot be interpreted as commands. Every git call sets `-C <clone>`, and commands that could write (none are used) are not allowed.

### `io/git.ts`

| Function | Git command | Notes |
| --- | --- | --- |
| `assertUsableRepo(path)` | `rev-parse --is-inside-work-tree`, `rev-parse --is-shallow-repository`, `rev-parse --show-toplevel` | Req 1.3. Bare repos fail the first check. |
| `resolveSnapshot(path)` | `log -1 --format=%H%x00%cI HEAD` | SHA and committer date. |
| `repoName(path)` | `basename` of the top-level directory | Falls back to `origin` URL basename if present, with `.git` stripped. Decided in tasks. |
| `listTree(path, sha)` | `ls-tree -r -z <sha>` | Returns `{ path, blobSha }[]`. Skips non-blob entries (submodules). |
| `readBlobs(path, shas)` | `cat-file --batch` | One process, many blobs. Returns `Map<blobSha, Uint8Array>`. Used for line counting. |
| `readLog(path, sha)` | `log --topo-order -z --name-status -M --format=<fmt> <sha>` | Returns raw text for the parser. |

The `-M` flag turns on rename detection. Git's default similarity (50%) is used. Rename detection is heuristic, so a heavily rewritten file may show as delete plus add. That is accepted.

`git-log-parse.ts` format: each commit starts with a `\x1e` record separator, then `%H`, `%P`, `%cI`, `%an` separated by `\x1f`, and then the name-status entries. With `-z`, entries are NUL-separated: a status token (`A`, `M`, `D`, `T`, `R100`, `C75`), then one path, or two paths for `R` and `C`. The exact byte layout around the end of the header is confirmed by a fixture test built from real `git log` output in task 1, and the parser follows what git actually emits.

Committer dates are parsed with `Date.parse` and converted to UTC. `%cI` includes the offset, so the instant is exact.

`readLog` can be large on big repos. It is read into memory as a string. For the demo repo sizes this is fine. Streaming is out of scope.

### `io/knip.ts`

Runs the analyser's own Knip binary, resolved from the analyser's `node_modules`, so the analysed repo need not list Knip:

```
node <analyser>/node_modules/knip/bin/knip.js --directory <clone> --reporter json --include files --no-progress [--config <abs path>]
```

**Configuration (Req 6.7, 6.8).** Knip runs with `--directory <clone>`, so it discovers the clone's own config (`knip.json`, `knip.jsonc`, `.knip.json`, `.knip.jsonc`, `knip.ts`, `knip.js`, `knip.config.ts`, or a `knip` key in `package.json`) with no extra work. When `--knip-config <path>` is given, the CLI resolves it to an absolute path, checks it exists, and passes it as `--config`. Without a config, Knip's defaults can flag test files, scripts, and tool configs as unused, so the graveyard would mark live files dead. The pure function `hasKnipConfig(treePaths, packageJsonText | undefined): boolean` (in `core/knip-config.ts`) checks the snapshot tree for those file names and parses `package.json` for a `knip` key. When it returns false and no flag was given, the pipeline writes a warning to stderr. The README documents this and recommends adding a `knip.json` to the target clone, or passing `--knip-config`.

Exit code handling follows Knip's documented codes: `0` and `1` both mean it ran (1 means issues were found). Exit `2`, a spawn failure, or empty stdout is a failure. The parser then validates the stdout, and an unparseable result is also a failure (Req 6.4). On failure the error message includes Knip's stderr and always ends with the same advice, whatever the cause (Req 6.5): "The most likely cause is that the repository's dependencies are not installed in the clone. Install them yourself (for example `npm install` inside the clone), then run the analyser again. The analyser never installs anything."

The analyser adds `knip` as a dependency in `analyser/package.json`. Since Knip needs the target repo's dependencies to resolve imports, accuracy depends on the user having installed them. That is the user's step, per Req 6.5.

### `io/write-output.ts`

Writes `<out>.<random>.tmp` in the same directory, then `rename` onto the target. Same directory keeps the rename on one filesystem, so it is atomic. On any error the temp file is removed. Missing parent directories of `--out` are created.

## Pipeline (`pipeline.ts`)

```
1. assertUsableRepo(path)
2. snapshot = resolveSnapshot(path)
3. tree = listTree(path, snapshot.sha), filtered by isTrackedSourcePath
4. blobs = readBlobs(path, blob SHAs)          -> linesOfCode via countNonBlankLines
5. knipText = runKnip(path)                    -> unused = parseKnipOutput(knipText) ∩ current paths
6. commits = parseGitLog(readLog(path, snapshot.sha))
7. history = analyseHistory({ commits, currentPaths, snapshotMs })
8. graveyard = assembleGraveyard({ meta, files, ghosts, unused, ... })
9. validateGraveyard(graveyard) -> abort on failure
10. writeOutput(toJson(graveyard))
```

Steps 1 to 7 happen before any write, so every failure path leaves no output file (Req 1.3, 6.4, 9.4).

`analysedAt` comes from `cli.ts`, which reads `--analysed-at` or `new Date()`, and passes it to `pipeline`. Nothing else reads the clock.

## CLI (`cli.ts`)

```
repo-in-peace-analyse <repo-path> [--out <file>] [--analysed-at <ISO timestamp>] [--knip-config <file>]
```

- Argument parsing uses Node's built-in `util.parseArgs`. No extra dependency.
- `--analysed-at` is validated as an ISO timestamp, then normalised to UTC.
- `--knip-config` must name an existing file, or the run exits 1 before Knip starts.
- Default output name: `<repo-name>.graveyard.json` in the current directory, where repo name has characters outside `[A-Za-z0-9._-]` replaced with `-`.
- Exit codes: `0` success; `1` for expected failures (bad path, shallow clone, Knip failure, validation failure) with a one-line message on stderr; `2` for usage errors. Unexpected exceptions print the stack and exit `1`.
- Progress lines go to stderr. Stdout stays empty so the tool composes with other commands.

An npm script `analyse` in `analyser/package.json` runs it via `tsx`. The command to run is given in the tasks.

## Error handling summary

| Situation | Behaviour |
| --- | --- |
| Path missing, not a repo, bare, or shallow | Exit 1, message, no file |
| Knip exit 2, empty or unparseable output | Exit 1, Knip message, no file |
| Current file missing from git log | Exit 1, message naming the file, no file |
| Output fails validation | Exit 1, validation errors, no file |
| Write fails | Temp file removed, exit 1 |
| Submodule or symlink entries in tree | Skipped. Only blobs with tracked extensions count. Symlinks (mode 120000) are skipped too. |

## Testing strategy

Pure functions get unit tests and fast-check property tests. I/O modules get integration tests against real temp git repos created in the test, with a small helper `test/make-repo.ts` that builds a repo from a scripted list of commits (add, modify, delete, rename) with fixed author, committer date, and message. Knip is replaced in integration tests by a stub that returns canned JSON; one optional smoke test runs real Knip and is skipped unless an environment variable is set.

### Property tests

| # | Property | Test design |
| --- | --- | --- |
| P1 | Score never decreases as time since last commit grows. | Generate `unused` and two ages `a ≤ b` (integers 0 to 5000). Assert `decayScore(a, u) <= decayScore(b, u)`. Also assert the score is within `[0, 1]`, strictly increases day to day below the cap, and that `unused = true` never lowers the score. |
| P2 | Same snapshot gives identical output. | Two tiers. (a) Pure: generate commit records, current paths, Knip set; shuffle input orders; run `assembleGraveyard` + `toJson` twice and on shuffled inputs. Outputs must be equal strings. (b) Integration: one fixture repo, run the pipeline twice with the same `--analysed-at` and compare bytes. |
| P3 | No ghost path is also a current file. | Generate random commit histories (sequences of add/modify/delete/rename over a small path pool, including re-adds and commits whose dates are out of order, as after a merge). Build the current set independently (replaying the operations, as the tree would hold it) and pass it in as `currentPaths`. Assert disjointness, uniqueness of ghost paths, and that every ghost passes `isTrackedSourcePath`. The property is true by construction because ghosts are filtered against the tree; the test guards that nothing reintroduces a history-order rule. |
| P4 | Every file's folder is in the folder list, and the hierarchy is acyclic. | Generate arbitrary path lists (nested, root-level, odd names). Run `deriveFolders` and `assembleGraveyard`. Assert each file's `folder` is in the list, each non-root folder's parent is in the list, each parent chain reaches the root within `depth` steps with no repeats, and exactly one root exists. |
| P5 | Every ghost's last existing commit (the first parent of its most recent deleting commit) contains that file. | Integration. Generate a random scripted history, build a real temp repo, run the git module and `analyseHistory`. For each ghost assert that `git ls-tree <lastExistingSha> -- <path>` returns the path (the required assertion), that `lastExistingSha` is the first parent of `deletedInSha` per `git rev-parse <deletedInSha>^1`, and that its blob content equals the content from the last commit that wrote it. Few runs (for example 25) because each builds a repo. |

Supporting property tests (not in the required five): the state boundaries match Req 7.1 for any `ageDays`; `countNonBlankLines` equals the number of lines that match `/\S/` for any generated text with LF or CRLF endings; `isTrackedSourcePath` is false for any path containing an excluded directory segment, and gives the same answer for a file and its ghost; rename-following gives the same `commitsLast30Days` whether or not the file was renamed within the window.

The pure-side generators for commit histories live in `test/arbitraries.ts` and are shared by P2, P3 and P5, so all three describe the same model of a repo. The history model replays operations to compute expected current paths, which gives the oracle for P3 without using the code under test.

### Example tests worth having

- State boundaries: 89 → fresh, 90 → stale, 360 → stale, 361 → ancient.
- Hot threshold: 4 → not hot, 5 → hot.
- Knip parser: new-format sample from Knip docs, old format, empty issues, garbage input.
- Git log parser: fixture from real git output including a rename, a path with a space, and a path with a non-ASCII character.
- Deleted then re-added file appears only among files.
- Rename `a→b` then delete `b`: ghost for `b` only.
- Shallow clone and non-repo paths are rejected without output.
- Lines of code: a file with blank lines, whitespace-only lines and CRLF endings counts only lines with visible characters.
- A tracked file under `dist/` or `build/` is absent from both files and ghosts.
- A path deleted twice and absent now has one ghost, from the newer deletion.
- Every Knip failure message contains the "dependencies not installed" advice.

## Out of scope for this design

Eulogy generation, the frontend, GitHub API calls, languages other than JS/TS, and installing dependencies in the analysed repo, as in the requirements.

## Tooling the user will need to run

Per the working agreement I will not run these. They are listed here for the tasks step:

```
npm install            # in analyser/ and the shared workspace, once the package.json files exist
npx vitest run         # tests
npm run analyse -- <repo-path> --out <file>
```
