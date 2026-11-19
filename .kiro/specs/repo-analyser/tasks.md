# Tasks: Repo analyser

Requirement and design references point to `requirements.md` and `design.md` in this folder. Property tests use fast-check. Test files sit beside their modules. Commands for the user to run are marked **Run**.

Status key: `[x]` done, `[ ]` not started.

- [x] 1. Project scaffolding and git log parsing (fixture first)
  - [x] 1.1 Create `analyser/package.json` (scripts: `test`, `typecheck`, `analyse`; dev deps: typescript, vitest, fast-check, tsx, @types/node; dep: knip) and a strict `analyser/tsconfig.json` that also covers `../shared`.
  - [x] 1.2 Add `core/commit-record.ts` with `CommitRecord` and `Change` (design: Pure core, history).
  - [x] 1.3 Add `test/fixtures/make-git-log-sample.sh`, which builds a throwaway repo in a temp directory and captures real `git log -z --name-status -M` output to `git-log-sample.bin`, plus a readable `git-log-sample.expected.tsv` of the header fields. The repo has: a rename, a delete, a path with a space, a non-ASCII path, a side branch, a `--no-ff` merge, and an empty commit.
  - [x] 1.4 Write `io/git-log-parse.test.ts` against the captured fixture (headers checked against the `.tsv`, changes checked by hand), plus error cases. Write it before the parser.
  - [x] 1.5 Implement `io/git-log-parse.ts` (`GIT_LOG_ARGS`, `parseGitLog`) until the tests pass.
  - [x] 1.6 Add `test/make-repo.ts` (scripted temp git repos with fixed authors and dates, including branch and merge steps) and a live round-trip test that runs real `git log` with `GIT_LOG_ARGS` and checks the parser against the script that built the repo.
  - **Run:** `cd analyser && npm install && npm test`
  - _Requirements: 5, 8, 10.1, 10.2; design: git-log-parse_

- [x] 2. Shared schema
  - [x] 2.1 Write `shared/graveyard-schema.ts`: types, `SCHEMA_VERSION`, `validateGraveyard`.
  - [x] 2.2 Unit tests: valid sample passes; each structural rule fails when broken (missing folder, parent cycle, path in both files and ghosts, bad date, score out of range, wrong version).
  - Note: `shared/` has its own `package.json` so its tests resolve vitest; `analyser/tsconfig.json` excludes shared test files.
  - **Run:** `cd shared && npm install && npm run typecheck && npm test`
  - _Requirements: 2, 9.4_

- [x] 3. Decay scoring (`core/decay.ts`)
  - [x] 3.1 Implement constants, `ageDays`, `decayState`, `decayScore`, `isHot`.
  - [x] 3.2 Unit tests: state boundaries (89, 90, 360, 361), hot boundary (4, 5), future-dated commit gives age 0.
  - [x] 3.3 **P1 property test** (`decay.property.test.ts`): for fixed `unused`, `a ≤ b` implies `score(a) ≤ score(b)`. Also: score in `[0, 1]`; strictly increasing per day below the cap; `unused = true` never lowers the score; unused at age 0 beats used at age 360; state matches Req 7.1 for any age.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 7_

- [x] 4. File rules (`core/files.ts`)
  - [x] 4.1 `isTrackedSourcePath`: extension list, excluded directory segments (`node_modules`, `dist`, `build`, `coverage`, `.next`, `out`), declaration files.
  - [x] 4.2 `countNonBlankLines`: UTF-8, LF and CRLF, whitespace-only lines are blank.
  - [x] 4.3 Unit and property tests: excluded segment anywhere gives false; non-blank count equals the number of lines matching `/\S/`.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 3_

- [x] 5. Folders (`core/folders.ts`)
  - [x] 5.1 `folderOf`, `deriveFolders` (root plus every ancestor, sorted by code point).
  - [x] 5.2 **P4 property test**: for generated path lists, every file's folder is in the list; every non-root folder's parent is in the list; each parent chain reaches the root without repeats; exactly one root; no folder without files beneath it.
  - Also added `core/sort.ts` (`compareCodePoint`, with its own tests): the single sort order used for every list in the output (design: assemble).
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 4_

- [x] 6. History analysis (`core/history.ts`)
  - [x] 6.1 `analyseHistory`: per-file last commit and 30-day count with rename following; ghosts decided against `currentPaths` from the tree; deleting commit is the first removal event in log order; `lastExistingSha` is the first parent.
  - [x] 6.2 Unit tests: rename then delete gives a ghost for the new name only; delete and re-add is current only; deleted twice gives the newer deletion; out-of-order dates; a file renamed inside the 30-day window keeps its earlier commits in the count; commit outside the window is not counted; excluded paths never become ghosts.
  - [x] 6.3 Shared generators in `test/arbitraries.ts`: random operation sequences over a small path pool, with a replay oracle that computes the expected current set.
  - [x] 6.4 **P3 property test**: ghosts and current files are disjoint; ghost paths are unique; every ghost passes the filter.
  - Beyond P3: the property tests compare ghosts and per-file history against an independent forward replay (`test/arbitraries.ts`), including rename following and out-of-order dates. Design change: a file's last commit is the touching commit with the latest date (ties go to the first in log order), not the first in log order.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 5, 8_

- [x] 7. Knip parsing and config detection
  - [x] 7.1 `core/knip-parse.ts`: current `issues[].files[]` shape, older `files: []` shape, error on garbage; unit tests including the sample from Knip's docs.
  - [x] 7.2 `core/knip-config.ts`: `hasKnipConfig(treePaths, packageJsonText)`; unit tests for each config file name and for a `knip` key in `package.json`.
  - Note for task 10: `hasKnipConfig` needs the whole snapshot tree (not only source files) and the root `package.json` text, so `io/git.ts` must expose both.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 6_

- [x] 8. Assembly and serialisation
  - [x] 8.1 `core/assemble.ts` (`assembleGraveyard`) and `core/serialise.ts` (`toJson`): sorting by code point, fixed key order, UTC ISO dates, two-space indent, trailing newline.
  - [x] 8.2 **P2 property test, pure tier**: shuffled inputs give identical JSON strings; the result passes `validateGraveyard`; eulogies are all empty.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 9, 10.1_

- [x] 9. I/O modules
  - [x] 9.1 `io/git.ts`: `assertUsableRepo` (not a repo, bare, shallow), `resolveSnapshot`, `repoName`, `listTree`, `readBlobs`, `readLog`. All through `execFile` with argument arrays.
  - [x] 9.2 `io/knip.ts`: build the command, handle exit codes (0 and 1 ok, 2 fails), pass `--config` when given, append the "dependencies not installed" advice to every failure message.
  - [x] 9.3 `io/write-output.ts`: temp file in the target directory, rename, clean up on error, create parent directories.
  - [x] 9.4 Integration tests against temp repos from `make-repo.ts`: shallow clone rejected, non-repo rejected, tree listing skips submodules and symlinks, write is atomic. Knip is replaced by a stub.
  - Added `src/errors.ts` (`AnalyserError`: failures the CLI reports without a stack trace). No real-Knip smoke test yet; Knip is covered by pure tests of its result handling and by a stub in the pipeline tests.
  - **Run:** `cd analyser && npm run typecheck && npm test`
  - _Requirements: 1, 3, 6, 9.5_

- [x] 10. Pipeline and CLI
  - [x] 10.1 `pipeline.ts`: the ten steps from the design; nothing is written until validation passes; warn on stderr when `hasKnipConfig` is false and no `--knip-config` was given.
  - [x] 10.2 `cli.ts` with `util.parseArgs`: `--out`, `--analysed-at`, `--knip-config`; exit codes 0, 1, 2; default output name.
  - [x] 10.3 Tests: each failure path leaves no output file; `--knip-config` that does not exist exits 1 before Knip runs.
  - Added beyond the plan: the pipeline refuses an output path inside the clone (Req 1.5: the analyser never modifies the clone; the default output is in the current directory, which is often the clone itself). `--knip-config` is checked first, so a missing file fails before any git or Knip work. Files: `pipeline.ts`, `cli.ts`, `cli-args.ts`, `core/paths.ts`, `realPathOfFuture` in `io/write-output.ts`.
  - [x] 10.4 `--knip-dir <folder>` (repeatable), found necessary by the first real run (`oikos_ledger`: a Python repo whose only `package.json` is in `app/`). `core/knip-dirs.ts` (normalise folders, list folders with a `package.json`, the fast-check message, prefix Knip paths, strip a folder prefix); the pipeline checks the tree before any Knip run, runs Knip once per folder, prefixes and merges; Knip's `Unable to find package.json` gets `--knip-dir` advice instead of the install advice; the missing-config warning is per folder. Property test: every Knip path, once prefixed, is a current file.
  - Verified: `npx tsc --noEmit` clean; `npx vitest run` 451 tests in 25 files pass; smoke test `npm run analyse -- /Users/sl/projects/oikos_ledger --knip-dir app --out /tmp/demo.graveyard.json` wrote 129 files, 68 folders, 0 ghosts, 12 unused, 7 hot, every file fresh (the repo's history is only June to August 2026).
  - _Requirements: 1, 6.7 to 6.10, 9_

- [x] 11. End-to-end property tests
  - [x] 11.1 **P2 end-to-end**: build a fixture repo, run the pipeline twice with the same `--analysed-at` and a stub Knip, compare bytes.
  - [x] 11.2 **P5 property test**: generated scripted histories (including branches and merges) become real temp repos; for every ghost, `git ls-tree <lastExistingSha> -- <path>` returns the path (the required assertion); `lastExistingSha` equals `git rev-parse <deletedInSha>^1`; the blob content equals the last content written. About 25 runs.
  - Built as one test, `src/e2e.property.test.ts`, 25 runs, each a real temporary git repository made from a random history: renames, deletes, re-adds, out-of-order commit dates, and (about two runs in three) a side branch merged back with a merge commit. Each run checks: the output bytes are identical on a rerun (P2); the schema validator passes; files, last commit, 30-day counts, unused flags and non-blank line counts match the independent model; ghosts match the model; no ghost is a current file (P3); and each ghost is sound according to git alone (P5): `git ls-tree <lastExistingSha>` holds the path, `lastExistingSha` equals `<deletedInSha>^1`, the deleting commit's diff is a `D` of that path, the path is absent from its tree and from HEAD, and `git show` of the last existing commit equals the last content written, byte for byte. A coverage test fails if the generator stops producing ghosts, renames, side branches or re-adds. Support added to `test/arbitraries.ts`: file contents and operations per commit, `toRepoPlan`, and `SideEpisode`.
  - Mutation check: breaking the last-existing-commit rule, and removing rename following, each made the test fail with a small counterexample.
  - _Requirements: 8.4, 9.1_

- [x] 12. README and checkpoint
  - [x] 12.1 `analyser/README.md`: usage and flags; the decay rules and the hot threshold constant; the Knip configuration advice (use the repo's `knip.json` or `--knip-config`, why, and the warning); known limitations (merge-commit-only edits such as conflict resolutions are missed, rename detection is heuristic, any `build`/`out` directory is excluded); the dependency-install requirement.
  - [x] 12.2 Checkpoint. **Run:** `cd analyser && npm run typecheck && npm test`. Fix failures before moving on.
  - _Requirements: 6.8, 7.5_

- [x] 13. Configurable decay thresholds (a later request)
  - [x] 13.1 Spec: Requirements 1.9, 1.10, 2.2, 2.4, 2.7, 7 (state, score, cap, hot, validation, recording), properties P6 and P7; design: schema version 2, `Thresholds`, `core/thresholds.ts`, decay functions take the thresholds as a required argument.
  - [x] 13.2 `shared/graveyard-schema.ts`: `SCHEMA_VERSION` 2, `meta.thresholds`, validator rules (positive whole numbers, `ancientAfterDays > staleAfterDays`, `decayCapDays = 2 x ancientAfterDays`).
  - [x] 13.3 `core/thresholds.ts` (`DEFAULT_THRESHOLDS`, `thresholdsFrom`, `parseThresholdFlags`); `decay.ts`, `history.ts`, `assemble.ts`, `serialise.ts`, `pipeline.ts`, `cli-args.ts` take or write the thresholds; flags `--stale-after`, `--ancient-after`, `--hot-commits`, `--hot-window`, validated before the clone is read (usage error, exit 2). Negative numbers reach our own check instead of Node's vague message.
  - [x] 13.4 Tests: generators pick random valid thresholds (`thresholdsArb`, `wideThresholdsArb`) and the model takes the hot window; P1 to P5 hold for any valid thresholds; **P6** golden file `test/golden/default-thresholds.json` (written by the analyser before the change, from `test/golden-repo.ts`) plus a frozen copy of the old formulas; **P7** state agrees with the thresholds, for pure inputs, assembled outputs and end-to-end runs.
  - [x] 13.5 `analyser/README.md`: flags, defaults, decay rules, "the demo uses the defaults", Knip advice and security note, known limitations.
  - Decisions to review: (a) Resolved: the edges keep the original asymmetry (stale from the limit, ancient only after it), because the request required default output to be unchanged; the request's property text read as if ancient started at the limit, which would change age 360 from stale to ancient. (b) Resolved: `commitsLast30Days` was renamed `recentCommits` (it counts the hot window) in the schema, code, tests, specs, README and golden file; only the field name changed, the values did not. (c) Accepted: for a decay cap above 2000 days, 4-decimal rounding can repeat a score on adjacent days; it never decreases. Documented in the README.
  - Verified: `npx tsc --noEmit` clean; `npx vitest run` 538 tests in 27 files, three runs in a row; mutation checks (hot window hard-coded to 30, decay cap hard-coded to 720) each fail the tests.
