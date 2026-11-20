# Frontend: the graveyard scene

Loads a graveyard data file and draws it as a night-time cemetery with Vite, React, three.js and react-three-fiber. The data files are made ahead of time by the analyser (`../analyser`); the browser only loads them and never calls the GitHub API.

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

The Playwright tests are in `e2e/` (`e2e/README.md`). Once: `npx playwright install chromium`. Headless Chromium has no GPU, so `playwright.config.ts` passes `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` to draw WebGL in software. If a test page says "WebGL is not available", those flags need changing for your Chromium version (try `--use-gl=angle`, or run with `--headed`). Pictures to judge by eye: `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` (into `test-results/screenshots/`).

## Page address

| Parameter | Builds | What it does |
| --- | --- | --- |
| `?graveyard=<name>` | all | loads `public/graveyards/<name>.graveyard.json`. The default is `demo.spatialql`. Names are 1 to 100 letters, digits, dots, underscores and hyphens; anything else is refused without a request. |
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
| Double-click empty space | back to the overview (as Reset view) |
| W A S D or the arrows | fly forward, left, back, right |
| E, Q | fly up, down |
| Shift | hold to fly 3 times faster |
| Home or R | reset the view and clear the selection |
| ? | show or hide the controls panel |

The camera stays above the ground, at least 20° above the horizontal from its look-at point, and inside the trees round the graveyard, whatever moved it (`model/fly-controls.ts`, `clampPose`).

## Data files

`public/graveyards/<name>.graveyard.json`, written by the analyser, with the versioned schema of `../shared/graveyard-schema.ts` (the only place the schema changes). A file of another version shows a message instead of the scene. All ages are relative to the snapshot commit's date, never today, so a file always draws the same scene.

## How the scene is built

- **Pure model, then drawing.** `src/model/` works out everything from the data file: the layout (`layout.ts`), the look of each stone (`visual-params.ts`), signs, picking, camera poses, the horizon. It has no three.js and is unit- and property-tested. `src/scene/` draws it; `src/ui/` holds the panels and labels.
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
