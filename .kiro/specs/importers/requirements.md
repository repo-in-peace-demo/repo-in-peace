# Requirements: Importers

## Introduction

Today a stone says only "Used" or "Unused (Knip)". This spec records **who imports each file**, and shows it in the detail panel: "Imported by 3 files", each importer a link that flies to its stone. It also names **entry points** (files a framework or tool loads, such as a Next.js page), and the case the graveyard most needs to show: a file Knip calls unused that is still imported, but only by other unused files (a dead chain).

The work splits as before: the import graph (finding import specifiers, resolving them, reversing the map, classifying entry points) is pure and property-tested on generated graphs; reading the clone's files and its tsconfig is thin I/O.

## Glossary

- **Analysed files**: the files the graveyard shows, exactly as today (`isTrackedSourcePath`, at the snapshot commit, across the clone and every `--knip-dir` folder).
- **Import**: a static `import … from`, an `export … from`, an `import('…')` with a string literal, or a `require('…')` with a string literal, in an analysed file, that resolves to another analysed file.
- **Type-only import**: `import type …`, `export type … from`, or an import whose named bindings are all `type`. It counts as an import, and is marked.
- **Importers** of a file: the analysed files with an import that resolves to it.
- **Entry point**: an analysed file loaded by a framework or tool rather than imported (Req 3).
- **Disagreement**: a case where Knip's verdict and the graph don't fit together (Req 5).

## Requirements

### 1. Finding imports

1. THE analyser SHALL read every analysed file's contents at the snapshot commit (as it does for line counts) and find its imports: static imports, `export … from` re-exports, `import()` with a string literal and `require()` with a string literal. Imports with a non-literal specifier SHALL be counted in the analyser's report, and not followed.
2. A type-only import SHALL be marked as such (Glossary).
3. Imports in comments and strings SHALL NOT count (the files are parsed, not searched).

### 2. Resolving them

1. EACH specifier SHALL be resolved with the TypeScript compiler's module resolution, using the tsconfig that applies to the importing file (the nearest `tsconfig.json` or `jsconfig.json` above it within the clone, with its `extends`, `baseUrl` and `paths`), so aliases like `@/lib/x` resolve as the project's build does.
2. A specifier that resolves to an analysed file SHALL be an import of that file. One that resolves to a package, a file outside the analysed set (a `.d.ts`, generated output, `node_modules`), or nothing SHALL be ignored, and counted in the report.
3. Resolution SHALL use the snapshot commit's tree for the clone's own files (so an uncommitted change can't alter the graph) and the clone's installed `node_modules` only to tell a package from a missing file.
4. THE graph SHALL be deterministic: the same snapshot and flags give the same map, byte for byte (P4).

### 3. Entry points

1. A file SHALL be an entry point when a framework or tool loads it, with a kind and a short label:
   - **framework:** Next.js App Router files (`page`, `layout`, `template`, `route`, `loading`, `error`, `global-error`, `not-found`, `default` under an `app/` folder), Pages Router files (under `pages/`), and `middleware` ("Next.js route", "Next.js page", "Next.js layout", "Next.js middleware"…); and any file named by a `<script type="module" src>` in an `index.html` of the clone ("Vite entry").
   - **config:** `*.config.*` files and other known tool configs ("Vite config", "Tailwind config"…).
   - **test:** `*.test.*`, `*.spec.*`, and files under `__tests__/` ("test").
2. Entry-point detection SHALL NOT change whether a file is unused: that stays Knip's verdict.

### 4. The data file

1. EACH file SHALL gain two optional fields: `importedBy` (the importers' paths, sorted, each with `typeOnly: true` when every import from it is type-only) and `entry` (`{ kind, label }`). `importedBy` SHALL be present (possibly empty) for every file when the graph was built, and absent in older files.
2. THE schema SHALL stay at version 2, and older files SHALL still load. The fields SHALL be written by default; the golden test SHALL be updated deliberately, and its diff SHALL add only these fields.
3. THE eulogy inputs SHALL NOT change (the prompt's facts and wording, and the shared vocabulary rules it uses), so regenerating a demo with `--eulogies` reuses the cache and makes no model calls.

### 5. Disagreements

1. THE analyser SHALL report, in its output (stderr) and as a count, without changing the data:
   - an **unused** file (Knip) with an importer that is **used**: Knip and the graph disagree;
   - a **used** file that is **not an entry point** and has **no importers**: something loads it that neither knows about.
2. EACH line SHALL name the file and, for the first kind, the used importer. At most 20 of each are listed, then a count.

### 6. The detail panel

1. THE Usage row SHALL say what the data shows, using `importedBy` and `entry` when present (an older file keeps today's wording):
   - used and imported: "Imported by 3 files", then the first 5 importers (file name, folder dimmed), each a link that selects its stone and flies to it, then "+N more", which shows the rest;
   - an entry point: "Entry point: loaded by Next.js (route)", then its importers if it has any;
   - unused, no importers: "Unused: nothing in the project imports it (Knip)";
   - unused, imported only by unused files: "Unused: only imported by other unused files", then those importers as links (the dead chain).
   - imported only by test files: the wording follows Knip's verdict, so the panel never contradicts the stone: used, "Used only by tests"; unused, "Unused: only imported by tests". Then the tests as links.
2. A type-only importer SHALL say so ("type only"), dimmed.
3. THE hover summary SHALL add "imported by N" only when the whole line still fits on one line (the hover label's existing width), and stay as it is otherwise.
4. Everything SHALL be text and links built from the data file; the legend SHALL NOT change.

## Correctness properties

| # | Property | Covers |
| --- | --- | --- |
| P1 | On generated import graphs, every path in `importedBy` is an analysed file, and the map is exactly the reverse of the forward imports (with type-only marked when, and only when, every import between the pair is type-only) | 1, 2, 4.1 |
| P2 | An unused file's importers are all unused, or the pair is reported as a disagreement; nothing is dropped silently | 5 |
| P3 | A used file that isn't an entry point has an importer, or is reported | 5 |
| P4 | The same snapshot gives the same map and the same entry points, whatever order files are read in | 2.4 |
| P5 | Clicking an importer in the panel selects that file and flies to it (browser check) | 6.1 |
| P6 | With the graph added, the eulogy cache keys of the demos' graves are unchanged | 4.3 |

## Out of scope (backlog)

- Imports from non-JS files (`.vue`, `.svelte`, `.mdx`, CSS `@import`).
- Showing what a file imports (the forward list), or drawing the graph in the scene.
- Unused exports.

## Open questions for review

1. **`typescript` as a runtime dependency.** It is a dev dependency of the analyser today, but Knip already needs it (a peer dependency), so it is installed whenever the analyser runs. I'd move it to `dependencies` to say so honestly; no new package. Agreed?
2. **Snapshot or working tree.** Knip runs on the clone's working tree; the rest of the analysis reads the snapshot commit. I'd resolve against the snapshot's tree (Req 2.3), so the graph matches the stones, and report when the working tree differs (that also explains some Knip disagreements). Agreed?
3. **Entry points beyond your list.** I added Vite's `index.html` scripts (spatialql's `src/index.ts` is loaded that way, and would otherwise be reported in Req 5.1), Next.js `template`, `default`, `global-error` and the Pages Router. Also `package.json` `main`/`bin`/`exports`? I'd include `main` and `bin` as "package entry". Agreed?
4. **Test files as entry points.** Test files are entry points of kind `test`, so a test that nothing imports is not reported. But a test file is often the only importer of an unused helper: should "only imported by tests" be its own Usage wording ("Unused: only imported by tests")? I'd say yes; it's a common dead-code case.
5. **"+N more"** expands in place (the panel scrolls, with the bottom fade), rather than opening the list view filtered. Fine?
6. **Hover "fits".** Measured, as the search placeholder is: the full line with "· imported by N" is used only if it fits the label's maximum width. Fine?
7. **Re-exports.** An `index.ts` that re-exports `./x` is an importer of `x`, and its own importers are importers of the index, not of `x` (no flattening through barrels). The panel then shows the barrel as `x`'s importer. Flatten later if it reads badly?

## Decisions

Reviewed and approved, with the recommended answer to each open question:

1. `typescript` moves to the analyser's `dependencies` (Knip already needs it).
2. Resolution uses the snapshot commit's tree; a working tree that differs is reported.
3. Entry points also include Vite `index.html` module scripts, Next.js `template`, `default`, `global-error`, the Pages Router, and `package.json` `main` and `bin` ("package entry").
4. Files imported only by tests: the wording follows Knip's verdict (Req 6.1): "Used only by tests" when Knip says used, "Unused: only imported by tests" when it says unused.
5. "+N more" expands in place.
6. The hover adds "imported by N" only if the measured line fits.
7. Barrels are not flattened: a re-exporting `index.ts` is the importer.
