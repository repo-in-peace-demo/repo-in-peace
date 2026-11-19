# Tasks: Graveyard scene

References are to `requirements.md` and `design.md` in this folder. Every property test uses fast-check; test files sit beside their modules. **I run no commands for this spec.** Commands for you to run are marked **Run**, and each checkpoint says what to look for. Paths are under `frontend/` unless stated.

Order, as agreed: the pure model and its properties first (tasks 2 to 13), then a plain render with boxes and no shader effects so the layout can be seen on real data early (tasks 14 to 20), then the shader effects and atmosphere (tasks 21 to 25), then the dev extras, docs and the final checklist (tasks 26 to 28).

Status key: `[x]` done, `[ ]` not started.

---

## Part 1: Package and pure model

- [x] 1. Frontend package
  - [x] 1.1 Write `package.json` (name `@repo-in-peace/frontend`, `private`, `type: module`, scripts `dev`, `build`, `preview`, `test` = `vitest run --passWithNoTests`, `typecheck` = `tsc --noEmit`; no dependencies listed, so npm picks compatible versions in 1.2), `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `jsx: react-jsx`, `moduleResolution: Bundler`, path alias `@shared` to `../shared`, includes `src`, `test` and `../shared`, excludes `../shared/node_modules` and `../shared/**/*.test.ts`), `vite.config.ts` (React plugin, the same alias, `server.fs.allow` for the repository root, `test` section with the Node environment), `index.html` with a full-window canvas container, `.gitignore` (`node_modules`, `dist`), `src/vite-env.d.ts`.
  - [x] 1.2 **Run:** 
    ```
    cd frontend
    npm install react@19 react-dom@19 three @react-three/fiber@9 @react-three/drei@10
    npm install -D vite @vitejs/plugin-react typescript vitest fast-check @types/react@19 @types/react-dom@19 @types/three @types/node
    npm run typecheck
    ```
    Fiber is pinned to 9 on purpose (see task 27). If npm reports a peer-dependency conflict, send me the message.
  - _Requirements: 12_

- [x] 2. Hash, age and sort (`model/hash.ts`, `age.ts`, `sort.ts`)
  - [x] 2.1 `fnv1a32`, `mix32` (the MurmurHash3 finalizer, added so similar paths do not get similar values), `hash01(text, salt?)`; the published FNV test vectors, an independent BigInt implementation of both steps, and properties that the result is in `[0, 1)`, the same every call, and spread over the range.
  - [x] 2.2 `ageDays`, tested against its definition (whole days, rounded down, never negative, 0 for a date after the snapshot), with the oikos example of 19 days.
  - [x] 2.3 `compareCodePoint` and its properties (zero only for equal strings, antisymmetric, transitive, astral characters ordered by code point).
  - Installed versions (from `package.json`): React 19.3, fiber 9.8, drei 10.7, three 0.187, fast-check 4.10, vitest 4.1, TypeScript 7.0, Vite 8.3. Tests use only fast-check 4 APIs (for example `fc.string({ unit: 'grapheme' })`, not the removed `fc.stringOf`).
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 5.7, 12.1_

- [x] 3. Loading checks (`model/graveyard-load.ts`)
  - [x] 3.1 `parseGraveyardName`, `graveyardUrl`, `checkGraveyardData` as in the design.
  - [x] 3.2 Examples: the default name; `demo.oikosledger`; rejected: empty, 101 characters, `../secret`, `a/b`, `/etc/passwd`, a backslash, a space, a URL, a null character, non-ASCII, markup; a version-1 file gives the version message naming 1 and 2; missing `meta` gives `not-a-graveyard`; a broken folder reference gives `invalid` with details; at most 5 problems shown. Note: the name `..` is allowed by the rule (letters, digits, dots, underscores, hyphens) and is harmless, because the file is then `...graveyard.json` inside `graveyards/`; a test records this. The real files `demo.oikosledger` and `demo.spatialql` are checked and their counts asserted (129 files; 120 files and the two ghosts).
  - [x] 3.3 **P13**: the name check agrees with the regular expression for arbitrary strings, and an accepted name never contains a slash; any `meta.schemaVersion` other than 2 gives `wrong-version`; the check returns a result for any JSON value.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [ ] 4. Stone height (`model/tombstone-height.ts`)
  - [ ] 4.1 `stoneHeight` with the constants from the design.
  - [ ] 4.2 **P7**: never decreases with lines, stays within the minimum and maximum, minimum for 0 and 1, maximum from 5,000 up. Examples at 1, 100, 1,000, 5,000 and 6,451.
  - _Requirements: 3.3_

- [ ] 5. Layout
  - [ ] 5.1 `test/arbitraries.ts`: `graveyardArb` (random tree, deep chain up to 300 levels, one crowded folder up to 600 files, wide trees, mixtures, folders with only children or nothing, ghosts in existing, missing and doubly missing folders), `fileArb`, a seeded `shuffle`, and a test that every generated graveyard passes `validateGraveyard`.
  - [ ] 5.2 `model/layout-constants.ts` with every constant of the design and a comment each. Test: `LEAN_REACH ≥ MAX_STONE_H × sin(MAX_LEAN_DEG)`, and the cell sizes follow from the stone size and the reach.
  - [ ] 5.3 `model/layout.ts`: grouping, ghost placement, block of cells, shelf packing from the leaves up, positions from the root down, sign spots. No recursion.
  - [ ] 5.4 Property tests with a sort-and-sweep overlap helper: **P1** (cells of a folder, sibling plots, a folder's cells against its child plots), **P2** (containment), **P3** (same layout twice and with shuffled arrays), **P4** (one position per file and ghost, one plot per folder), **P6** (ghost placement against an independent oracle), **P10** (all numbers finite; 500 to 800 files in one folder give an aspect ratio of at most 3).
  - [ ] 5.5 Real-data example tests: read `public/graveyards/demo.oikosledger.graveyard.json` and `demo.spatialql.graveyard.json`, check them with `checkGraveyardData`, lay them out, and assert the invariants of P1 to P4 and P10. spatialql: its `src` block is near-square; its two ghosts (`src/data/surface-placement.test.ts`, `src/surface-placement.ts`) sit in the plots `src/data` and `src`.
  - [ ] 5.6 Examples: an empty graveyard (root plot only); a folder with no files; a 300-level chain; a ghost whose whole folder chain is gone goes to the root plot.
  - _Requirements: 2, 3, 4_

- [ ] 6. Visual parameters (`model/visual-params.ts`)
  - [ ] 6.1 `mossAmount`, `leanDegrees`, `stoneVisual`, `ghostVisual`, and `plotFloorShade(depth)`.
  - [ ] 6.2 **P5** (moss never decreases with the decay score within a state and `unused` flag; only ancient stones lean), **P8** (each effect has one source: flipping `unused` changes only cracks and glow; flipping `hot` only the candle; changing `decayScore` changes nothing; changing the age within a state changes only moss and, for ancient, lean), **P9** (moss ranges per state and the value 1 from the decay cap on), **P17** (floor tint: 1 at the root, never lighter with depth, within 0.70 to 1, constant from depth 6).
  - [ ] 6.3 Edge examples with thresholds 21/45/cap 90: age 20 is fresh and clean; 21 and 44 and 45 are stale (45 still stale); 46 is ancient; 90 and 500 give moss 1 and lean 10. The fresh unused file (`app/components/voice/index.ts`, 19 days old, score 0.6844) is clean, upright, cracked and glowing. A file whose state and age disagree shows its state's range.
  - [ ] 6.4 Test that `leanDegrees` never exceeds `MAX_LEAN_DEG`, the constant the layout reserved room for.
  - _Requirements: 3.6, 5_

- [ ] 7. Signs (`model/signs.ts`)
  - [ ] 7.1 `buildSignSources`, `visibleSigns` as in the design.
  - [ ] 7.2 **P14**: one sign spot per plot on the front edge overlapping no cell, ghost or child plot; at most 30 shown; opacity in `[0, 1]` and never rising as the camera moves away; none beyond `far`; independent of the order of sources; at the start pose the root's opacity is above 0.
  - [ ] 7.3 Examples: labels (the repository name for the root, the last segment otherwise); a sign behind the camera is dropped; the nearest 30 of 200 are kept, ties by path.
  - _Requirements: 10_

- [ ] 8. Legend and statistics (`model/legend.ts`, `stats.ts`)
  - [ ] 8.1 `buildLegend` (entries: fresh, moss, ancient, unused, hot, ghost, floor) and `computeStats`.
  - [ ] 8.2 **P11**: the legend text contains the real numbers (staleAfter, ancientAfter, hotCommits, hotWindow, and the snapshot date) and the floor entry; fresh + stale + ancient = files; unused, hot and ghosts match a direct count.
  - [ ] 8.3 Examples: thresholds 21/45/5/30 give "21 or more days", "more than 45 days", "5 or more commits in the 30 days"; thresholds 1/2/1/1 read in the singular ("1 day", "1 commit"); the floor entry reads "Darker ground: a folder nested deeper."
  - _Requirements: 9_

- [ ] 9. Camera poses (`model/camera-pose.ts`)
  - [ ] 9.1 `startPose`, `flyToPose`, `interpolatePose`, `easeInOutCubic`.
  - [ ] 9.2 **P12**: for every file and ghost of a generated graveyard the pose is finite, above the ground, with the target inside the bounds padded by the stone's height; `undefined` for an unknown path. **P16**: interpolation reaches both end poses, stays finite, and keeps the camera above the ground between two poses above it.
  - [ ] 9.3 Examples: the start pose of a tiny graveyard keeps the minimum distance of 20; easing is 0 at 0, 1 at 1 and 0.5 at 0.5.
  - _Requirements: 7_

- [ ] 10. Picking (`model/pick.ts`)
  - [ ] 10.1 `buildPickTargets`, `pickNearest` (ray against boxes, nearest wins, ties by path).
  - [ ] 10.2 **P15**: a ray through the middle of a target's box hits that target or something nearer; a ray that misses everything hits nothing; the answer does not depend on the order of the targets.
  - [ ] 10.3 Examples: two stones in line, the nearer wins; a leaning stone's box is wider than an upright one; a ray pointing away from a box misses it.
  - _Requirements: 8_

- [ ] 11. Selection store (`store/selection-store.ts`)
  - [ ] 11.1 `getSelection`, `select`, `clearSelection`, `subscribeSelection`, `useSelection`.
  - [ ] 11.2 Tests: selecting notifies once; selecting the same value does not notify; clearing publishes `null`; unsubscribing stops notifications; it works with no React involved.
  - _Requirements: 8.3 to 8.6_

- [ ] 12. Synthetic graveyard and scene model
  - [ ] 12.1 `model/synthetic.ts` (seeded generator; shapes `tree`, `flat`, `deep`); tests: valid against `validateGraveyard`, the same arguments give the same file, the requested number of files.
  - [ ] 12.2 `model/scene-model.ts` (`buildSceneModel`) and a test that its lookup has exactly one entry per file and ghost.
  - [ ] 12.3 Speed guards: a 2,000-file synthetic graveyard lays out in under 1 second; a 300-level chain lays out without error.
  - _Requirements: 11.2, 11.3, 11.6_

- [ ] 13. **Checkpoint A: the model is complete**
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - Look for: all tests pass, including the two real-data tests. Send me any failure; fast-check prints a small counterexample that usually shows the bug.

---

## Part 2: Plain render with boxes

- [ ] 14. App shell and loading
  - [ ] 14.1 `ui/useGraveyardLoad.ts` (the only fetch; states `loading`, `error`, `ready`), `ui/StatusMessage.tsx`, a WebGL check before the canvas is created, `App.tsx`, `main.tsx`, and a small `index.css` (full-window canvas, dark background, overlay positions).
  - [ ] 14.2 Messages for: bad name, file not found, not JSON, wrong version (naming both versions), invalid file (first errors), no WebGL, loading. All text, never HTML from the data.
  - _Requirements: 1_

- [ ] 15. Plain scene
  - [ ] 15.1 `model/fences.ts`: `fenceInstances(layout)` (posts every 1.5 units, one rail per side, the front rail split to leave a gate gap) with tests: every post lies on a plot's boundary, no instance on a gate gap, the number of posts grows with the perimeter.
  - [ ] 15.2 `scene/SceneCanvas.tsx` (canvas, pixel ratio capped at 2, one plain directional and one hemisphere light, a flat dark ground), `PlotFloors` (one instanced quad per plot, tinted with `plotFloorShade(depth)`), `Fences` (instanced posts and rails), `Stones` (an instanced **plain box** per stone, correct position and height, upright, one grey colour), `Ghosts` (an instanced plain translucent box at each ghost's cell, raised), `Plaques` (an instanced plain board per sign spot).
  - _Requirements: 2, 3, 4, 5.9, 11.1_

- [ ] 16. Camera
  - [ ] 16.1 `scene/CameraRig.tsx`: drei `OrbitControls` (left orbit, right pan, wheel zoom, damping, no going below the ground, distance limits from the bounds), the start pose, keyboard flying (W A S D and arrows, Q and E, Shift; ignored in inputs and with Ctrl, Alt or Meta).
  - [ ] 16.2 `scene/flight.ts` and `scene/api.ts`: `flyTo(path)` returns `true` and starts a 1,000 ms eased flight; `false` for an unknown path or before the scene is ready; any camera input ends the flight.
  - [ ] 16.3 Tests for the flight state machine (idle, flying, finishes at 1,000 ms, cancelled by input) with an injected clock.
  - _Requirements: 7_

- [ ] 17. Overlays
  - [ ] 17.1 `ui/StatsPanel.tsx` (repository name, snapshot date and short SHA, the counts), `ui/Legend.tsx` (one row per entry with a swatch, the snapshot date, a collapse button), `ui/KeysHelp.tsx`.
  - _Requirements: 9_

- [ ] 18. Picking, hover and selection
  - [ ] 18.1 `scene/Picker.tsx`: canvas pointer listeners, at most one pick per frame, hover on change only, click (under 5 px and 500 ms) selects or clears, Escape clears. The meshes are not raycast.
  - [ ] 18.2 `ui/HoverLabel.tsx` (file name and dimmed folder path, "ghost" prefix, follows the pointer), a **plain** highlight (an instance colour change for hover and selected), `scene/SelectionRing.tsx`.
  - [ ] 18.3 A selection made by calling `select(...)` from outside the scene updates the highlight and ring.
  - _Requirements: 8_

- [ ] 19. Signs
  - [ ] 19.1 `ui/SignLayer.tsx`: a fixed pool of 30 elements; updated only when the camera moved; text, position and opacity from `visibleSigns`; projected with the camera; hidden when unused.
  - _Requirements: 10, 11.5_

- [ ] 20. **Checkpoint B: the layout on real data**
  - **Run:** `cd frontend && npm run dev`, then open:
    - `http://localhost:5173/` (the default, spatialql)
    - `http://localhost:5173/?graveyard=demo.oikosledger`
  - Look for: plots nested inside plots; the 68 files of `src` as a near-square block; oikos as a deep tree with a stone or two in each plot; the two ghost boxes in the plots of `src` and `src/data`; signs appearing as you approach; fences with a gate gap at each sign; deeper floors slightly darker; hover label and click selection; flying with the keys and `?graveyard=` with a bad name giving a message. Nothing should overlap. Tell me what looks wrong or too empty, before the shader work starts.

---

## Part 3: Effects and atmosphere

- [ ] 21. Stones with effects
  - [ ] 21.1 The tombstone geometry (rounded top, attribute `aTop`), and `scene/stone-material.ts`: a `MeshStandardMaterial` patched with `onBeforeCompile` for the arch-preserving height, weathered surface noise, moss rising from the base by `aMoss`, cracks and red glow by `aCrack`, and the pale rim highlight by `aHighlight`.
  - [ ] 21.2 `Stones.tsx` writes `aHeight`, `aMoss`, `aCrack`, `aHighlight`, `aSeed`, and builds each instance matrix with position and lean (rotation about the base, direction from the visual's `leanDirection`). A hover or selection change writes one element.
  - [ ] 21.3 Replace the plain highlight of task 18 with the rim.
  - _Requirements: 5.1 to 5.4, 8.1, 8.2_

- [ ] 22. Candles (`scene/Candles.tsx`)
  - [ ] 22.1 Instanced wax and flame for each stone with `candle`, in front of the stone's base inside its cell; the flame flickers by time and the stone's phase; a glow quad in the flame's shader; no real lights.
  - _Requirements: 5.4, 11.4_

- [ ] 23. Ghosts (`scene/ghost-material.ts`, `Ghosts.tsx`)
  - [ ] 23.1 A translucent sheet-like figure (instanced, `depthWrite` off), floating with `floatAmplitude`, `floatSpeed` and the phase in the vertex shader; the plain box of task 15 is replaced.
  - _Requirements: 5.5_

- [ ] 24. Atmosphere (`scene/Atmosphere.tsx`, `Ground.tsx`)
  - [ ] 24.1 Sky dome with a gradient that follows the camera, about 900 stars from `hash01`, a moon, the moonlight directional light and a dim hemisphere light, `FogExp2` with `density = 0.35 / max(boundsRadius, 40)`, and a dark ground with faint noise. No shadow maps. All colours and intensities in one constants file. Nothing here depends on file data.
  - _Requirements: 6_

- [ ] 25. Density review and tuning
  - [ ] 25.1 With both test files, look at the density in the browser. A graveyard should feel crowded rather than sparse: if it looks empty, tighten `MAX_STONE_H`, `MAX_LEAN_DEG` (and so `LEAN_REACH`), `CELL_GAP`, `ITEM_GAP` and `FENCE_BAND` in `layout-constants.ts`, in one pass. The reservation for the largest lean stays constant.
  - [ ] 25.2 After any change **all properties must still pass** (the constant relationship test of 5.2 included). Record the final values and the reason in `design.md`.
  - [ ] 25.3 **Run:** `cd frontend && npm test`; then look at both files and the `?synthetic=2000` view again once task 26 is done.
  - _Requirements: 3.6, 3.7_

---

## Part 4: Development extras, docs and the final checklist

- [ ] 26. Development-only extras
  - [ ] 26.1 `ui/PerfStats.tsx` (frames per second, the 95th-percentile frame time over the last 300 frames, draw calls and triangles from `renderer.info`), `window.repoInPeace = { flyTo, getSelection, select, clearSelection }`, and `?synthetic=<n>` using `makeSyntheticGraveyard`. Each is behind `import.meta.env.DEV` so the production build drops it.
  - [ ] 26.2 A test that the module which installs the development hooks does nothing when `DEV` is false.
  - [ ] 26.3 **Run** (checks that nothing ships):
    ```
    cd frontend
    npm run build
    grep -rIl "repoInPeace" dist || echo "ok: no dev hook in dist"
    grep -rIl "PerfStats\|synthetic" dist || echo "ok: no perf overlay or synthetic data in dist"
    ```
    Both greps must print the "ok" line. If one lists a file, send it to me.
  - _Requirements: 11.3_

- [ ] 27. Documentation
  - [ ] 27.1 `frontend/README.md`: how to run and test; the URL parameters (`graveyard`, and the development-only `synthetic` and `stats`); the keys; the data file naming (`<name>.graveyard.json`, default `demo.spatialql`); the layout and the single-source rule for effects; **why fiber is pinned to 9**: v10's default renderer is WebGPU, and the GLSL patches on the standard materials used here (`onBeforeCompile`) work there only through its legacy entry, so do not upgrade fiber, drei or React without checking; that dev extras are not in production builds.
  - [ ] 27.2 A line in `docs/` that the scene uses no third-party models, textures, fonts or sounds (everything is procedural), so there is nothing to credit.
  - _Requirements: 6.2_

- [ ] 28. **Final checkpoint and manual checklist**
  - **Run:**
    ```
    cd frontend
    npm run typecheck
    npm test
    npm run build
    npm run preview        # then open the printed address
    ```
    and, for the development checks, `npm run dev`.
  - Manual checklist, in the browser (`?graveyard=demo.oikosledger` and the default spatialql):
    1. **A fresh but unused stone.** In oikos, `window.repoInPeace.flyTo('app/components/voice/index.ts')` (dev server). It is 19 days old under thresholds 21/45, so it must be **clean and upright, and cracked with a faint red glow**. Hover shows `index.ts` and `app/components/voice`. Click: it is selected, `window.repoInPeace.getSelection()` returns `{ kind: 'file', path: 'app/components/voice/index.ts' }`.
    2. **States.** In oikos find a stone with moss and one leaning and heavily overgrown; compare a stale unused stone and a stale used stone of similar age: their moss must look alike (unused only adds cracks).
    3. **The two spatialql ghosts.** `flyTo('src/surface-placement.ts')` and `flyTo('src/data/surface-placement.test.ts')`: each is a translucent figure, floating gently, in the plot of its old folder (`src` and `src/data`).
    4. **Hot.** A stone with a candle (oikos has 7 hot files, for example the `route.ts` files under `app/app/api`) shows a lit candle at its base; stones without one show none.
    5. **Signs.** Fly from the starting view down into a small folder and out again: the root's name is readable at the start; a leaf folder's sign appears only as you get close and fades smoothly as you leave; no more than a handful of signs at once; never any in the empty distance.
    6. **Selection.** Click a stone, drag to orbit (selection does not change), click empty ground (clears), click again and press Escape (clears).
    7. **Camera.** Orbit, pan, zoom, W A S D, Q and E, Shift; the camera never goes below the ground; any input ends a `flyTo`.
    8. **Overlays.** The legend shows the real numbers (21, 45, 5 and 30 for oikos; 14, 30, 5 and 30 for spatialql), the floor entry, and collapses; the counts match: oikos 129 files and 12 unused, spatialql 120 files and 2 ghosts.
    9. **Atmosphere.** Dark sky, moon, stars, fog hiding the far edge, nothing that changes with a file's data.
    10. **Errors.** `?graveyard=nope` shows "not found"; `?graveyard=../x` shows the bad-name message and makes no request (see the network panel); an old version-1 data file shows the version message.
    11. **Performance** (dev server): `?synthetic=2000`, fly around for a minute: the overlay shows under 40 draw calls and a 95th-percentile frame time of 20 ms or less on your laptop.
    12. **Production build** (`npm run preview`): no performance overlay, no `window.repoInPeace`, `?synthetic=2000` does nothing special.
  - Send me anything that fails. When all items pass, the spec is done.
  - _Requirements: all_
