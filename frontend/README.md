# Frontend: the graveyard scene

Loads a graveyard data file and draws it as a night-time cemetery with Vite, React, three.js and react-three-fiber. The app has three screens: a boot screen to choose a graveyard, a digging screen while it loads, and the scene with its panels. The data files are made ahead of time by the analyser (`../analyser`); the browser only loads them and never calls the GitHub API.

## Run and test

```
cd frontend
npm install
npm run dev          # http://localhost:5173/
npm run typecheck
npm test             # Vitest: unit and fast-check property tests
npm run e2e          # Playwright, against its own dev server on port 5199 (see below)
npm run build        # production build in dist/
npm run preview      # serves dist/
```

### End-to-end tests

The Playwright tests are in `e2e/` (`e2e/README.md`). They import `test` from `e2e/fixtures.ts`, which turns the opening move off (development builds only) so a check starts at the overview; `e2e/opening.spec.ts` uses Playwright's own `test` and checks the move. Once: `npx playwright install chromium`. Headless Chromium has no GPU, so `playwright.config.ts` passes `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` to draw WebGL in software. If a test page says "WebGL is not available", those flags need changing for your Chromium version (try `--use-gl=angle`, or run with `--headed`). Pictures to judge by eye: `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` (into `test-results/screenshots/`).

## The flow

- **Boot screen** (a bare address): a typed boot in a green terminal style (any key or click shows it all), then the demo graveyards and **Open a graveyard file…**. The active choice has a reverse-video bar with a `>`; Up, Down, Tab and the pointer move it, the focus goes with it, and Enter opens it. A file picked or dropped is read in the browser with the File API and checked like a demo file (a wrong schema version says so and stays on the boot screen); it is never uploaded, and it is not kept across a reload.
- **Digging screen**: the real counts while the file loads and the scene model is built; at least 400 ms, never more than 1 s of added wait.
- **Scene**: the opening move, then the stats panel, legend, search box, list and detail panel. "← Graveyards" and the browser's Back return to the boot screen; leaving a scene frees its GPU resources.

The demo list is `graveyards/index.json`, made from the files in `public/graveyards/` by a Vite plugin (`vite-plugins/graveyard-manifest.ts`): the dev server reads the folder on each request, and a build writes it once. A file that is not a valid version-2 graveyard is left out with a warning. Nobody edits a list by hand.

## Page address

| Parameter | Builds | What it does |
| --- | --- | --- |
| (none) | all | the boot screen |
| `?graveyard=<name>` | all | skips the boot screen and loads `public/graveyards/<name>.graveyard.json`. Choosing a demo on the boot screen sets it, so the address can be shared. Names are 1 to 100 letters, digits, dots, underscores and hyphens; anything else is refused without a request, with a way back to the boot screen. |
| `?synthetic=<n>` | development only | a made-up graveyard of n files (seed 1, at most 20,000) instead of a data file, for the performance check; turns the overlay on |
| `?stats` | development only | the performance overlay: frames per second, the 95th-percentile frame time over the last 300 frames, draw calls and triangles |

## Controls

| Input | Does |
| --- | --- |
| Drag | orbit round the point you look at (at most 50° either side of the opening view) |
| Right-drag, or Shift + drag | pan along the ground |
| Scroll | zoom toward the pointer, and out |
| Hover | the path of a stone or ghost |
| Click a stone or ghost | select it |
| Click empty ground, or Esc | clear the selection |
| Double-click a stone or ghost | fly to it |
| `/`, or Cmd+K (Ctrl+K) | focus the search box (Cmd+K also from inside a field) |
| In search: ↑ ↓, Enter, Esc | move through the results, select and fly to one, clear the text (Esc again leaves the box) |
| In the list: ↑ ↓, Page Up/Down, Home, End, Enter | move through the rows, select and fly to one |
| Double-click empty space | back to the overview (as Reset view) |
| W A S D or the arrows | fly forward, left, back, right |
| E, Q | fly up, down |
| Shift | hold to fly 3 times faster |
| Home or R | reset the view and clear the selection |
| ? | show or hide the controls panel |

On first load the camera rises from a low shot into the overview over about 3.6 seconds; any key, click, drag or scroll ends it where it is, and with Reduce motion on the scene opens on the overview. Reset view goes straight to the overview.

Keys typed in the search box or the list (`data-owns-keys`) never fly the camera or trigger Home, R or ?.

The camera stays above the ground, at least 20° above the horizontal from its look-at point, and inside the trees round the graveyard, whatever moved it (`model/fly-controls.ts`, `clampPose`).

## Data files

`public/graveyards/<name>.graveyard.json`, written by the analyser, with the versioned schema of `../shared/graveyard-schema.ts` (the only place the schema changes). A file of another version shows a message instead of the scene. All ages are relative to the snapshot commit's date, never today, so a file always draws the same scene.

## How the scene is built

- **Pure model, then drawing.** `src/model/` works out everything from the data file: the layout (`layout.ts`), the look of each stone (`visual-params.ts`), signs, picking, camera poses, the horizon, and for the interface the app flow (`app-flow.ts`), the words about a grave shared by the hover line and the detail panel (`grave-facts.ts`), the list's rows, filters and sorts (`list-rows.ts`) and search ranking (`search.ts`). It has no three.js and is unit- and property-tested. `src/scene/` draws it; `src/ui/` holds the panels and labels.
- **Layout.** Every folder is a fenced plot, and nested folders are plots inside it, packed by a skyline packer. Every file is a stone in a block of cells; a stone's height follows its lines of code. The same file always gives the same layout.
- **One source for each effect.** Each effect shows one fact of the data and nothing else: moss shows how long a file has gone untouched (more and higher with age), lean shows that it is ancient, cracks and a faint red glow show that Knip found it unused (and RIP is carved on it), a candle shows that it is hot, a translucent ghost shows a deleted file. Size, the decay score and the other flags never change an effect (property P8 in the spec checks it). Nothing in the scene is decoration that could be taken for data.
- **Draw calls.** Stones, candles, ghosts, fences and plaques are instanced meshes, so the number of draw calls does not grow with the number of files (under 40 with `?synthetic=2000`).

## Why react-three-fiber is pinned to 9

Fiber 10's default renderer is WebGPU. The stone, ghost and sky effects are GLSL patches on three.js's standard materials (`onBeforeCompile`), which work under WebGPU only through its legacy entry point. Keep `@react-three/fiber` at 9 (and drei at the 10 that goes with it, React at 19), and don't upgrade fiber, drei or React without checking that the shaders still compile.

## Development extras are not in production builds

`window.repoInPeace` (the handles the console and the browser tests use), the performance overlay and `?synthetic` are loaded only behind `import.meta.env.DEV`, which is false in a production build, so the build drops them (`model/dev-features.ts` also turns them all off when it is false). To check a build:

```
npm run build
grep -rIl "repoInPeace" dist || echo "ok: no dev hook in dist"
grep -rIl "PerfStats\|synthetic" dist || echo "ok: no perf overlay or synthetic data in dist"
```
