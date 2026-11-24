# Frontend: the graveyard scene

Loads a graveyard data file and draws it as a night-time cemetery with Vite, React, three.js and react-three-fiber. The app has three screens: a boot screen to choose a graveyard, a digging screen while it loads, and the scene with its panels. The data files are made ahead of time by the analyser (`../analyser`); the browser only loads them and never calls the GitHub API (Bury and Resurrect go through the one serverless function, below).

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

- **Landing page** (the bare address, `ui/Landing.tsx`): the full logo, the title in Creepster, the tagline, **Enter the graveyard** and **Take the tour** (both to the boot screen; the guided tour is a later task), and a footer. A static night drawn in SVG, no 3D; the stars twinkle slowly, not at all under reduced motion. Narrow or touch screens add "Best on a desktop browser."
- **Boot screen** (`?boot`): a typed boot in a green terminal style (any key or click shows it all), then the demo graveyards and **Open a graveyard file…**. The active choice has a reverse-video bar with a `>`; Up, Down, Tab and the pointer move it, the focus goes with it, and Enter opens it. A file picked or dropped is read in the browser with the File API and checked like a demo file (a wrong schema version says so and stays on the boot screen); it is never uploaded, and it is not kept across a reload.
- **Digging screen**: the real counts while the file loads and the scene model is built; at least 400 ms, never more than 1 s of added wait.
- **Scene**: the opening move, then the stats panel, legend, search box, list and detail panel. "← Graveyards" and the browser's Back return to the boot screen; leaving a scene frees its GPU resources.

The demo list is `graveyards/index.json`, made from the files in `public/graveyards/` by a Vite plugin (`vite-plugins/graveyard-manifest.ts`): the dev server reads the folder on each request, and a build writes it once. A file that is not a valid version-2 graveyard is left out with a warning. Nobody edits a list by hand.

## Brand

`public/brand/` holds the logo (`logo.svg`: the tombstone with the whole inscription), the small mark (`mark.svg`: stone, shovel and RIP, drawn on the 16 px pixel grid), the favicons (16, 32), the Apple touch icon (180), the app icon (512, in `site.webmanifest`) and the 1200 × 630 social image used by the Open Graph and Twitter tags in `index.html`. All are written by `node scripts/make-brand.mjs` (PNGs rendered with Playwright's Chromium). The carved words are one constant there, `INSCRIPTION`: change it and run the script again for another inscription. The title font, Creepster (SIL Open Font License), is served from `public/fonts/creepster/` with its licence file, used only for the landing page's title and the social image.

## Page address

| Parameter | Builds | What it does |
| --- | --- | --- |
| (none) | all | the landing page |
| `?boot` | all | the boot screen (Enter the graveyard, and "← Graveyards" from a scene, go here) |
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
| M | sound on or off |

On first load the camera rises from a low shot into the overview over about 3.6 seconds; any key, click, drag or scroll ends it where it is, and with Reduce motion on the scene opens on the overview. Reset view goes straight to the overview.

Over the 3D scene the cursor is a skeleton hand (`public/cursors/`, drawn by `scripts/make-cursors.mjs`, 32 and 64 px): pointing, glowing over a stone or ghost, grabbing while dragging. Panels, buttons and inputs keep the standard cursors, and the standard ones stand in if the pictures don't load. The Controls panel shows the three; the legend doesn't (it is decoration, not data).

Keys typed in the search box or the list (`data-owns-keys`) never fly the camera or trigger Home, R or ?.

The camera stays above the ground, at least 20° above the horizontal from its look-at point, and inside the trees round the graveyard, whatever moved it (`model/fly-controls.ts`, `clampPose`).

## The Usage row

The detail panel's Usage row follows Knip's verdict (the stone's cracks) and explains it with the import graph when the data file has one (`importedBy`, `entry`; `src/model/usage.ts`):

| Knip | Who imports it | Usage says |
| --- | --- | --- |
| used | it is an entry point | "Entry point: Next.js page", with ", and imported by N files" when files import it too |
| used | only tests | "Used only by tests" |
| used | other files | "Imported by N files" |
| used | nothing, and not an entry point | "Used (Knip), but no file in the project imports it" |
| unused | nothing | "Unused: nothing in the project imports it (Knip)" |
| unused | only tests | "Unused: only imported by tests" |
| unused | only other unused files (and tests) | "Unused: only imported by other unused files" |
| unused | a used file | "Unused (Knip), though imported by N files" |

Under the words, the first 5 importers are links (name, then "type only" and the folder dimmed) that select the file and fly to it; "+N more" shows the rest in place. An older data file without `importedBy` shows the earlier wording. The hover line adds "imported by N" only when the whole line still fits on one line, measured in its font.

## Sound

Off at the start of every visit; the speaker button (next to Reset view and ?, and top right on the landing page) or M turns it on and off, fading in over a second and out over half a second. The choice lasts for the visit (and is written to localStorage, but never read back to unmute). Everything is made with the Web Audio API, no audio files (`sound/engine.ts`), and the engine is loaded and created only on the first unmute, so a silent visit makes no audio context at all. The context is suspended when muted and while the tab is hidden.

- **Ambient:** crickets (four voices, each at its own pitch and loose rhythm) and an owl's "hoo-hoo… hoo" every 25 to 60 s, panned a little left or right (`owlCalls`).
- **The gravedigger:** a crunchy thrust and a scatter of falling soil for every dig while the request runs, two dull thuds when he pats the mound, a wooden knock for the stake.
- **Resurrection:** a wail rising in pitch and fading with the ghost, a low rumble as the stone forms, and a thunk as it stands (about 2 s).

The timing is pure and shared with the animations (`model/sound-schedule.ts`, played by `scene/SoundDriver.tsx`). Under reduced motion the scene's sounds are skipped with their animations.

## Data files

`public/graveyards/<name>.graveyard.json`, written by the analyser, with the versioned schema of `../shared/graveyard-schema.ts` (the only place the schema changes). A file of another version shows a message instead of the scene. All ages are relative to the snapshot commit's date, never today, so a file always draws the same scene.

## How the scene is built

- **Pure model, then drawing.** `src/model/` works out everything from the data file: the layout (`layout.ts`), the look of each stone (`visual-params.ts`), signs, picking, camera poses, the horizon, and for the interface the app flow (`app-flow.ts`), the words about a grave shared by the hover line and the detail panel (`grave-facts.ts`), the list's rows, filters and sorts (`list-rows.ts`) and search ranking (`search.ts`). It has no three.js and is unit- and property-tested. `src/scene/` draws it; `src/ui/` holds the panels and labels.
- **The sky's events** (decoration, not data: not in the legend, never picked). One schedule (`model/sky-director.ts`, seeded) puts one event in the sky at a time, with 9 to 14 s of quiet between them: the witch first as the opening move settles, then bats, a shooting star and distant lightning in a seeded order, then a seeded choice (the witch 45 s apart at least, lightning 30 s apart). Shooting stars streak through the upper sky in 0.6 to 1 s, never across the moon or its halo. Four to seven bats fly from the side toward the moon, across or beside its disc, and shrink away beyond it in 5 s. Lightning is a dim glow behind the clouds low over the forest, sometimes with a thin forked streak: at most 2 flashes in an event (so never 3 in a second, WCAG 2.3.1), never below 5° of elevation, and no scene light changes, so the graveyard never brightens. All are drawn on one sky quad behind everything (`scene/SkyEvents.tsx`), one draw call while one is on. Under reduced motion none appear.
- **Layout.** Every folder is a fenced plot, and nested folders are plots inside it, packed by a skyline packer. Every file is a stone in a block of cells; a stone's height follows its lines of code. The same file always gives the same layout.
- **One source for each effect.** Each effect shows one fact of the data and nothing else: moss shows how long a file has gone untouched (more and higher with age), lean shows that it is ancient, cracks and a faint red glow show that Knip found it unused (and RIP is carved on it), a candle shows that it is hot, a translucent ghost shows a deleted file. Size, the decay score and the other flags never change an effect (property P8 in the spec checks it). Nothing in the scene is decoration that could be taken for data.
- **Draw calls.** Stones, candles, ghosts, fences and plaques are instanced meshes, so the number of draw calls does not grow with the number of files (under 40 with `?synthetic=2000`).

## Bury and Resurrect: the PR function

On a demo graveyard, **Bury** (an unused stone) opens a pull request that deletes the file, and **Resurrect** (a ghost) opens one that restores it exactly as it was at its last commit. Both go to a **demo fork** of the graveyard's repository, never to the original, and never straight to a branch. The browser never calls GitHub: it asks the one serverless function, `api/pr.ts`, which checks the request against the demo's own data file on the server and then uses the Git Data API. The logic is in `server/pr/` (pure parts tested with fast-check; the GitHub side against a fake GitHub server on 127.0.0.1); the design is in `.kiro/specs/bury-and-resurrect/`.

| | |
| --- | --- |
| `GET /api/pr` | which demos have working actions: `{"available":true,"demos":{…},"fake":…}`, or `{"available":false}` |
| `GET /api/pr?open=<demo>` | the demo's graves with an open Repo In Peace pull request: `{"open":[{"action","path","number","url"}]}`; one GitHub call per fork, cached for a minute |
| `POST /api/pr` | `{"graveyard","action":"bury"\|"resurrect","path"}` → the pull request's number and link, or an `error` |

**The gravedigger.** A Bury is performed by a gravedigger (`model/gravedigger.ts`, pure; `scene/Gravedigger.tsx`): he fades in beside the grave when Bury is confirmed, a little behind it and to one side as seen from the camera, never on another stone's cell, a fence, a plaque or the grave itself. He digs while the request runs; on success the stone sinks when he stops, he pats the mound twice and plants the stake (which rises only then); on an error he leans on his shovel, shakes his head and goes, and the stone stays. Everything lasts at least about 4 s, so it reads even when the request returns at once; the dig ends at the end of the dig in progress, never later. The camera never moves. Under reduced motion, where there's no free place beside the grave, and for Resurrect, there is no gravedigger. He is decoration: not in the legend, not picked, five draw calls while he's on screen and none after.

- **Only demos, only eligible graves.** A graveyard opened from a file keeps the buttons disabled ("Pull requests are only available on the demo graveyards."). The server accepts Bury only for a file its data file marks unused, and Resurrect only for one of its ghosts; it builds the title and body itself, and mentions nobody (`@` and `#123` are neutralised).
- **One pull request per grave.** The branch is `rip/bury/<slug>` or `rip/resurrect/<slug>`; the same request again (or two at once) returns the open pull request.
- **Limits.** 3 pull requests a minute and 20 an hour per client (in memory, per function instance), and at most 50 open ones per fork (counted on GitHub).
- **The scene.** After a Bury the stone sinks and a fresh grave with a stake reading "PR #N" takes its place; after a Resurrect the ghost, which shivers and brightens while the request runs, opens its mouth as if screaming, rises about 3.5 units into the sky faster and faster, stretching and fading out over 1.8 s, and a clean stone with a stake forms on the ground once it is halfway up (`riseFrame` in `model/pr-scene.ts`; the mouth is a hole cut in the ghost shader, `GHOST_MOUTH`). On an error the ghost stops shivering and stays. Reduced motion shows the end at once, with no shiver. Open pull requests are live: when a demo scene loads it asks `GET /api/pr?open=<demo>` which graves have one open on the fork, and shows those at their end state without the animation, the panel saying "Buried: PR #N is open" or "Resurrected: PR #N is open" with the link. Closed or merged ones show nothing, and the graveyard is as its data file says until the file is regenerated.

### Configuration

Environment variables, never prefixed `VITE_` (so never in the browser bundle):

| Variable | Example | |
| --- | --- | --- |
| `GITHUB_TOKEN` | `github_pat_…` | a fine-grained token for the demo forks only: Contents and Pull requests, read and write |
| `RIP_DEMOS` | `{"demo.oikosledger":{"repo":"repo-in-peace-demo/oikos_ledger","base":"main"}}` | demo name to fork and base branch |
| `RIP_PR_CAP` | `50` | optional: open pull requests allowed per fork |

Locally they go in `frontend/.env.local`, which `.gitignore` keeps out of git (check with `git check-ignore -v .env.local`). On Vercel, set them for Production only. The step-by-step setup (organisation, forks, token, Vercel) is at the end of `.kiro/specs/bury-and-resurrect/design.md`.

### Local development

`npm run dev` runs the function too (`vite-plugins/api-dev.ts`). **Without a token** it makes up pull requests after the same checks: the link opens `/api/fake-pr/<n>`, a page that says it's fake, and nothing is sent to GitHub. With a token in `.env.local`, it opens real pull requests on the forks. The browser tests set `RIP_FAKE_PRS=1` for their dev server, which ignores the token, so a test never opens a real pull request.

```
curl -s localhost:5173/api/pr      # {"available":true, ... "fake":true} without a token
```

### Reset

Closes every open Repo In Peace pull request on the forks and deletes every `rip/` branch, and nothing else:

```
npm run reset-demo-prs -- --dry-run     # lists what it would do
npm run reset-demo-prs
```

## Why react-three-fiber is pinned to 9

Fiber 10's default renderer is WebGPU. The stone, ghost and sky effects are GLSL patches on three.js's standard materials (`onBeforeCompile`), which work under WebGPU only through its legacy entry point. Keep `@react-three/fiber` at 9 (and drei at the 10 that goes with it, React at 19), and don't upgrade fiber, drei or React without checking that the shaders still compile.

## Development extras are not in production builds

`window.repoInPeace` (the handles the console and the browser tests use), the performance overlay and `?synthetic` are loaded only behind `import.meta.env.DEV`, which is false in a production build, so the build drops them (`model/dev-features.ts` also turns them all off when it is false). To check a build:

```
npm run build
grep -rIl "repoInPeace" dist || echo "ok: no dev hook in dist"
grep -rIl "PerfStats\|synthetic" dist || echo "ok: no perf overlay or synthetic data in dist"
```
