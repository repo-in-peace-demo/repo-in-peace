# Design: Interface

## Overview

The interface wraps the existing scene in a small app flow (boot, digging, scene) and adds four page-element panels around the canvas: the detail panel, the list, the search box and a richer hover label. Everything new follows the scene spec's split: what to show is worked out by pure functions in `src/model/` (property-tested), and `src/ui/` only draws it. The one new piece of build tooling is a Vite plugin that writes the demo list.

Nothing here changes the scene's drawing. The scene gains two small functions on its registration (`screenPointOf` and `nudge`, below) so the detail panel can avoid covering the selected item.

```
            ┌─────────────┐  manifest   ┌───────────────┐  data file  ┌────────────────────────────┐
 bare URL ─▶│ BootScreen  │────────────▶│ DiggingScreen │────────────▶│ Scene (canvas + panels)     │
            │ demos, file │  choose     │ load + build  │  model      │ StatsPanel  Legend  Search │
            └─────────────┘             └───────────────┘             │ ListView  DetailPanel       │
 ?graveyard=name ──────────────────────────────▲                      │ HoverLabel  ControlsPanel   │
                                                                      └────────────────────────────┘
```

## App flow

`model/app-flow.ts` is a pure reducer; `App.tsx` holds its state and does the side effects (fetch, read file, build model, change the address).

```ts
type Source = { kind: 'demo'; name: string } | { kind: 'local'; fileName: string; graveyard: Graveyard } | { kind: 'made'; files: number };  // 'made': see below
type FlowState =
  | { screen: 'boot'; notice: BootNotice | null }            // a local-file error is shown on the boot screen
  | { screen: 'digging'; source: Source; startedAt: number; counts: Counts | null }
  | { screen: 'scene'; source: Source; model: SceneModel }
  | { screen: 'error'; title: string; message: string; details: string[] };
type FlowEvent =
  | { type: 'choose'; source: Source; now: number } | { type: 'counts'; counts: Counts }
  | { type: 'loaded'; model: SceneModel } | { type: 'failed'; title: string; message: string; details: string[] }
  | { type: 'local-rejected'; notice: BootNotice } | { type: 'back' };

function initialFlow(route: Route, now: number): FlowState;  // from routeFromAddress
function flow(state: FlowState, event: FlowEvent): FlowState;
```

- **Route from the address** (`routeFromAddress(search, madeFiles)` in `model/graveyard-load.ts`; `parseGraveyardName` now returns `null` for an address without the parameter): a `graveyard` parameter decides alone, a valid name giving a demo and a bad one the existing message (no request); without one, `madeFiles` (the development build's `?synthetic=<n>` count, read by `model/dev-features.ts` behind `import.meta.env.DEV`, always `null` in production) gives a made-up graveyard, and otherwise the boot screen. `DEFAULT_GRAVEYARD` is gone. The made-up source is called `made` in the flow, so production code never contains the word `synthetic` (the build grep of the scene spec, task 26.3).
- **The address:** choosing a demo calls `history.pushState` with `?graveyard=<name>`; `popstate` re-runs `initialFlow` from the new address, so Back returns to the boot screen. A local file does not change the address (Decision 6).
- **Back from an error:** the error screen gets a "Back to the graveyards" button (`flow(..., {type:'back'})`, address reset to the bare path).

## Demo list (manifest)

- **Plugin:** `frontend/vite-plugins/graveyard-manifest.ts`, registered in `vite.config.ts`.
  - Dev: a middleware answers `GET {base}graveyards/index.json` by reading the folder on each request, so a file dropped in appears on the next load.
  - Build: `generateBundle` emits `graveyards/index.json`.
  - Nothing is written into `public/`, so there is no file to keep in step. The analyser is untouched.
- **Pure part:** `model/manifest.ts`.
  ```ts
  interface ManifestEntry { name: string; repo: string; files: number; ghosts: number }
  interface Manifest { version: 1; graveyards: ManifestEntry[] }   // sorted by name, code-point order
  function buildManifest(entries: ReadonlyArray<{ fileName: string; json: unknown }>): { manifest: Manifest; skipped: string[] };
  function checkManifest(value: unknown): Manifest | null;          // the boot screen's guard on what it fetched
  ```
  - `name` is the file name without `.graveyard.json`. `repo` is `meta.name`, and the counts are the array lengths.
  - A file that is not a valid version-2 graveyard (`checkGraveyardData`) is skipped and named in `skipped`. The plugin prints those names as a warning.
  - The plugin reads each file whole, at build or request time, so the browser never has to.
  - `index.json` itself and anything not matching `*.graveyard.json` is ignored.

## Boot screen

`ui/BootScreen.tsx`, in the terminal style (`.terminal` in `index.css`: `#7dff9a` on `#020604`, browser monospace, a faint scanline gradient, a block cursor).

- **Script:** `model/boot-script.ts`.
  - `bootLines(manifest)` gives the fake boot. It is our own text, with no SGI, IRIX or FSN names:
    ```
    RIP/OS 0.9 (c) Repo In Peace — night shift
    memory ...................... 64 MB ok
    probing graveyards .......... 2 found
    mounting /graveyards ........ ok
    ```
  - `typedText(lines, elapsedMs, msPerChar = 6, msPerLine = 80)` gives what is visible after `elapsedMs`. It is pure, so the typing is testable.
  - The whole script types in under 2 s.
- **Skipping:** any key or pointer press while typing jumps to the end. That handler takes the event, so it does not also choose a graveyard. Under reduced motion `elapsedMs` starts at infinity and the cursor does not blink.
- **Choices:** a list of buttons, one per manifest entry, reading `spatialql — 120 files, 2 ghosts` and `oikos_ledger — 129 files`. Then **Open a graveyard file…**.
  - The first demo has focus when the choices appear, so Enter opens it.
  - Up and Down move the focus, and Tab works as usual.
- **Open a graveyard file:**
  - It is a visually styled `<label>` around `<input type="file" accept=".json,application/json">`, plus a drop area covering the screen.
  - `ui/read-local-file.ts` reads the file with `file.text()`, then `JSON.parse`, then `checkGraveyardData` (the existing check, with the version message of the scene spec).
  - On success the flow gets `choose` with a local source. On failure it gets `local-rejected`, and the boot screen shows the message in red-amber below the choices, with focus moved to it.
  - Nothing is uploaded: no `fetch` with the file's content exists.
- **No manifest:** a fetch or `checkManifest` failure shows "No demo list found" in place of the demos, and the file choice still works (Req 1.9).

## Digging screen

`ui/DiggingScreen.tsx`, in the same terminal style. For a demo chosen on the boot screen, the counts come from the demo list with the choice (the `choose` event carries them), so the lines show them while the file loads; for a direct link they appear when the file has arrived. `App` loads the file for a demo, which also covers the counts lines. A local file is already parsed. It then builds `buildSceneModel` in a `setTimeout(0)` after the first paint, so the screen shows before the work starts. The lines come from `diggingLines(counts)` (`model/boot-script.ts`): `opening <repo>…`, `exhuming 129 graves…`, `summoning 2 ghosts…` (no ghost line when there are none) and `raising the fences…`.

Timing (`model/digging-timing.ts`, P8):
```ts
const DIG_MIN_MS = 400;   // never a flash
const DIG_MAX_ADDED_MS = 1000;
function digHoldMs(workMs: number): number  // = clamp(DIG_MIN_MS - workMs, 0, DIG_MAX_ADDED_MS)
```
The scene is shown `digHoldMs(workMs)` after the model is ready. Because of `DIG_MIN_MS` the added delay is never more than 400 ms in practice; `DIG_MAX_ADDED_MS` caps it if the constant is ever raised. The opening move starts when the scene mounts, as now.

## Shared wording: `model/grave-facts.ts`

The detail panel and the hover line read the same functions (Req 4b.5).

```ts
type StateName = 'Fresh' | 'Stale' | 'Ancient';
function stateName(file: FileEntry): StateName;
function stateSentence(file: FileEntry, meta: RepoMeta): string;
//  "Fresh: last touched 3 days before the snapshot"
//  "Stale: untouched 30 days before the snapshot (stale from 21 days)"
//  "Ancient: untouched 65 days before the snapshot (ancient after 45 days)"
function calendarDay(iso: string, snapshotIso: string): string;  // "Jun 13", or "Jun 13, 2025" when the year differs; UTC
function linesText(n: number): string;                           // "1 line", "26 lines"
function hotText(file: FileEntry): string | null;                // "hot (7 commits)" or null
function hotDetail(file: FileEntry, meta: RepoMeta): string;     // the detail panel's row: "yes, 7 commits in the last 30 days"
function fileType(path: string): string;                         // the toe-tag text (`ghostTagText`), ".ts" or "·"
function stoneSummary(file: FileEntry, meta: RepoMeta): string;  // "Ancient · last commit Jun 13 · 26 lines · unused · hot (7 commits)"
function ghostSummary(ghost: Ghost, meta: RepoMeta): string;     // "Ghost · deleted Oct 12 · .ts"
function buryOffered(file: FileEntry): boolean;                  // = file.unused (Decision 5)
function shortenPath(path: string, maxChars: number): string;    // middle ellipsis in the folder part; the file name is whole
```
- Ages come from the existing `ageDays` (snapshot-relative, never the clock). Month names are fixed English three-letter names, from `getUTCMonth`, never `toLocaleDateString`, so the output does not depend on the viewer's locale or time zone.
- `stateSentence` takes the state from `decayState`. The day count and the threshold are worded to agree with it (P5). The data file is the analyser's, so it can't disagree with its own thresholds. A test checks both demo files anyway.

## Detail panel

`ui/DetailPanel.tsx`: an `<aside aria-label="Selected grave">`, 340 px wide, below the legend, the full height down to above the bottom buttons. It reads `useSelection()` and `model.lookup`.

- **Stone:**
  - The heading is the file name, with the path shortened in the middle and the full path in `title`. A copy button copies the path.
  - Under it, a `<dl>` with: State (`stateSentence`); Last commit (`calendarDay` and the author); Lines; Unused (yes or no); Hot (`hotText`, or "no, N commits in the last D days"); Decay score (two decimals).
- **Ghost:**
  - The heading is the file name, with the path below it.
  - The `<dl>` has: Deleted (`calendarDay`, "by" the author); In commit (the first 7 characters, with a copy button for the full SHA); Type (`fileType`).
- **Eulogy:** a `<blockquote>` with the eulogy. When it is empty, a dimmed, non-italic line in brackets: "[No eulogy yet. They will be written in a later version.]"
- **Actions:**
  - **Bury** is shown when `buryOffered`, and **Resurrect** for a ghost.
  - Both are `<button aria-disabled="true">` that stay in the focus order, with the note "Arrives with the PR function." linked by `aria-describedby`. They do nothing.
- **Closing:** the close button (×, `aria-label="Close"`) calls `clearSelection()`. Escape already clears the selection through `Picker`, so the panel adds no Escape handler of its own.

**Not covering the selected item** (Req 4.8, P9), in `model/panel-placement.ts`:
```ts
type Side = 'left' | 'right';
function panelSide(itemX: number, windowWidth: number): Side;              // right unless the item is on the right half
function nudgeNeeded(item: ScreenBox, panel: ScreenBox, margin = 24): number; // pixels to move the picture sideways (0 when clear)
```
- **Scene registration:** it gains `screenPointOf(path): {x, y} | null` (the same projection as the dev `getScreenPoint`, now also in production) and `nudge(pixels)`.
- **What `nudge` does:** it starts a short flight (600 ms, the existing flight code) that moves the camera and its look-at point along the camera's right direction. The distance is the pixel count times the world size of a pixel at the item's depth. The end pose is clamped with `clampPose` in slide mode, so it can't leave the limits.
- **When it runs:**
  - The panel works out its side when the selection changes, and again on window resize. It does not do this on every camera move, so it doesn't jump around while the user orbits.
  - After a `flyTo` from the list or search, the item is in the middle of the screen, so no nudge is needed. A nudge happens only for a click in the scene near the panel's side on a narrow window.

## List view

`ui/ListView.tsx`: an `<aside aria-label="Graves">` docked on the left, under the stats panel.

- **Collapsed:** a tab reading "List · 129".
- **Open:** 320 px wide, with sort buttons, filter toggles, a count ("42 of 129"), and the rows.
- **Default:** open from 1600 px wide and collapsed below, following the existing collapse rule (`panelsStartOpen`).

**Rows and logic** (`model/list-rows.ts`):
```ts
interface Row { kind: 'file' | 'ghost'; path: string; name: string; folder: string;
  state: DecayState | null; unused: boolean; hot: boolean; lines: number | null;
  age: number;            // a file's age, or the days from a ghost's deletion to the snapshot
  decay: number | null; deleted: string | null }
function buildRows(g: Graveyard): Row[];
type Kind = 'fresh' | 'stale' | 'ancient' | 'ghost';  type Flag = 'unused' | 'hot';
function filterRows(rows: readonly Row[], kinds: ReadonlySet<Kind>, flags: ReadonlySet<Flag>): Row[];  // P1
type SortKey = 'decay' | 'age' | 'name' | 'size';
function sortRows(rows: readonly Row[], key: SortKey, reversed: boolean): Row[];                      // P2
function highlightedIndex(rows: readonly Row[], selection: Selection): number;                         // -1 when not shown (P4)
```
- **Comparators:**
  - Every comparator ends with `compareCodePoint(path)`, so the order is total.
  - The direction is reversed with a whole-order reverse, not by flipping the comparator. Two reverses give the original order, and the path tie-break is mirrored as well, which keeps it deterministic.
- **The four sorts:**
  - **decay:** stones before ghosts. Stones by decay score descending. Ghosts by deleted date ascending.
  - **age:** oldest first, by `age`.
  - **name:** by file name.
  - **size:** by lines descending, ghosts last.
- **Speed:** sorting and filtering 2,000 rows is a single pass plus `Array.sort` on precomputed keys. A unit test times it, and it must stay well under 16 ms.

**Virtualised drawing** (`model/virtual-window.ts`):
```ts
function visibleRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = 8): { first: number; last: number };
function scrollToShow(index: number, scrollTop: number, viewportHeight: number, rowHeight: number): number;  // the new scrollTop, unchanged when already in view
```
- Rows have a fixed height of 30 px. The scroller holds one spacer of `count × 30` px and absolutely placed rows for `first..last` only, so at most about 40 rows are in the page whatever the count. No virtual-list dependency.
- Each row is a `<div role="option">` in a `role="listbox"` with `aria-activedescendant`. Up, Down, Page Up and Page Down move the active row, and Enter selects it.
- A row shows the file name, the folder dimmed, the state word with the legend's colour swatch, and marks for unused (✕ cracked), hot (a flame mark) and ghost.

**Selection sync:**
- **List to scene:** a row click or Enter calls `select()` and then `flyTo()`.
- **Scene to list:** `useSelection()` gives `highlightedIndex`. The list scrolls with `scrollToShow`, and the row gets `aria-selected`.
- **Filtered out:** when the selected item is hidden by the filters, a line under the count says "The selected grave is hidden by the filters".

## Search

`ui/SearchBox.tsx`: a combobox at the top centre, 360 px wide, with `role="combobox"`, `aria-controls` pointing to its result listbox, and placeholder "Search graves (/)".

**Ranking** (`model/search.ts`, P3):
```ts
type Rank = 0 | 1 | 2 | 3;   // exact name, name prefix, name contains, path contains
function rankRow(row: Row, query: string): Rank | null;      // case-insensitive (toLowerCase on both), null for no match
function searchRows(rows: readonly Row[], query: string, limit = 50): Row[];  // by rank, then path
```
- An empty or blank query gives no results.
- The results drop down under the box, at most 8 visible, then scrolling. Each shows the name, the folder and the hover summary line.

**Keys:**
- Typing filters the results. Down and Up move through them.
- Enter selects the active result (the top one by default) and flies to it, then closes the results. Focus stays in the box.
- Escape clears the text, and a second Escape blurs the box. `Picker`'s Escape handler already ignores keys from a text field, so the selection stays.

**Focusing the box:** `shortcutFor` in `model/shortcuts.ts` gains `'search'`.
- `/` focuses the box when the user is not typing.
- Cmd+K, or Ctrl+K off macOS, focuses it even when the user is typing. It calls `preventDefault`, because the browser binds Ctrl+K to its own search on some systems.

**No camera movement while typing** (Req 6.5): the fly keys, Home, R and ? already ignore typing elements (`isTypingElement`). That check is widened to `ownsKeys(target)`, which is true for an input, textarea, select or contenteditable element, or anything inside an element marked `data-owns-keys`. The list and the search results carry that mark, so the arrow keys move through rows there instead of flying the camera. `Picker`'s Escape keeps the narrower `isTypingElement`, so Escape in the list still clears the selection; only a text field keeps Escape for itself.

## Hover label

`ui/HoverLabel.tsx` gets the scene model and adds one line under the name and folder: `stoneSummary` or `ghostSummary`.

- The line has `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` and a max width of 28 rem.
- The summary is ordered state, date, lines, flags, so a cut at the end loses the flags first and the state and date always show.
- It is still hidden while dragging, as now: the hover store is cleared on a drag.

## Layout

At 1280 × 720 (all panels start collapsed below 1600 px):

| Panel | Where | Size |
| --- | --- | --- |
| Stats | top left (as now) | collapsed to its heading |
| Search | top centre | 360 × 36 px |
| Legend | top right (as now) | collapsed to its heading |
| List | left, under the stats | a tab; open: 320 px, overlaying the left edge |
| Detail | right, under the legend (left when the item is on the right half) | 340 px, overlaying the edge |
| Reset view, ? | bottom left (as now) | |

The middle of the graveyard is the middle third of the window. The establishing shot puts the graveyard centre there, so neither docked panel reaches it. A browser test checks the panels' boxes against that region with the list and the detail panel open.

## Accessibility

- Every button has a name. Toggles use `aria-pressed`, and the list and search results use the listbox roles above.
- Focus rings use a 2 px `:focus-visible` outline in the hover colour (`#cfe2ff`).
- Panels are `<aside>` landmarks with labels.
- The boot and digging screens use `role="status"` for their lines, with `aria-live="polite"` set only after the typing ends, so screen readers hear the full text once and not character by character.
- Under reduced motion there is no typing, no blinking and no smooth scrolling.

## Files

| New | What |
| --- | --- |
| `vite-plugins/graveyard-manifest.ts` | dev middleware and build output for `graveyards/index.json` |
| `src/model/manifest.ts` | `buildManifest`, `checkManifest` |
| `src/model/app-flow.ts` | `initialFlow`, `flow` |
| `src/model/boot-script.ts` | `bootLines`, `typedText`, `diggingLines` |
| `src/model/digging-timing.ts` | `digHoldMs` |
| `src/model/grave-facts.ts` | the shared wording |
| `src/model/panel-placement.ts` | `panelSide`, `nudgeNeeded` |
| `src/model/list-rows.ts` | rows, filter, sort, highlight |
| `src/model/virtual-window.ts` | `visibleRange`, `scrollToShow` |
| `src/model/search.ts` | `rankRow`, `searchRows` |
| `src/ui/BootScreen.tsx`, `DiggingScreen.tsx`, `DetailPanel.tsx`, `ListView.tsx`, `SearchBox.tsx`, `read-local-file.ts`, `fetch-manifest.ts` | the screens and panels |

| Changed | What |
| --- | --- |
| `src/App.tsx` | the flow, in place of `useGraveyardLoad` (which becomes the demo loader inside it) |
| `src/model/graveyard-load.ts` | `routeFromAddress`; `DEFAULT_GRAVEYARD` removed |
| `src/model/shortcuts.ts`, `fly-controls.ts` | the `search` shortcut; `ownsKeys` |
| `src/scene/api.ts`, `CameraRig.tsx` | `screenPointOf`, `nudge` on the registration |
| `src/ui/HoverLabel.tsx` | the summary line |
| `src/index.css` | the terminal style, the panels |
| `e2e/*.spec.ts` | any test opening the bare address gets `?graveyard=demo.spatialql` |

## Testing

| Property | Test |
| --- | --- |
| P1 filters | `list-rows.property.test.ts`: random rows and any subsets of kinds and flags, against a direct definition |
| P2 sorting | the same: any permutation sorts the same; reversing twice is the identity; under decay every stone comes before every ghost |
| P3 ranking | `search.property.test.ts`: names and paths built to be exact, prefix, contains and path-only matches; their ranks are ordered |
| P4 selection sync | `list-rows.property.test.ts` (`highlightedIndex` finds exactly one row, or -1 when it is filtered out); `e2e/interface.spec.ts` (scene click, row and search each leave the store and one `aria-selected` row in step) |
| P5 state wording | `grave-facts.property.test.ts`, with random thresholds and dates |
| P6 manifest | `manifest.property.test.ts`: any mix of valid, invalid and non-graveyard files |
| P7 local file | `graveyard-load` tests for every `schemaVersion` other than 2 |
| P8 digging hold | `digging-timing.test.ts` |
| P9 panel side, P10 path shortening, P11 hover line, P12 UTC dates, P13 Bury | `panel-placement`, `grave-facts` property tests. P12 runs with `TZ` set to an offset zone (`process.env.TZ` at the top of the test file) and dates close to midnight UTC |

Browser checks:
- **`e2e/boot.spec.ts`:**
  - A bare address shows the boot screen, and a key skips the typing.
  - Enter opens spatialql: the address gets `?graveyard=demo.spatialql`, the digging screen shows the real counts, then the scene appears.
  - Reduced motion shows the text at once.
  - A local file picked with `setInputFiles` opens. A version-1 file shows the version message and stays on the boot screen.
  - Back returns to the boot screen.
- **`e2e/interface.spec.ts`:**
  - Detail panel: the contents for a stone and a ghost, Bury on `voice/index.ts` and not on an ancient used stone, close and Escape, and panel placement.
  - List: 2,000 rows from `?synthetic=2000`, with fewer than 60 row elements in the page, sort and filter counts, and row-to-scene sync.
  - Search: `/` and Cmd+K focus the box, ranking, and Enter flies. Typing W A S D in the box doesn't move the camera.
  - Hover line: its text on a stone and on a ghost.
  - Layout: at 1280 × 720, with the list and the detail panel open, no panel box enters the middle third.
- **Screenshots** for each section, in `e2e/screenshots.spec.ts`.

## Not in this design

- Eulogy text (spec 4).
- The PR function and the bury and resurrect animations (spec 5).
- Sound.
- Keeping a local file across a reload.
