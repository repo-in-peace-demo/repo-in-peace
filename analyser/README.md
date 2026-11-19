# Repo In Peace analyser

Reads a local git clone of a JavaScript/TypeScript repository and writes one **graveyard data file** (JSON): every current source file with its age, size, author, decay and unused status, every folder, and every deleted file (a "ghost") with the commit needed to restore it. The frontend loads this file; nothing here calls the GitHub API.

The file's schema lives in [`../shared/graveyard-schema.ts`](../shared/graveyard-schema.ts) (version 2).

## Run it

```
cd analyser
npm install
npm run analyse -- <path-to-clone> --out /tmp/repo.graveyard.json
```

Before running, in the **clone** you want to analyse:

- It must be a full clone, not a shallow one (`git fetch --unshallow` fixes that).
- Install its dependencies yourself (`npm install` inside it), so Knip can resolve imports. The analyser never installs anything.
- The output file must be outside the clone. The analyser never changes the clone, so it refuses to write into it.

Progress and warnings go to stderr. Stdout stays empty.

## Options

| Flag | Meaning | Default |
| --- | --- | --- |
| `--out <file>` | Output file. | `<repo-name>.graveyard.json` in the current directory |
| `--analysed-at <timestamp>` | Analysis time, ISO 8601 with `Z` or an offset. Fix it to get byte-identical output across runs. | now |
| `--knip-config <file>` | Knip configuration to use instead of the clone's own. | the clone's own |
| `--knip-dir <folder>` | Run Knip in this folder of the clone instead of the clone root. Repeat for several folders. Each needs a `package.json`. | the clone root |
| `--stale-after <days>` | Fresh below this many days since the last commit; stale from here on. | 90 |
| `--ancient-after <days>` | Ancient after this many days. Must be greater than `--stale-after`. | 360 |
| `--hot-commits <n>` | Hot with this many commits in the hot window, or more. | 5 |
| `--hot-window <days>` | Length of the hot window before the snapshot. | 30 |
| `-h`, `--help` | Show the usage. | |

Exit codes: `0` success; `1` the analysis failed (the message says why and nothing is written); `2` the command line is wrong.

## Decay thresholds

All times are measured from the **snapshot commit date** (the date of `HEAD`), never from today, so the same snapshot always gives the same output.

**The demo uses the defaults** (90, 360, 5 commits in 30 days). Other values are for trying a repository out; the frontend legend reads the values actually used from `meta.thresholds`.

- **Fresh:** `age < --stale-after`
- **Stale:** `--stale-after ≤ age ≤ --ancient-after`
- **Ancient:** `age > --ancient-after`
- **Decay score** (0 to 1, 4 decimals): `0.4 × min(age, cap) / cap`, plus `0.6` when Knip flags the file unused. `cap` is `2 × --ancient-after` (720 by default). An unused file therefore always outranks a used one. The 0.4 and 0.6 are fixed.
- **Hot:** at least `--hot-commits` commits in the `--hot-window` days before the snapshot.

The edges are not symmetric: a file is stale *from* the stale limit and ancient only *after* the ancient limit, so with the defaults 89 days is fresh, 90 and 360 are stale, and 361 is ancient.

All four values must be positive whole numbers, and `--ancient-after` must be greater than `--stale-after` (a default counts if you leave one out). Otherwise the analyser stops before reading the clone and says which flag is wrong.

The file records what it was made with:

```json
"meta": { "...": "...", "schemaVersion": 2,
  "thresholds": { "staleAfterDays": 90, "ancientAfterDays": 360, "decayCapDays": 720, "hotCommits": 5, "hotWindowDays": 30 } }
```

`recentCommits` on each file counts commits in the hot window before the snapshot, which is 30 days unless you change `--hot-window`. (Schema version 1 called it `commitsLast30Days`.)

At very large thresholds (a decay cap above 2000 days, that is `--ancient-after` above 1000), neighbouring days can share a score, because scores are rounded to 4 decimals. A score never decreases as a file ages.

## Knip and unused files

"Unused" means files [Knip](https://knip.dev) reports as unused, nothing else (not unused exports or dependencies). Knip is installed with the analyser, so the analysed repo does not need it. The analyser runs it in the clone and reads the clone's own Knip config.

- **Without a Knip config** in the clone (a `knip.json`, `knip.ts`, or a `knip` key in `package.json`), Knip's defaults can flag test files, scripts and tool configs as unused, and the graveyard would mark live files as dead. The analyser warns you. Add a config to the clone, or pass `--knip-config`.
- **JS/TS in a subfolder** (for example a Python project with a web app in `app/`): Knip needs a `package.json` where it runs, so use `--knip-dir app`. If the clone root has none, the analyser stops before running Knip and lists every folder that has one.
- **If Knip fails**, the run stops and nothing is written. Usually the clone's dependencies are not installed: install them yourself and run again.
- **Security:** Knip loads the clone's config files (and its tools' config files, such as `vite.config.ts`), which runs the clone's code. Only analyse repositories you trust.

## What counts as a source file

Files git tracks at the snapshot, with the extensions `.js .jsx .mjs .cjs .ts .tsx .mts .cts`, excluding `.d.ts`-style declaration files and anything under a directory named `node_modules`, `dist`, `build`, `coverage`, `.next` or `out`. Lines of code are non-blank lines. Ghosts follow the same rules, so the graveyard never shows a ghost for something it would not show alive.

## Known limitations

- **Edits made only inside a merge commit** (conflict resolutions) are not seen, because `git log` shows no file changes for merges. The branch commits still carry the real changes.
- **Rename detection is git's heuristic** (50% similarity). A heavily rewritten rename can show as a delete plus an add, giving a false ghost.
- **A directory named `build` or `out` is excluded** wherever it is, even if it holds hand-written source.
- **A file that only arrived through a merge commit** has no commit in the log to date it, and stops the run with a message naming the file.
- **One snapshot per run**: the commit `HEAD` points to.
- **Workspaces are not detected.** Name each folder with `--knip-dir`.

## Tests

```
npm run typecheck
npm test
```

Pure logic (scoring, layout of the data, history) is separate from git and Knip so it can be property-tested with fast-check. The properties covered:

1. Decay score never decreases as a file ages, for any valid thresholds.
2. Running twice on the same snapshot gives identical output.
3. No ghost is also a current file.
4. Every file's folder exists, and the folder tree has no cycles.
5. Every ghost's last existing commit contains the file and restores it byte for byte.
6. With the default thresholds, the output is what the analyser wrote before thresholds were configurable (`test/golden/default-thresholds.json`).
7. Decay state agrees with the thresholds.

The end-to-end test builds real git repositories from random histories (renames, deletes, re-adds, out-of-order dates, merged side branches) and checks the whole pipeline against an independent model and against git itself.
