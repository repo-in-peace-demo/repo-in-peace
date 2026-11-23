# Design: Importers

References are to `requirements.md` in this folder. Decisions 1 to 7 there are settled.

## Overview

```
snapshot tree ─▶ analysed files ─▶ one cat-file batch: line count + imports (core/imports.ts, TypeScript's parser)
                                                         │
tsconfig/jsconfig + package.json + index.html blobs ─▶ resolver (io/resolve.ts, ts.resolveModuleName on a host backed by the tree)
                                                         │
                         core/import-graph.ts: forward edges ─▶ importedBy (reversed, sorted, type-only marked)
                         core/entry-points.ts: entry { kind, label }
                         core/disagreements.ts: Knip vs graph, reported on stderr
                                                         │
assemble ─▶ files gain importedBy, entry ─▶ serialise ─▶ data file (schema 2, optional fields)
frontend: model/usage.ts (pure) ─▶ DetailPanel Usage row with importer links; hover suffix when it fits
```

Pure parts take plain inputs and are property-tested on generated graphs; the only new I/O is the resolver's host, and it reads the snapshot's blobs (already read for line counts) and, for `node_modules`, the disk.

## Finding imports (`analyser/src/core/imports.ts`, pure)

```ts
interface ImportRef { specifier: string; typeOnly: boolean; kind: 'static' | 'reexport' | 'dynamic' | 'require' }
function findImports(path: string, text: string): { refs: ImportRef[]; nonLiteral: number };
```

- `ts.createSourceFile(path, text, ESNext, false, scriptKindOf(path))`, then a walk:
  - `ImportDeclaration`: type-only when `importClause.isTypeOnly`, or when it has only named bindings and every one is `isTypeOnly`. A bare `import './x'` is a static, value import.
  - `ExportDeclaration` with a `moduleSpecifier`: a re-export; type-only when `isTypeOnly`, or every specifier is.
  - `ImportEqualsDeclaration` with an external module reference (`import x = require('…')`).
  - `CallExpression` of `import(…)` or `require(…)` with one argument: a string literal or a no-substitution template is followed; anything else adds to `nonLiteral`.
- Comments and strings are never imports (the parser, not a search; Req 1.3).
- It runs inside the existing `mapBlobs` batch for line counts (the reduce returns `{ lines, imports }`), so contents are read once.

## Resolving (`analyser/src/io/resolve.ts`)

```ts
interface Resolver { resolve(fromPath: string, specifier: string): { to: string } | { ignored: 'package' | 'outside' | 'missing' } }
function snapshotResolver(clone: string, tree: TreeFile[], texts: ReadonlyMap<string, string>, analysed: ReadonlySet<string>): Resolver;
```

- **Which tsconfig:** for each importing file, the nearest `tsconfig.json` (or `jsconfig.json`) in its folder or above, within the clone, from the tree. Parsed once per config with `ts.parseJsonConfigFileContent`; `extends` is followed (a relative one from the tree; a package one, such as `next/tsconfig.json`, from the clone's `node_modules` on disk). A file with no config uses Node's resolution with `allowJs`.
- **The host** (`ts.ModuleResolutionHost`): `fileExists` and `directoryExists` answer from the snapshot tree for the clone's own paths, and from the disk for paths under `node_modules` (Decision 2); `readFile` returns the preloaded blob text (configs, `package.json`) or the disk for `node_modules`. One extra `mapBlobs` batch preloads every tracked `tsconfig*.json`, `jsconfig.json`, `package.json` and `index.html`.
- `ts.resolveModuleName(specifier, from, options, host)`, with a module resolution cache per config. The result:
  - an analysed file: an edge;
  - under `node_modules`, or an external library: `package`;
  - a tracked file that isn't analysed (a `.d.ts`, generated output): `outside`;
  - nothing: `missing`.
- **Working tree check** (Decision 2): `git status --porcelain --untracked-files=no -- <analysed paths>` (read-only, no locks). If any analysed file differs from the snapshot, one warning names the count and the first five, since Knip read those versions.

## The graph (`analyser/src/core/import-graph.ts`, pure, P1, P4)

```ts
interface Edge { from: string; to: string; typeOnly: boolean }
function buildEdges(imports: ReadonlyMap<string, ImportRef[]>, resolve: Resolver['resolve']): { edges: Edge[]; ignored: Record<'package' | 'outside' | 'missing', number> };
function importedByOf(edges: readonly Edge[], files: readonly string[]): Map<string, Array<{ path: string; typeOnly?: true }>>;
```

- Self-imports are dropped. Several imports between the same pair merge: the pair is type-only only when every one of them is.
- `importedByOf` gives every analysed file a list (empty when nothing imports it), sorted by code point; files iterated in sorted order, so the result doesn't depend on read order (P4).

## Entry points (`analyser/src/core/entry-points.ts`, pure)

```ts
type EntryKind = 'framework' | 'config' | 'test' | 'package';
function entryPointOf(path: string, context: { htmlScripts: ReadonlySet<string>; packageEntries: ReadonlySet<string> }): { kind: EntryKind; label: string } | undefined;
```

In this order (the first that matches):
- **test:** `*.test.*`, `*.spec.*`, under `__tests__/`: "test".
- **framework, Next.js:** under a folder named `app` (at any depth), a base name `page`, `layout`, `template`, `route`, `loading`, `error`, `global-error`, `not-found` or `default`: "Next.js page" / "Next.js layout" / "Next.js route" / …; under `pages/`: "Next.js page" (`_app`, `_document` too); `middleware` at a project root or in `src/`: "Next.js middleware".
- **framework, Vite:** a path named by a `<script type="module" src="…">` in any tracked `index.html`, resolved from that file's folder (a leading `/` from it too, as Vite does): "Vite entry".
- **package:** `main` and `bin` of each tracked `package.json`, resolved from its folder: "package entry".
- **config:** `*.config.*` and dotted configs (`.eslintrc.*`, `.prettierrc.*`): "Vite config", "Next.js config", "Tailwind config", "PostCSS config", "Vitest config", "Drizzle config", else "config".

`context` is built from the preloaded `index.html` and `package.json` texts (a small regex for the script tags; the JSON for the package fields).

## Disagreements (`analyser/src/core/disagreements.ts`, pure, P2, P3)

```ts
function disagreements(files: ReadonlyArray<{ path: string; unused: boolean; entry?: unknown }>, importedBy: ReadonlyMap<string, readonly { path: string }[]>, unused: ReadonlySet<string>): { usedImporters: Array<{ file: string; importer: string }>; unimported: string[] };
```

Logged after the graph, before the write, at most 20 each, then a count:
```
Import graph: 412 imports among 129 files; 61 to packages, 3 outside the analysed files, 2 unresolved, 1 non-literal.
Knip and the import graph disagree on 2 files (the data is written as Knip says):
  app/lib/x.ts is unused (Knip), but imported by app/lib/y.ts, which is used
Used files nothing imports and that aren't entry points (3): app/scripts/seed.ts, …
```

## The data file (`shared/graveyard-schema.ts`, `analyser/src/core/serialise.ts`)

```ts
interface FileEntry { …; importedBy?: Array<{ path: string; typeOnly?: true }>; entry?: { kind: 'framework' | 'config' | 'test' | 'package'; label: string } }
```

- **Validation:** `importedBy` an array of objects whose `path` is a file of the data (not itself), sorted, unique, `typeOnly` only `true` when present; `entry.kind` one of the four, `label` a non-empty string.
- **Order in the output:** after `hot`, before `eulogy`: `importedBy` (always, when built), then `entry` (only when there is one).
- **Golden test:** regenerated deliberately; the test that compares it also checks that dropping `importedBy` and `entry` gives the previous golden file byte for byte (`test/golden/default-thresholds.before-importers.json`, kept for that).

## The eulogies (Req 4.3, P6)

- `fileInput` builds the eulogy input from named fields only, so the new fields can't reach the prompt. P6: for random files, `fileInput` with and without `importedBy`/`entry` gives equal inputs, so equal cache keys.
- **A problem this exposes, and the fix I propose:** the committed demos can't be regenerated from the cache with no model calls, whatever this spec does. Their eulogies were written with prompt version 3 and cleaning version 4, then edited in place by the time-agnostic rule (cleaning 5, prompt 4); and the Unused rule's wording changed since. So no cache key matches, and `--eulogies` would ask the model for every grave and replace the words you have. The fix: a flag **`--eulogies-from <file>`** that copies each grave's eulogy (by path, files and ghosts) and `meta.eulogyModel` from an earlier data file of the same repository, with no model and no cache; graves not in it get `""` and are listed. That keeps the current, edited eulogies exactly, and makes the regeneration safe. It is a small addition beyond the brief; it needs your yes.

## The detail panel (`frontend/src/model/usage.ts`, pure; `ui/DetailPanel.tsx`)

```ts
type UsageView = { text: string; importers: Array<{ path: string; name: string; folder: string; typeOnly: boolean }>; shown: number } | { legacy: string };
function usageView(file: FileEntry, model: Pick<SceneModel, 'lookup' | 'stones'>): UsageView;
```

Wording, always following Knip's verdict (`file.unused`), so the panel never contradicts the stone:

| Knip | Graph | Text |
| --- | --- | --- |
| used | entry point | "Entry point: loaded by Next.js (route)" (from the label), then any importers |
| used | only tests import it | "Used only by tests" |
| used | importers | "Imported by 3 files" / "Imported by 1 file" |
| used | none, not an entry | "Used (Knip), but no file in the project imports it" (a reported disagreement) |
| unused | none | "Unused: nothing in the project imports it (Knip)" (today's) |
| unused | only tests | "Unused: only imported by tests" |
| unused | only unused files (tests among them or not) | "Unused: only imported by other unused files" |
| unused | a used importer | "Unused (Knip), though imported by 2 files" (a reported disagreement) |
| — | no `importedBy` (an older file) | today's wording (`usageDetail`) |

- The importers, in `importedBy` order, then the first 5 as a list under the text: each a link-styled button (name, folder dimmed, "type only" dimmed when so) that selects the file and flies to it (`select` + `flyTo`, the list's path). "+N more" expands the rest in place; the panel scrolls with its bottom fade.
- An importer is always a current file (validated), so the link always lands.

**Hover:** `stoneSummary` gains an optional "imported by N" part, added by `HoverLabel` only when the whole line, measured in the label's font against its maximum width, still fits (as the search placeholder is measured).

## Files

| File | |
| --- | --- |
| `analyser/src/core/imports.ts`, `import-graph.ts`, `entry-points.ts`, `disagreements.ts` | pure, each with tests beside it |
| `analyser/src/io/resolve.ts` | the resolver on the snapshot tree |
| `analyser/src/core/assemble.ts`, `serialise.ts`, `pipeline.ts`, `cli-args.ts` | the fields; `--eulogies-from` |
| `analyser/package.json` | `typescript` moved to `dependencies` (Decision 1) |
| `shared/graveyard-schema.ts` | the two optional fields and their checks |
| `frontend/src/model/usage.ts`, `ui/DetailPanel.tsx`, `ui/HoverLabel.tsx`, `index.css` | the panel and the hover |

## Correctness properties and their tests

| # | Test |
| --- | --- |
| P1 | `import-graph.property.test.ts`: random graphs over random paths (with type-only edges, duplicates, self-imports); `importedByOf` is exactly the reverse, every path an analysed file, sorted, type-only exactly when every edge of the pair is |
| P2, P3 | `disagreements.property.test.ts`: random graphs with random Knip verdicts and entry points; every unused file with a used importer, and every used non-entry file with no importer, is reported, and nothing else |
| P4 | `import-graph.property.test.ts`: shuffled inputs give the same map; and end to end, the pipeline on a generated repository run twice gives the same bytes |
| P5 | `e2e/interface.spec.ts`: clicking an importer selects it and flies to it; "+N more" shows the rest; the dead-chain wording on oikos |
| P6 | `eulogy-input.property.test.ts`: `fileInput` ignores `importedBy` and `entry` |

Also, examples:
- **`imports.test.ts`:** every import form; type-only variants; comments and strings ignored; a non-literal `import(x)` counted.
- **`resolve.test.ts`:** on a built git repository: `paths` aliases, `baseUrl`, `extends`, `index.ts` folders, `.js` specifiers to `.ts` files, a package, a `.d.ts`; and an uncommitted change doesn't change the graph.
- **`entry-points.test.ts`:** each rule, and the first-match order.
- **`usage.test.ts`:** each row of the wording table.

## Afterwards (for you)

The commands to regenerate both demos (same flags as before, `--knip-dir app` for oikos, and `--eulogies-from` the committed file if you approve it), given when the tasks are done.
