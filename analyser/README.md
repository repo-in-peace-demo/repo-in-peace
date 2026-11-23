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

The eulogy flags, `--eulogies-from` among them, are in [Eulogies](#eulogies).

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

## Who imports what

Every file in the data has `importedBy`: the files in the graveyard that import it, sorted by path, each marked `typeOnly` when every import between the two is type-only (`import type`, `typeof import()`). A file that is loaded rather than imported also has `entry`, a kind and a short label. The detail panel shows both under Usage.

- **What counts as an import:** static imports and re-exports, `import x = require()`, `import()` and `require()` with a string literal. TypeScript's own parser reads them, and TypeScript's resolver (installed with the analyser) finds the file, with the nearest `tsconfig.json` or `jsconfig.json` (its `paths`, `baseUrl` and `extends`), or Bundler resolution with JS allowed when there is none. A specifier built at run time (`import(name)`) is counted but not followed.
- **Read from the snapshot**, like everything else: the files and configs are those of the commit, not the working tree. `node_modules` is read from disk, so a package is told apart from a missing file. If analysed files have uncommitted changes, the analyser warns and still reads the snapshot.
- **Not counted:** imports of packages, of tracked files outside the graveyard (build output, declaration files, stylesheets and other file types) and of files that don't exist (or that TypeScript can't place, such as Vite's `virtual:` modules or a stylesheet through an alias). The summary line counts each kind, for example `Import graph: 412 imports among 129 files; 230 to packages, 18 outside the analysed files, 0 unresolved, 0 non-literal; 31 entry points.`
- **Barrels are not flattened:** a file imported through an `index.ts` that re-exports it is imported by that `index.ts`.

**Entry points**, the first rule that matches:

| Kind | Files | Label |
| --- | --- | --- |
| test | `*.test.*`, `*.spec.*`, anything under `__tests__` | test |
| framework | Next.js App Router files under an `app` folder (not under `components` or `lib`): `page`, `layout`, `template`, `route`, `loading`, `error`, `global-error`, `not-found`, `default` | Next.js page, Next.js layout, … |
| framework | Next.js Pages Router files under a `pages` folder (not under `components` or `lib`), `pages/api` among them | Next.js page, Next.js API route |
| framework | `middleware` at the root, one folder down, or under `src` | Next.js middleware |
| framework | a `<script type="module" src>` in an `index.html` | Vite entry |
| package | a `package.json`'s `main` or `bin` | package entry |
| config | the configs of known tools, by name: Vite, Vitest, Next.js, Tailwind, PostCSS, Drizzle, ESLint, Prettier, Jest, Playwright, Knip, Babel, webpack, Rollup, tsup, Astro, Nuxt, Svelte, Remix, Cypress, Stylelint, commitlint and lint-staged (`vite.config.ts`, `.eslintrc.cjs`, `knip.ts`, …), and the Vitest and Jest setup files | Vite config, ESLint config, … |

Any other file named `*.config` (`auth.config.ts`) is ordinary code: it is used if something imports it.

**Where Knip and the graph disagree.** The data always follows Knip: `unused` is Knip's verdict. The analyser lists, 20 of each at most, the unused files that a used file imports, and the used files that nothing imports and that aren't entry points. These usually mean a dynamic or framework load the graph can't see, or a Knip config that misses an entry. Nothing changes in the data because of them.

## What counts as a source file

Files git tracks at the snapshot, with the extensions `.js .jsx .mjs .cjs .ts .tsx .mts .cts`, excluding `.d.ts`-style declaration files and anything under a directory named `node_modules`, `dist`, `build`, `coverage`, `.next` or `out`. Lines of code are non-blank lines. Ghosts follow the same rules, so the graveyard never shows a ghost for something it would not show alive.

## Eulogies

With `--eulogies`, a language model on your own machine writes a two-sentence epitaph for every grave, and the detail panel shows it with the model's name. Without the flag nothing changes: no request is made and the output is byte for byte what it was.

### Install Ollama and a model

The analyser talks to [Ollama](https://ollama.com), which runs models locally.

```
curl -fsSL https://ollama.com/install.sh | sh     # macOS or Linux; or download the app from ollama.com/download
ollama serve                                      # not needed if the Ollama app is running
ollama pull qwen2.5:7b                            # or another model, see below
```

**There is no default model**, so pick one. What to weigh:

- **Following instructions** matters most. The eulogy must be two sentences, plain text, about the file, in the tone its facts call for, with no code, links or names. A model that ignores this has its answers rejected.
- **Size and speed.** A grave is one short request. A 3–4B model is quick on most laptops. A 7–8B model writes better but is slower, and wants about 8 GB of free memory.
- **Examples** to start from: `qwen2.5:7b` (4.7 GB), `qwen2.5:3b` (1.9 GB), `llama3.2:3b`, `gemma3:4b`. Sizes for others are on [ollama.com/library](https://ollama.com/library). Reasoning models (those that "think" first) work too: the analyser asks them to skip the reasoning, and removes any `<think>` block they write anyway.
- **Not cloud models.** A model whose tag is `cloud` or ends in `-cloud` (`gemma4:cloud`) runs on Ollama's servers, so the analyser refuses it.

Then:

```
npm run analyse -- <path-to-clone> --out /tmp/repo.graveyard.json --eulogies --eulogy-model qwen2.5:7b
```

### Flags

| Flag | Meaning | Default |
| --- | --- | --- |
| `--eulogies` | Write a eulogy for every grave. | off |
| `--eulogy-model <name>` | The Ollama model. Needed with `--eulogies`. | none |
| `--ollama-url <url>` | The Ollama server. Its host must be `localhost`, `127.0.0.1` or `[::1]`. | `http://localhost:11434` |
| `--eulogy-concurrency <n>` | Requests at a time, 1 to 4. | 2 |
| `--eulogy-cache <file>` | The cache of eulogies. Must be outside the clone. | `analyser/.cache/eulogies.json` |

The last four work only with `--eulogies`; given without it, they are an error, so a typo never quietly skips the eulogies.

### Keeping the eulogies of an earlier file

`--eulogies-from <file>` copies every grave's eulogy, and the model's name, from an earlier graveyard file of the same repository, matching files to files and ghosts to ghosts by path. No model is asked and the cache isn't used, so eulogies edited by hand, or written by an older prompt, are kept word for word. A grave the earlier file doesn't have gets none (the panel says "Words failed us for this one."), and the run lists them. The file may be the one `--out` writes. It is refused with `--eulogies`, when it isn't a valid graveyard file, when it has no eulogies, and when it is another repository's (`meta.name` differs).

```
npm run analyse -- <path-to-clone> --out ../frontend/public/graveyards/<name>.graveyard.json --eulogies-from ../frontend/public/graveyards/<name>.graveyard.json
```

### What is sent, and where

Everything goes to the Ollama server on this machine and nowhere else. For each grave the model sees:

- the path and file name;
- for a file: its state and flags in the legend's words, its size, and its last commit's subject;
- for a ghost: the day it was deleted and the deleting commit's subject;
- the contents (for a ghost, as it was in its last commit), cut to the first 4 KB at a line break. A binary or empty file is marked as such instead.

Only commit subjects are sent, never commit bodies. Every author's name, e-mail and handle from the history is replaced by "someone" in the subjects and contents, and a eulogy that names one is rejected. Commit authors still appear in the data file, as before.

### Tone

The model is told how each grave should sound, from its facts:

- **fresh and used:** alive and at work, never "forgotten", "silent" or "dormant";
- **stale or ancient, and used:** old but still serving;
- **unused:** may be mourned ("here lies");
- **a ghost:** departed.

Each grave also gets one of seven ways to begin, picked from its path, so the eulogies don't all open alike. There is no example eulogy in the prompt (the model copied one word for word), and no age: eulogies are time-agnostic.

### Time-agnostic

A eulogy never says how old a file is or when it changed. It is read long after the snapshot, so "last updated four days ago" would read as four days before today, and the detail panel already shows the real dates. The prompt asks for no dates or ages, and any sentence that states one anyway ("… ago", "17 days", "recently updated", "last changed…", "since time immemorial", a month's name) is dropped. If every sentence does, the eulogy is left empty.

### What gets rejected

Each answer is checked before it is kept. It is rejected if it contains code, an e-mail address, a URL, something that looks like a secret or key, or a person's name from the history. After tidying, it is also rejected if:

- a quote is left open, or the eulogy opens with a quote;
- its first sentence alone is longer than 240 characters;
- it contradicts the grave's facts: a used file called "unused" (or "no longer used", "nothing imports it"), a file that isn't ancient called "ancient", a fresh, used file called forgotten, silent or dormant, or a file under a year old said to be years old ("for years", "for ages", "since time immemorial", "since ancient times");
- it copies an example from an earlier prompt (the "lantern keeper"), whole or five words in a row;
- it gives a number of days, weeks or months that isn't the file's age ("last updated 17 days ago" must be right within a day), or says "here lies" or "rest in peace" of a file that is still used;
- it echoes the prompt (`Age:`, `Last change:`, "Begin by…", "like a real grave") or copies eight words in a row from the file's contents. Negated words ("never forgotten") and words about something else ("unused imports", "ancient lore") are allowed.

A rejected answer is asked for once more; if the second is rejected too, that grave's eulogy is left empty, and the panel says "Words failed us for this one." Accepted answers are tidied: any `<think>` block, markdown, emoji, labels and wrapping quotes are removed, a file name written as a heading is dropped, lines the model broke inside a sentence are joined, sentences stating an age or a time are dropped, and the eulogy keeps the whole sentences that fit (two at most, 240 characters). It is never cut mid-sentence.

### The summary

```
Eulogies: 230 written, 15 from the cache, 6 left empty (4 rejected twice, 2 timed out).
  left empty: src/legacy/parser.ts (rejected twice (code))
```

- **written:** new eulogies from the model.
- **from the cache:** reused from an earlier run, with no request.
- **left empty:** `rejected twice` (both answers failed the checks; the reason in brackets is one of `code`, `url`, `secret`, `email`, `author`, `quotes`, `long`, `facts`, `example`, `prompt`, `contents`, `empty`), `timed out` (no answer in 60 s), `failed` (Ollama answered with an error), or `not run` (the run stopped early, below). The first 20 are listed with their reason.

A progress line (`Eulogies: 40/251 (12 from the cache)`) appears at most once a second.

### When the run stops

- **Ollama not running, or the model not installed:** the analyser stops before reading anything else, exits 1, and prints the command to run (`ollama serve`, or `ollama pull <model>` with the installed models listed).
- **Ollama stops answering:** after 5 failed requests in a row, no more are sent. The rest are left empty and the file is still written.
- **The model never follows the rules:** if the first 8 graves the model answered (in path order) were all rejected, the run stops with exit 1, writes no output and keeps nothing new in the cache. The message names the model. Try another one: usually a larger model, or one known for following instructions.

### The cache

New eulogies are saved in `analyser/.cache/eulogies.json` (ignored by git) every 25 eulogies and at the end. A second run on the same repository asks the model only about graves whose input changed, and about graves left empty last time (empty eulogies are not cached, so they get another try), and writes the same file byte for byte as long as the model answers the same way (with its fixed seed it does). The key is a hash of the model, the prompt version, the cleaning-rules version and everything the model is shown, so changing the model, the file or its last commit subject writes that grave again, and a new analyser version with a changed prompt or new rules writes every grave again. One cache serves every repository and model.

Delete the file to start again (`rm analyser/.cache/eulogies.json`). A damaged cache is reported and replaced. The model's sampling is fixed (temperature 0.2, seed 7), but a different Ollama version or machine can still word things differently, so keep the cache if you want the same words.

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
6. With the default thresholds, the output is what the analyser wrote before thresholds were configurable (`test/golden/default-thresholds.json`), once `importedBy` and `entry` are taken out; with them it is `test/golden/with-importers.json` (`GOLDEN_WRITE=1` rewrites it, on purpose only).
7. Decay state agrees with the thresholds.

The eulogies have their own properties (`.kiro/specs/eulogies/design.md`): the format of an accepted eulogy, the rejection of code, links, secrets and names, redaction, the cache key, isolation of one grave's failure, byte-identical output without the flag, and a re-run served from the cache. No test calls a real model: they use a fake client, or a fake Ollama server on 127.0.0.1.

The import graph has its own (`.kiro/specs/importers/design.md`): `importedBy` is exactly the reverse of the imports found, the disagreements reported are exactly the files that disagree, the result doesn't depend on the order files are read, and the eulogy input never sees the graph.

The end-to-end test builds real git repositories from random histories (renames, deletes, re-adds, out-of-order dates, merged side branches) and checks the whole pipeline against an independent model and against git itself.
