# Tasks: Interface

References are to `requirements.md` and `design.md` in this folder. Every property test uses fast-check, and test files sit beside their modules. Paths are under `frontend/` unless stated.

**I don't run the full suite, Playwright, installs or builds.** Commands for you to run are marked **Run**. While building I run only the typecheck and the single test files I change.

**Order:** the pure model and its properties first (tasks 1 to 4), then each section of the interface. Each section ends with a commit and a screenshot (tasks 5 to 11), then the docs and the final checkpoint (tasks 12 and 13).

**Screenshots** come from `e2e/screenshots.spec.ts`, which gets a test per section. You run it, and I copy the pictures into `docs/screenshots/interface/` and commit them with the section.

Status key: `[x]` done, `[ ]` not started.

---

## Part 1: Pure model

- [x] 1. Routes and flow (`model/graveyard-load.ts`, `model/app-flow.ts`)
  - [x] 1.1 `routeFromAddress(search, madeFiles)` (the made-up count is passed in by the development build; see the design):
    - no `graveyard` parameter gives `boot`;
    - a valid name gives a demo source;
    - a bad name gives the existing name message;
    - in development, `?synthetic=<n>` gives a synthetic source.

    Remove `DEFAULT_GRAVEYARD`, and update its tests and `useGraveyardLoad`.

    **Done:** `parseGraveyardName` returns `null` without the parameter. Until task 6, a bare address shows "Choose a graveyard" with the two demo addresses.
  - [x] 1.2 `initialFlow`, `flow`, as in the design.
    - **Examples:** boot → choose → digging → loaded → scene; digging → failed → error → back → boot; local-rejected stays on boot with the notice.
    - **Property:** no event takes the flow to a scene without a model, and `back` always ends on boot.
  - [x] 1.3 **Nothing to change:** no test opens the bare address (`dev.spec.ts` opens `/?synthetic=2000`, which still routes to the made-up graveyard). The task was: change every Playwright test that opens the bare address to open `?graveyard=demo.spatialql`. Find them with `grep -n "goto('/')\|goto(\`/\`)" e2e`.
  - _Requirements: 1.1, 1.10, 2.1, 3.4_

- [x] 2. Manifest, boot script and digging timing (`model/manifest.ts`, `boot-script.ts`, `digging-timing.ts`)
  - [x] 2.1 `buildManifest`, `checkManifest`.
    - **P6:** for any mix of valid version-2 files, invalid files, other versions and non-graveyard names, the manifest lists exactly the valid `*.graveyard.json` files. Each entry has the name from the file name, the repo from `meta.name`, and the array lengths as counts, sorted by name. Every other file is in `skipped`, except names that aren't `*.graveyard.json` and `index.json`, which are ignored.
    - **Test:** the two real files give `spatialql 120/2` and `oikos_ledger 129/0`.
  - [x] 2.2 `bootLines`, `typedText`, `diggingLines`.
    - **Properties:** the visible text is a prefix of the whole text; it never shrinks as time goes on; it is complete at infinity; and the whole script types in under 2 s at the defaults.
    - **Examples:** no SGI, IRIX or FSN in any line; there is no ghost line when there are no ghosts; the real counts appear in the lines.
  - [x] 2.3 `digHoldMs`.
    - **P8:** for any work time, the added delay is between 0 and `DIG_MAX_ADDED_MS`, and the total is at least `DIG_MIN_MS`.
  - [x] 2.4 **P7:** extend the `graveyard-load` tests so that every `schemaVersion` other than 2 gives the version message, and a valid version-2 file always loads. This is the path a local file takes.
  - _Requirements: 1.2, 1.3, 1.8, 3.1, 3.2_

- [x] 3. Shared wording and panel placement (`model/grave-facts.ts`, `model/panel-placement.ts`)
  - [x] 3.1 `stateName`, `stateSentence`, `calendarDay`, `linesText`, `hotText`, `fileType`, `stoneSummary`, `ghostSummary`, `buryOffered`, `shortenPath`.
    - **P5:** the state sentence names `decayState`, its day count is `ageDays`, and it quotes the right threshold, with random thresholds and dates.
    - **P11:** a stone's summary has exactly the flags that apply, and starts with its state word. A ghost's summary starts with "Ghost" and ends with its toe-tag type. The words are the same as the detail panel's.
    - **P12:** the file sets `process.env.TZ` to an offset zone. With dates near midnight UTC, the day is the UTC day, and the year appears exactly when it differs from the snapshot's.
    - **P13:** Bury is offered exactly when `unused`.
    - **P10:** a shortened path always keeps the whole file name and is never longer than asked, unless the name alone is longer.
    - **Examples:** the singulars ("1 line", "1 day", "hot (1 commit)"). The oikos stone `app/components/voice/index.ts` reads "Fresh · last commit … · unused" and is offered Bury. An ancient used stone is not.
  - [x] 3.2 `panelSide`, `nudgeNeeded`.
    - **P9:** the panel is always on the half away from the item.
    - **Property:** the nudge is 0 exactly when the boxes are apart by at least the margin, and after moving by the nudge they are apart.
  - _Requirements: 4.3 to 4.9, 4b.2 to 4b.6_

- [x] 4. List, search and keys (`model/list-rows.ts`, `virtual-window.ts`, `search.ts`, `shortcuts.ts`, `fly-controls.ts`)
  - [x] 4.1 `buildRows`, `filterRows`, `sortRows`, `highlightedIndex`.
    - **P1:** kinds combine with OR (any kind when none is selected), flags with AND, and the two groups with AND. The filter is checked against a direct definition, and clearing the filters gives every row.
    - **P2:** any permutation of the rows sorts the same; ties fall back to path; reversing twice is the identity; and under decay every stone comes before every ghost.
    - **P4 (pure part):** `highlightedIndex` finds the one row of the selection, or -1 when it is filtered out.
    - **Timing:** sorting and filtering 2,000 synthetic rows takes under 16 ms. Take the median of 5 runs, so a slow test machine doesn't flake.
  - [x] 4.2 `visibleRange`, `scrollToShow`.
    - **Properties:** the range is inside `0..count-1`, covers the viewport, and has at most `viewport / rowHeight + 2 × overscan + 2` rows. After `scrollToShow` the row is in view, and an already visible row leaves `scrollTop` unchanged.
  - [x] 4.3 `rankRow`, `searchRows`.
    - **P3:** exact name ranks before name prefix, which ranks before name contains, which ranks before path only. A row that doesn't match never appears. Within a rank, results are ordered by path. Matching is case-insensitive.
    - **Examples:** in oikos, `index.ts` puts the `index.ts` files first, and `voice` puts the files named `voice…` before paths that only contain `voice`.
  - [x] 4.4 Add `'search'` to `shortcutFor`:
    - `/` focuses search when you're not typing;
    - Cmd+K or Ctrl+K focuses it even while you're typing.

    Add `ownsKeys(target)`, which is true for inputs and anything inside `[data-owns-keys]`. Use it in place of `isTypingElement` for the fly keys and the shortcuts. **Changed while building:** `Picker`'s Escape keeps `isTypingElement`, so Escape in the list still clears the selection (as it does on the canvas), and only a text field (the search box) keeps it.

    **Tests:** no flying key and no other shortcut fires from inside an element that owns its keys, and the existing shortcut tests still pass.
  - **Run (checkpoint A, the model):** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 5.2 to 5.7, 6.1 to 6.5_

---

## Part 2: The interface, one section at a time

Each task ends with **Commit** and a screenshot from `e2e/screenshots.spec.ts`. **Run** the named test, then tell me, and I copy the picture into `docs/screenshots/interface/` and commit it.

- [x] 5. Demo list plugin (`vite-plugins/graveyard-manifest.ts`)
  - [x] 5.1 The plugin:
    - in the dev server, a middleware for `graveyards/index.json` that reads the folder on each request;
    - in builds, `generateBundle` emits the same file;
    - skipped files are printed as a warning.

    Register it in `vite.config.ts`. `ui/fetch-manifest.ts` loads the file and checks it with `checkManifest`.

    **Done.** `model/graveyard-load.ts` now imports the shared schema by a relative path, because Vite's config loader (which runs the plugin) does not apply the `@shared` alias. I checked that the config loads and that the plugin's build hook writes both demos with their counts, without a build.
  - [x] 5.2 **Run:** `npm run dev`, then open `http://localhost:5173/graveyards/index.json`. You should see both demos with their counts. Then `npm run build && ls dist/graveyards/`, which should list `index.json` and the two data files. **Done:** covered by the boot screen listing both demos in the dev server and in the preview build (manual checkpoint, task 13).
  - _Requirements: 1.2, 1.9_

- [x] 6. Boot and digging screens (`ui/BootScreen.tsx`, `ui/DiggingScreen.tsx`, `ui/read-local-file.ts`, `App.tsx`)
  - [x] 6.1 Rework `App.tsx` around the flow: `pushState` when a demo is chosen, `popstate` to go back, and a back button on the error screen.
  - [x] 6.2 The boot screen, as in the design:
    - the terminal style;
    - the typed lines, with any key or click skipping the typing without choosing;
    - text at once under reduced motion;
    - the demo choices, with the first one focused, and Up, Down and Enter;
    - Open a graveyard file, with both the picker and drop;
    - a local-file error shown on the boot screen;
    - "No demo list found" when the manifest is missing.
  - [x] 6.3 The digging screen: real counts, the scene model built after the first paint, and `digHoldMs`. After it, the scene plays its opening move.
  - [x] 6.4 `e2e/boot.spec.ts`, as in the design:
    - a bare address shows the boot screen;
    - a key skips the typing;
    - Enter opens spatialql, with the address, the digging counts, then the scene;
    - reduced motion shows the text at once;
    - a local file opens through `setInputFiles`, and a version-1 copy shows the version message and stays on the boot screen;
    - Back returns to the boot screen;
    - `?graveyard=demo.oikosledger` skips the boot screen.

    The version-1 file is written by the test into a temporary folder, not kept in the repository.
  - [x] 6.5 **Leaving the scene frees its GPU resources.** On Back, or when another graveyard is chosen, the old scene is unmounted, and everything it made is disposed: geometries, materials, textures, render targets, the engraving atlas and the ghost-tag atlas. Every `useMemo`'d geometry, material or texture gets a matching dispose in an effect cleanup. Check this file by file in `scene/`; some already have one (`Plaques.tsx`). The canvas and its WebGL context are dropped with the scene, and `gl.dispose()` is called on unmount.
    - The dev `getRenderInfo()` also returns `renderer.info.memory` (geometries and textures), read from the live renderer.
    - **Browser check** (`e2e/boot.spec.ts`): switch between the two demos five times (spatialql, Back, oikos, Back, …). After each arrival, read the geometry and texture counts. Each graveyard's counts must be the same on every visit, so nothing builds up. Listen on every canvas for `webglcontextlost` and fail if it ever fires. Also count the canvases in the page, which must never be more than one.
  - [x] 6.6 Screenshot test `interface boot`: the boot screen with the choices, and the digging screen. To catch the digging screen, the test delays the data file with `page.route`.
  - **Built, with these choices:**
    - A "← Graveyards" button beside Reset view leaves the scene, as Back does. The five-switch check uses it.
    - The scene is keyed on its graveyard, so choosing another one unmounts the old scene. Every geometry, material and texture the scene builds was already freed on unmount: the engraving and ghost-tag atlases in `Stones` and `Ghosts`, the shader assets in the other components, and anything declared in JSX through R3F. R3F also disposes the renderer. The dev `getRenderInfo()` now reports `geometries` and `textures`.
    - R3F ends a canvas's WebGL context on purpose when it unmounts (`forceContextLoss`, because browsers cap live contexts), so a `webglcontextlost` event on the scene being left is expected. The check fails on a lost context while a scene is showing.
    - `useGraveyardLoad` is gone. Its loading moved into `App.tsx`.
  - **Run:** `npx playwright test e2e/boot.spec.ts` (including the five switches), then `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts -g "interface boot"`.
  - **Commit** with the screenshots.
  - _Requirements: 1, 2, 3_

- [x] 7. Hover label (`ui/HoverLabel.tsx`)
  - [x] 7.1 Add the summary line (`stoneSummary`, `ghostSummary`). It stays on one line, cut with an ellipsis if needed, and is still hidden while dragging.
  - [x] 7.2 Browser check in `e2e/interface.spec.ts`:
    - hovering `app/components/voice/index.ts` (oikos) shows "Fresh · last commit … · … lines · unused";
    - a spatialql ghost shows "Ghost · deleted … · .ts";
    - the label is gone during a drag.
  - [x] 7.3 Screenshot test `interface hover`: a stone with flags, and a ghost.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "hover"`, then the screenshot.
  - **Commit** with the screenshots.
  - _Requirements: 4b_

- [x] 8. Detail panel (`ui/DetailPanel.tsx`, `scene/api.ts`, `scene/CameraRig.tsx`)
  - [x] 8.1 The panel for a stone and for a ghost, as in the design:
    - the eulogy, or the placeholder;
    - Bury on unused stones only, and Resurrect on ghosts, both disabled with the note;
    - copy buttons;
    - the close button.
  - [x] 8.2 `screenBoxOf`, `isFlying` and `nudge` on the scene registration (a box rather than a point, so the overlap is measured on the whole stone). The side comes from `panelSide` and the nudge from `nudgeNeeded`. They are worked out when the selection changes and when the window resizes.
  - [x] 8.3 Browser checks:
    - opens on a scene click, a double-click, and later a list row and a search result;
    - the stone and ghost contents match `grave-facts`;
    - Bury on `voice/index.ts` and not on an ancient used stone;
    - Escape and × close it;
    - the panel box never contains the selected item's screen point, for an item on the left and one on the right.
  - [x] 8.4 Screenshot test `interface detail`: an unused stone, and a ghost.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "detail"`, then the screenshot.
  - **Commit** with the screenshots.
  - _Requirements: 4_

- [x] 9. List view (`ui/ListView.tsx`)
  - [x] 9.1 The docked list:
    - collapsed and open states, following `panelsStartOpen`;
    - sort buttons, where a second press reverses;
    - kind and flag toggles, with `aria-pressed`;
    - the count;
    - rows virtualised with `visibleRange`;
    - the listbox keys;
    - `data-owns-keys`;
    - select and fly on click or Enter;
    - highlight and scroll into view on a selection from elsewhere;
    - the "hidden by the filters" line.
  - [x] 9.2 Browser checks:
    - **Rows and order:** oikos shows 129 rows in decay order, and spatialql's 2 ghosts come after its 120 stones.
    - **Counts:** the filter counts match `filterRows`.
    - **P4 end to end:** a scene click, a row click and a search result each leave the store and exactly one `aria-selected` row in step.
    - **Large list:** `?synthetic=2000` keeps fewer than 60 row elements in the page while scrolling from top to bottom.
    - **Keys:** arrow keys in the list don't move the camera.
  - [x] 9.3 Screenshot test `interface list`: the open list on oikos, with a filter on.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "list"`, then the screenshot.
  - **Commit** with the screenshots.
  - _Requirements: 5_

- [x] 10. Search (`ui/SearchBox.tsx`)
  - [x] 10.1 The combobox, as in the design:
    - results as you type, at most 8 visible;
    - Up, Down and Enter, with select and fly;
    - Escape clears, then blurs, and never clears the selection;
    - `/` and Cmd+K or Ctrl+K focus the box;
    - `data-owns-keys` on the results.
  - [x] 10.2 Browser checks:
    - `/` and Cmd+K focus the box;
    - `index.ts` lists the exact matches first;
    - Enter flies to the top result and selects it;
    - typing `wasd` in the box leaves the camera pose unchanged;
    - Escape twice keeps the selection.
  - [x] 10.3 Screenshot test `interface search`: results for `voice` on oikos.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "search"`, then the screenshot.
  - **Commit** with the screenshots.
  - _Requirements: 6_

- [x] 11. Layout and access
  - [x] 11.1 At 1280 × 720 with the list and the detail panel open, no panel's box enters the middle third of the window. Everything is reachable with Tab, with a visible `:focus-visible` ring.
    - **Check:** go through the whole page with Tab, and fail if any focused element has no accessible name.
  - [x] 11.2 Panels open and close without moving the camera. They don't end the opening move unless opened by a click or a key, which end it anyway.
  - [x] 11.3 Screenshot test `interface layout`: the default view at 1280 × 720 with the list and the detail panel open, and the same at 1920 × 1080.
  - **Run:** `npx playwright test e2e/interface.spec.ts -g "layout"`, then the screenshot.
  - **Commit** with the screenshots.
  - _Requirements: 7_

---

## Part 3: Docs and close-out

- [x] 12. Documentation
  - [x] 12.1 **Done.** The repository `README.md` was empty and is now written. In the repository `README.md` and `frontend/README.md`, describe the new flow:
    - a bare address shows the boot screen, then the digging screen, then the scene with its opening move;
    - `?graveyard=<name>` goes straight to the digging screen;
    - Open a graveyard file reads a local `.graveyard.json` in the browser only;
    - the demo list comes from the Vite plugin;
    - the new keys (`/`, Cmd+K or Ctrl+K, and the list keys) go into the controls table.
  - [x] 12.2 In the Kiro write-up notes in `docs/` (create `docs/kiro-notes.md` if the notes aren't there yet), add:
    - how this spec went: requirements reviewed and answered, then the design, then tasks;
    - the flow, boot screen → digging → scene;
    - the properties that guard it;
    - where steering and specs shaped decisions. Examples: Bury only on unused stones, the snapshot-relative ages, and no uploads.
  - [x] 12.3 **Checked: still accurate.** `docs/backlog.md` already records that a file opened from disk isn't kept across a reload. Check that the note is still accurate once task 6 is built.
  - [x] 12.4 Add the new controls to `model/controls-help.ts` (search, list keys). The controls test checks that every new key is listed.
  - _Requirements: 6.2, 7.2_

- [x] 13. **Final checkpoint** **Done (manual check):** all eight items pass. Changes made during the checkpoint: one vocabulary grouped by dimension (stats panel, legend, list, hover, detail panel), one panel per side, signs and other boxes kept out of the way of the grave in focus (a clear view after flyTo, fades otherwise), a thin selection outline, the list redrawn after the details fold it, search giving the keys back to the scene, and the digging screen as a 1.8 s skippable beat.
  - **Run:**
    ```
    cd frontend
    npm run typecheck && npm test
    npm run e2e
    npm run build
    grep -rIl "repoInPeace" dist || echo "ok: no dev hook in dist"
    npm run preview
    ```
  - **Manual checklist** (the dev server, then `npm run preview`):
    1. A bare address shows the boot screen: the typing can be skipped, and Enter opens spatialql. Then the digging screen with real counts, then the scene with its opening move.
    2. A copied `?graveyard=demo.oikosledger` link goes straight to the digging screen.
    3. Open a graveyard file opens a local `demo.oikosledger.graveyard.json`. A copy with `"schemaVersion": 1` shows the version message, and a reload returns to the boot screen.
    4. Hovering shows the summary line, and selecting opens the detail panel on the side away from the stone. `voice/index.ts` offers Bury, an ancient used stone doesn't, and a ghost offers Resurrect, all disabled with the note.
    5. The list sorts, filters and counts. Ghosts come after the stones. Selecting in the scene highlights the row, and `?synthetic=2000` scrolls smoothly.
    6. Search: `/` and Cmd+K focus it, typing never moves the camera, and Enter flies to the top match.
    7. At 1280 × 720 nothing covers the middle of the graveyard, and Tab reaches every control with a visible focus.
    8. Under Reduce motion the boot and digging text appear at once.
  - _Requirements: all_
