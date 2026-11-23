# Tasks: Importers

References are to `requirements.md` and `design.md` in this folder. Every property test uses fast-check; test files sit beside their modules.

**I run** the typecheck, single Vitest files and single Playwright files (without `@slow`). **You run** installs, the full suites, the analyser on the real clones, and deploys. Commands for you are marked **Run**.

Status key: `[x]` done, `[ ]` not started.

---

## Part 1: The analyser's graph (pure)

- [x] 1. Finding imports (`core/imports.ts`)
  - [x] 1.1 `findImports` with TypeScript's parser: static, re-export, `import = require`, `import()`, `require()`, and `typeof import('…')` in types (type-only); type-only; non-literal counted.
  - [x] 1.2 **Examples:** every form; type-only variants; comments and strings ignored; JS, JSX, TSX, MJS, CJS.
  - _Requirements: 1_

- [x] 2. The graph (`core/import-graph.ts`)
  - [x] 2.1 `buildEdges` (self-imports dropped, pairs merged, type-only only when every edge is) and `importedByOf` (every file a sorted list).
  - [x] 2.2 **P1** and **P4 (pure)** on random graphs.
  - _Requirements: 2.4, 4.1_

- [x] 3. Entry points (`core/entry-points.ts`)
  - [x] 3.1 `entryPointOf` in the design's order; `htmlScripts` and `packageEntries` from `index.html` and `package.json` texts.
  - [x] 3.2 **Examples:** each rule; first-match order; Vite `src="/src/index.ts"`; `bin` as a string and an object.
  - _Requirements: 3_

- [x] 4. Disagreements (`core/disagreements.ts`)
  - [x] 4.1 The two lists and the report lines (at most 20 each, then a count).
  - [x] 4.2 **P2, P3** on random graphs with random verdicts and entry points.
  - _Requirements: 5_

## Part 2: Resolution, the data file and the pipeline

- [x] 5. The resolver (`io/resolve.ts`)
  - [x] 5.1 Nearest tsconfig or jsconfig, parsed once, `extends` from the tree or `node_modules`; a host on the snapshot tree; `package` / `outside` / `missing`.
  - [x] 5.2 **Examples** on built git repositories: `paths`, `baseUrl`, `extends`, folder `index.ts`, `.js` to `.ts`, a package, a `.d.ts`; an uncommitted change doesn't change the graph.
  - _Requirements: 2_

- [x] 6. Schema and serialiser (`shared/graveyard-schema.ts`, `core/serialise.ts`)
  - [x] 6.1 `importedBy` and `entry`, optional, validated; written after `hot`.
  - [x] 6.2 **Examples:** valid and invalid fields; older files load.
  - _Requirements: 4.1, 4.2_

- [ ] 7. The pipeline (`pipeline.ts`, `core/assemble.ts`)
  - [ ] 7.1 One batch for lines and imports; a batch for configs, `package.json` and `index.html`; the graph, entry points, disagreements and the working-tree warning; the fields on every file.
  - [ ] 7.2 The golden file regenerated deliberately, with the check that removing the two fields gives the previous one byte for byte.
  - [ ] 7.3 **P4 end to end** in the e2e property test; **P6** (`fileInput` ignores the new fields).
  - [ ] 7.4 `typescript` moved to `dependencies` (Decision 1).
  - **Run (checkpoint A):** `cd analyser && npm install && npm run typecheck && npm test`
  - _Requirements: 1 to 5_

- [ ] 8. `--eulogies-from <file>` (`cli-args.ts`, `pipeline.ts`)
  - [ ] 8.1 Copies each grave's eulogy (files and ghosts, by path) and `meta.eulogyModel` from an earlier data file of the same repository, no model, no cache; graves not found get `""` and are listed. Refused with `--eulogies`, with a file of another repository, or a file that doesn't validate.
  - [ ] 8.2 **Examples:** copies exactly; lists what it couldn't fill; the refusals.
  - _Requirements: 4.3_

## Part 3: The frontend

- [ ] 9. Usage (`model/usage.ts`)
  - [ ] 9.1 `usageView` with the wording table; the first 5 importers and the rest.
  - [ ] 9.2 **Examples:** every row of the table, older files.
  - _Requirements: 6.1, 6.2_

- [ ] 10. The panel and the hover (`ui/DetailPanel.tsx`, `ui/HoverLabel.tsx`, `index.css`)
  - [ ] 10.1 The Usage row with importer links (select and fly), "+N more", "type only"; the hover suffix when it fits.
  - [ ] 10.2 **Browser checks (P5)** on a demo file with the fields (a copy built by the test until the demos are regenerated): clicking an importer selects and flies to it; "+N more"; the dead-chain wording; the hover suffix.
  - _Requirements: 6_

## Part 4: Docs and the demos

- [ ] 11. Documentation: `analyser/README.md` (the graph, entry points, disagreements, `--eulogies-from`), `frontend/README.md` (the Usage row), `docs/kiro-notes.md`, `docs/backlog.md` (the importer list done).

- [ ] 12. **Regenerate the demos** (yours to run, with the commands I give): both demos with the same flags as before (`--knip-dir app` for oikos) and `--eulogies-from` the committed demo file, so the eulogies are kept exactly. Then send me the disagreement report, and I check the diff only adds `importedBy` and `entry`.
  - _Requirements: 4.3, 5_
