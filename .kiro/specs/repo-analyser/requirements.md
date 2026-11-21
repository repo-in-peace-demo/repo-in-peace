# Requirements: Repo analyser

## Introduction

The repo analyser is a TypeScript command-line tool in `analyser/`. It reads a local git clone of a JavaScript/TypeScript repository and writes one graveyard data file (JSON) describing every current file, every folder, and every deleted file (ghost). The frontend loads this file and never calls the GitHub API.

The schema lives once in `shared/` and is versioned. Scoring and data shaping are pure functions kept separate from git and Knip I/O, so they can be property-tested.

## Glossary

- **Snapshot commit**: the commit the analysis describes. Defaults to the clone's `HEAD`.
- **Snapshot date**: the committer date of the snapshot commit. Every time-based value is computed relative to it, never the current clock.
- **Current file**: a JS/TS file present in the snapshot commit's tree.
- **Ghost**: a JS/TS file that exists somewhere in the snapshot commit's history but not in its tree.
- **Month**: for scoring, 30 days. By default 3 months = 90 days and 12 months = 360 days. Fixed day counts keep results deterministic.
- **Decay thresholds**: the five numbers that turn a file's age and commit count into a state, a score, and a hot flag: `staleAfterDays` (default 90), `ancientAfterDays` (default 360), `decayCapDays` (always 2 × `ancientAfterDays`), `hotCommits` (default 5), `hotWindowDays` (default 30). They are set with command-line flags and recorded in the data file.
- **Graveyard data file**: the JSON output.

## Requirements

### 1. Command-line interface

**User story:** As a developer, I run one command against a local clone and get a graveyard file.

1. WHEN invoked with a path to a git clone THE analyser SHALL analyse that clone and write the graveyard data file.
2. WHEN an output path is given THE analyser SHALL write to it. OTHERWISE it SHALL write to `<repo-name>.graveyard.json` in the current working directory.
3. IF the path does not exist, is not a git repository, or is a shallow clone THEN THE analyser SHALL exit non-zero with a message naming the problem, and SHALL NOT write an output file. (A shallow clone lacks the history that ghosts and last-commit dates need.)
4. THE analyser SHALL read only from the local clone. It SHALL NOT call the GitHub API or any other network service. (Amended by the eulogies spec, Req 1.5: with `--eulogies`, and only then, it MAY call the Ollama server given by `--ollama-url`, which must be on this machine, with a model that runs locally. Nothing else.)
5. THE analyser SHALL NOT modify the clone, including its working tree, index, and branches.
6. WHERE an optional `--analysed-at <ISO timestamp>` is given THE analyser SHALL use it as the analysis timestamp. OTHERWISE it SHALL use the current clock, read once at the command-line edge and passed into the pure pipeline.
7. WHERE an optional `--knip-config <path>` is given THE analyser SHALL use it as Knip's configuration file (see Requirement 6).
8. WHERE `--knip-dir <folder>` is given, once or several times, THE analyser SHALL run Knip in each named folder of the clone instead of the clone root (see Requirement 6).
9. THE analyser SHALL accept `--stale-after <days>` (default 90), `--ancient-after <days>` (default 360), `--hot-commits <n>` (default 5), and `--hot-window <days>` (default 30), which set the decay thresholds (see Requirement 7). WHEN none is given THE analyser SHALL use the defaults, and its output SHALL be the same as before these options existed, apart from the new metadata fields, the schema version, and the rename of `commitsLast30Days` to `recentCommits` (same values).
10. IF any of these four values is not a positive whole number, or `--ancient-after` is not greater than `--stale-after` (counting a default for an omitted one), THEN THE analyser SHALL exit non-zero before reading the clone, with a message that names the flag, the value it got, and what is required, and SHALL NOT write an output file.

### 2. Shared schema

**User story:** As the frontend author, I want one versioned schema so the analyser and the frontend cannot drift apart.

1. THE schema types and a `SCHEMA_VERSION` constant SHALL be defined in one module under `shared/`, and the analyser SHALL import them from there.
2. THE graveyard data file SHALL contain repo metadata: repo name, snapshot commit SHA, snapshot date, analysis timestamp, schema version (2), and the decay thresholds used (`thresholds`: `staleAfterDays`, `ancientAfterDays`, `decayCapDays`, `hotCommits`, `hotWindowDays`), so a reader can show the real values.
3. THE graveyard data file SHALL contain a list of folders, each with its path and parent path (the repo root has no parent).
4. THE graveyard data file SHALL contain a list of current files, each with: path, folder, lines of code, last commit date, last commit author, commits in the hot window before the snapshot (`recentCommits`; the window is `meta.thresholds.hotWindowDays`, 30 by default), unused flag, decay score, decay state (`fresh` | `stale` | `ancient`), hot flag, and an eulogy field set to an empty string.
5. THE graveyard data file SHALL contain a list of ghosts, each with: path, deleting commit SHA, deletion date, deleting author, and last existing commit SHA.
6. All dates SHALL be ISO 8601 strings in UTC.
7. THE shared module SHALL provide a validation function that checks an unknown value against the schema, so the analyser can verify its own output before writing. It SHALL reject thresholds that are not positive whole numbers, an `ancientAfterDays` not greater than `staleAfterDays`, and a `decayCapDays` that is not 2 × `ancientAfterDays`.

### 3. File discovery

**User story:** As a maintainer, I want the graveyard to cover the JS/TS source I care about and nothing else.

1. THE analyser SHALL list current files from the snapshot commit's tree (`git ls-tree`), not from the working directory. Only files git tracks at the snapshot count, so ignored and generated files never appear.
2. THE analyser SHALL include only files with the extensions `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`.
3. THE analyser SHALL exclude any path with a directory segment named `node_modules`, `dist`, `build`, `coverage`, `.next`, or `out`, even when git tracks it, and declaration files ending in `.d.ts`, `.d.mts`, `.d.cts`. Because the match is on any segment, a source folder that happens to be named `build` or `out` is also excluded.
4. THE analyser SHALL use forward-slash, repo-relative paths everywhere.
5. Lines of code SHALL be the number of non-blank lines in the file's content at the snapshot commit, read from git. A line is blank when it is empty or contains only whitespace. An empty file has zero lines of code.

### 4. Folders

**User story:** As the frontend, I need the crypt hierarchy.

1. THE folder list SHALL contain the repo root (path `""`, no parent) and every ancestor directory of every current file.
2. THE folder list SHALL contain no folder that has no current files in it or beneath it.
3. Every current file's `folder` SHALL be the path of its immediate parent directory and SHALL appear in the folder list.
4. Every folder other than the root SHALL name a parent that appears in the folder list, and following parents SHALL always reach the root without revisiting a folder.

### 5. Per-file history

**User story:** As a maintainer, I want accurate last-touched facts for each file.

1. For each current file THE analyser SHALL record the date and author name of the most recent commit reachable from the snapshot commit that changed the file.
2. THE analyser SHALL count commits that changed the file with a commit date after (snapshot date − 30 days) and at or before the snapshot date.
3. History SHALL follow renames, so a renamed file keeps its earlier history. (See Open question 1 for how this interacts with ghosts.)

### 6. Unused detection

**User story:** As a maintainer, I want files Knip flags as unused marked.

1. THE analyser SHALL run Knip against the clone using its JSON reporter and mark a current file `unused` when Knip lists it under unused files.
2. THE analyser SHALL parse Knip's output in a pure function that takes the JSON text and returns a set of repo-relative paths.
3. Files Knip does not list SHALL have `unused: false`.
4. IF Knip fails to run or its output cannot be parsed THEN THE analyser SHALL exit non-zero, SHALL print the Knip error, and SHALL NOT write an output file. (Silently reporting everything as used would produce false facts.)
5. EVERY Knip failure message SHALL also state the most likely cause and fix: the repository's dependencies are probably not installed in the clone, and the user should install them themselves and run the analyser again. THE analyser SHALL NOT run `npm install` or any install command. The one exception is a failure where Knip itself reports that it cannot find a `package.json`: that message SHALL suggest `--knip-dir` and SHALL NOT suggest installing dependencies.
6. "Unused" means files Knip reports as unused, and nothing else. Unused exports, types, and dependencies are not read.
7. THE analyser SHALL run Knip from the clone so that Knip finds and uses the repository's own Knip configuration. WHERE `--knip-config <path>` is given THE analyser SHALL pass that file to Knip instead. IF the given file does not exist THEN THE analyser SHALL exit non-zero before running Knip.
8. IF the clone has no Knip configuration (no Knip config file in the snapshot tree and no `knip` key in its `package.json`) and no `--knip-config` is given THEN THE analyser SHALL print a warning to stderr that Knip may flag test files, scripts, and tool configs as unused. The run continues. The analyser README SHALL document this. With `--knip-dir`, the check is made in each folder Knip runs in.
9. WHERE `--knip-dir <folder>` is given, once or several times, THE analyser SHALL run Knip once in each named folder instead of the clone root, prefix every path Knip reports with its folder, and merge the results. Prefixed paths are repo-relative, so they match current-file paths. Folders are relative to the clone root and SHALL stay inside it. Without the option, Knip runs in the clone root.
10. BEFORE running Knip THE analyser SHALL check that the snapshot tree has a `package.json` in every folder Knip will run in. IF any is missing THEN THE analyser SHALL exit non-zero before running Knip, name the missing folders, list every folder of the clone that contains a `package.json` (outside `node_modules`), suggest `--knip-dir` with a folder from that list, and SHALL NOT suggest installing dependencies.

### 7. Decay rules

**User story:** As a user, I want one consistent, explainable measure of how dead a file is.

Let `ageDays` be the whole days between the file's last commit date and the snapshot date, never negative. Let `t` be the decay thresholds in force (Requirement 1.9; defaults 90, 360, 720, 5, 30).

1. Decay state SHALL be `fresh` when `ageDays < t.staleAfterDays`, `stale` when `t.staleAfterDays ≤ ageDays ≤ t.ancientAfterDays`, and `ancient` when `ageDays > t.ancientAfterDays`. With the defaults this is `< 90`, `90 to 360`, and `> 360`.
2. Decay score SHALL be a number in `[0, 1]` computed by a pure function of `ageDays`, `unused` and `t`. It SHALL combine an age component, which grows until `ageDays` reaches `t.decayCapDays` (2 × `t.ancientAfterDays`), and an unused bonus, with the unused bonus weighted strongly: an unused file with `ageDays = 0` SHALL score higher than any used file. The weights stay fixed (0.4 for age, 0.6 for unused); the exact formula is in the design doc.
3. Decay score SHALL be non-decreasing in `ageDays` for fixed `unused` and `t`, and a file with `unused = true` SHALL never score lower than the same file with `unused = false`.
4. WHILE a file is `stale` its score SHALL reflect moss growth: score increases with age across the stale range (this is what the frontend renders as more moss). Scores are rounded to 4 decimals, so the score rises on every day of age when `t.decayCapDays` is at most 2000, and may repeat on adjacent days when it is larger.
5. A file is `hot` WHEN its commit count in the `t.hotWindowDays` days before the snapshot is at least `t.hotCommits`. The defaults (5 commits, 30 days) are named constants, documented in the design doc and in the analyser README.
6. Decay state, score, and hot flag SHALL depend only on data from the clone, the snapshot date, and the thresholds, never the current clock.
7. THE thresholds SHALL be set only through the flags of Requirement 1.9. `t.decayCapDays` is always 2 × `t.ancientAfterDays` and has no flag of its own.
8. THE thresholds in force SHALL be written to `meta.thresholds` (Requirement 2.2).

### 8. Ghosts

**User story:** As a maintainer, I want to see lost files and be able to restore them exactly.

1. THE set of current files SHALL be exactly the paths `git ls-tree -r` lists at the snapshot commit after the Requirement 3 filters. History order SHALL NOT decide whether a path is current.
2. THE analyser SHALL list as a ghost every path that appears anywhere in history reachable from the snapshot commit, passes the same Requirement 3 filters, is not in the current set, and whose most recent removal is a deletion. A path whose most recent removal is a rename away is not a ghost.
3. For each ghost THE analyser SHALL record the most recent commit that deleted the path (the first one in `git log --topo-order` output), its date, and its author name.
4. For each ghost THE analyser SHALL record the last existing commit: the first parent of its most recent deleting commit. THE path SHALL exist in that commit's tree, and restoring the file from that commit SHALL yield its last content byte for byte.
5. IF a path was deleted and later re-added so that it is a current file THEN it SHALL appear only among current files.
6. THE ghost list SHALL contain one entry per path.

### 9. Determinism and output

**User story:** As a developer, I want the same snapshot to always give the same file.

1. Given the same clone, snapshot commit, Knip result, and analysis timestamp THE analyser SHALL produce byte-identical output.
2. THE analyser SHALL sort folders, files, and ghosts by path (code-point order) and write object keys in a fixed order.
3. THE analyser SHALL write JSON with two-space indentation and a trailing newline.
4. THE analyser SHALL validate its output against the shared schema before writing, and SHALL exit non-zero without writing if validation fails.
5. THE analyser SHALL write the file atomically (temp file then rename) so a failed run never leaves a partial file.

### 10. Architecture and testability

1. Scoring (`decay.ts`), folder derivation, Knip output parsing, ghost derivation, and assembly of the final data object SHALL be pure functions with no file, process, git, or clock access.
2. Git and Knip I/O SHALL live in separate modules that return plain data to the pure functions.
3. Tests SHALL sit beside the modules (`decay.test.ts`, `decay.property.test.ts`, and so on).

## Correctness properties

Each property gets a fast-check property test.

| # | Property | Covers |
| --- | --- | --- |
| P1 | For fixed `unused` and any valid thresholds, decay score never decreases as time since last commit increases. | Req 7.2, 7.3, 7.4 |
| P2 | Running the analyser twice on the same snapshot (same Knip result and analysis timestamp) produces identical output. | Req 9.1, 9.2, 9.3 |
| P3 | No ghost path also appears among the current files. | Req 8.1, 8.4, 8.5 |
| P4 | Every file's folder exists in the folder list, and the folder hierarchy has no cycles. | Req 4 |
| P5 | Every ghost's last existing commit (the first parent of its most recent deleting commit) contains that file. | Req 8.4 |
| P6 | With default thresholds, the output equals what the analyser wrote before thresholds were configurable, apart from `meta.thresholds`, the schema version, and the field `commitsLast30Days` being renamed `recentCommits` with the same values. | Req 1.9 |
| P7 | For any valid thresholds, a file's decay state agrees with its age: `fresh` below `staleAfterDays`, `stale` from `staleAfterDays` up to and including `ancientAfterDays`, `ancient` only above it (so a file exactly `ancientAfterDays` old is still stale). | Req 7.1 |

Notes on how they are tested:

- **P1, P3, P4** run on pure functions with generated inputs.
- **P2** runs the pure assembly over generated history records, and also once end to end against a small fixture repo built in a temp directory.
- **P5** runs against generated git histories built in temp repos: the test commits random add/modify/delete sequences, runs the analyser's git module, and checks with `git cat-file` / `git ls-tree` that each ghost's last existing commit holds the file and that its content matches the file's last content.
- **P6** compares the pipeline's output on a fixed repository with `test/golden/default-thresholds.json`, written by the analyser before this change (with the one field renamed from `commitsLast30Days` to `recentCommits`; the values are unchanged), and checks the new decay functions against a frozen copy of the old formulas for random inputs. **P7** runs on the pure functions and on whole assembled outputs.
- Properties P1 to P5 run with random valid thresholds as well as random histories.
- Supporting properties (not in the required five, added because they follow directly from the rules): decay state boundaries match Requirement 7.1 for any `ageDays`; `unused = true` never lowers the score.

## Out of scope

- Generating eulogies. A later spec fills the field; this spec writes an empty string.
- Anything in the frontend.
- Calling the GitHub API. Everything comes from the local clone.
- Languages other than JavaScript/TypeScript.
- Installing dependencies in the analysed repo.

## Open questions for review

1. **Renames.** With rename-following, a file renamed in history has its old path as a deleted path. Should that old path be a ghost? Proposed: no. A path whose content continues under a new name is not dead, so ghosts exclude paths removed by a rename. The cost is more complex git parsing (`--name-status -M`). The alternative is to treat renames as delete plus add, which is simpler but shows false ghosts.
2. **Hot threshold of 5** commits in 30 days is a first guess. It is a constant and easy to change after seeing the demo repo.
3. **Analysis timestamp.** It is the only value not derived from the snapshot, so P2 holds only for a fixed timestamp. Proposed: the `--analysed-at` option above. The alternative is to drop the field's variability by defaulting it to the snapshot date, which changes the meaning of the field.
4. **Knip failure aborts the run.** The alternative is to continue with `unused: false` and a warning, which is easier to use but marks possibly dead files as alive.
5. **Merge commits and branches.** Proposed: history is everything reachable from the snapshot commit, using `--first-parent` off, with merge commits ignored for per-file change detection.
