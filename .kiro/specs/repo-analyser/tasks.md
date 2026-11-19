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

- [ ] 3. Decay scoring (`core/decay.ts`)
  - [ ] 3.1 Implement constants, `ageDays`, `decayState`, `decayScore`, `isHot`.
  - [ ] 3.2 Unit tests: state boundaries (89, 90, 360, 361), hot boundary (4, 5), future-dated commit gives age 0.
  - [ ] 3.3 **P1 property test** (`decay.property.test.ts`): for fixed `unused`, `a ≤ b` implies `score(a) ≤ score(b)`. Also: score in `[0, 1]`; strictly increasing per day below the cap; `unused = true` never lowers the score; unused at age 0 beats used at age 360; state matches Req 7.1 for any age.
  - _Requirements: 7_

- [ ] 4. File rules (`core/files.ts`)
  - [ ] 4.1 `isTrackedSourcePath`: extension list, excluded directory segments (`node_modules`, `dist`, `build`, `coverage`, `.next`, `out`), declaration files.
  - [ ] 4.2 `countNonBlankLines`: UTF-8, LF and CRLF, whitespace-only lines are blank.
  - [ ] 4.3 Unit and property tests: excluded segment anywhere gives false; non-blank count equals the number of lines matching `/\S/`.
  - _Requirements: 3_

- [ ] 5. Folders (`core/folders.ts`)
  - [ ] 5.1 `folderOf`, `deriveFolders` (root plus every ancestor, sorted by code point).
  - [ ] 5.2 **P4 property test**: for generated path lists, every file's folder is in the list; every non-root folder's parent is in the list; each parent chain reaches the root without repeats; exactly one root; no folder without files beneath it.
  - _Requirements: 4_

- [ ] 6. History analysis (`core/history.ts`)
  - [ ] 6.1 `analyseHistory`: per-file last commit and 30-day count with rename following; ghosts decided against `currentPaths` from the tree; deleting commit is the first removal event in log order; `lastExistingSha` is the first parent.
  - [ ] 6.2 Unit tests: rename then delete gives a ghost for the new name only; delete and re-add is current only; deleted twice gives the newer deletion; out-of-order dates; a file renamed inside the 30-day window keeps its earlier commits in the count; commit outside the window is not counted; excluded paths never become ghosts.
  - [ ] 6.3 Shared generators in `test/arbitraries.ts`: random operation sequences over a small path pool, with a replay oracle that computes the expected current set.
  - [ ] 6.4 **P3 property test**: ghosts and current files are disjoint; ghost paths are unique; every ghost passes the filter.
  - _Requirements: 5, 8_

- [ ] 7. Knip parsing and config detection
  - [ ] 7.1 `core/knip-parse.ts`: current `issues[].files[]` shape, older `files: []` shape, error on garbage; unit tests including the sample from Knip's docs.
  - [ ] 7.2 `core/knip-config.ts`: `hasKnipConfig(treePaths, packageJsonText)`; unit tests for each config file name and for a `knip` key in `package.json`.
  - _Requirements: 6_

- [ ] 8. Assembly and serialisation
  - [ ] 8.1 `core/assemble.ts` (`assembleGraveyard`) and `core/serialise.ts` (`toJson`): sorting by code point, fixed key order, UTC ISO dates, two-space indent, trailing newline.
  - [ ] 8.2 **P2 property test, pure tier**: shuffled inputs give identical JSON strings; the result passes `validateGraveyard`; eulogies are all empty.
  - _Requirements: 9, 10.1_

- [ ] 9. I/O modules
  - [ ] 9.1 `io/git.ts`: `assertUsableRepo` (not a repo, bare, shallow), `resolveSnapshot`, `repoName`, `listTree`, `readBlobs`, `readLog`. All through `execFile` with argument arrays.
  - [ ] 9.2 `io/knip.ts`: build the command, handle exit codes (0 and 1 ok, 2 fails), pass `--config` when given, append the "dependencies not installed" advice to every failure message.
  - [ ] 9.3 `io/write-output.ts`: temp file in the target directory, rename, clean up on error, create parent directories.
  - [ ] 9.4 Integration tests against temp repos from `make-repo.ts`: shallow clone rejected, non-repo rejected, tree listing skips submodules and symlinks, write is atomic. Knip is replaced by a stub.
  - _Requirements: 1, 3, 6, 9.5_

- [ ] 10. Pipeline and CLI
  - [ ] 10.1 `pipeline.ts`: the ten steps from the design; nothing is written until validation passes; warn on stderr when `hasKnipConfig` is false and no `--knip-config` was given.
  - [ ] 10.2 `cli.ts` with `util.parseArgs`: `--out`, `--analysed-at`, `--knip-config`; exit codes 0, 1, 2; default output name.
  - [ ] 10.3 Tests: each failure path leaves no output file; `--knip-config` that does not exist exits 1 before Knip runs.
  - _Requirements: 1, 6.7, 6.8, 9_

- [ ] 11. End-to-end property tests
  - [ ] 11.1 **P2 end-to-end**: build a fixture repo, run the pipeline twice with the same `--analysed-at` and a stub Knip, compare bytes.
  - [ ] 11.2 **P5 property test**: generated scripted histories (including branches and merges) become real temp repos; for every ghost, `git ls-tree <lastExistingSha> -- <path>` returns the path (the required assertion); `lastExistingSha` equals `git rev-parse <deletedInSha>^1`; the blob content equals the last content written. About 25 runs.
  - _Requirements: 8.4, 9.1_

- [ ] 12. README and checkpoint
  - [ ] 12.1 `analyser/README.md`: usage and flags; the decay rules and the hot threshold constant; the Knip configuration advice (use the repo's `knip.json` or `--knip-config`, why, and the warning); known limitations (merge-commit-only edits such as conflict resolutions are missed, rename detection is heuristic, any `build`/`out` directory is excluded); the dependency-install requirement.
  - [ ] 12.2 Checkpoint. **Run:** `cd analyser && npm run typecheck && npm test`. Fix failures before moving on.
  - _Requirements: 6.8, 7.5_
