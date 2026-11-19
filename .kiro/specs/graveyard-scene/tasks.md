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

- [x] 4. Stone height (`model/tombstone-height.ts`)
  - [x] 4.1 `stoneHeight`, with its three constants (`MIN_STONE_H`, `MAX_STONE_H`, `LOC_AT_MAX_HEIGHT`) in `model/layout-constants.ts`, which is created here so that requirement 3.7 (one module for every layout number) holds from the start; task 5.2 adds the rest.
  - [x] 4.2 **P7**: never decreases with lines, stays within the minimum and maximum and is finite, minimum for 0 and 1, maximum from 5,000 up, strictly taller for more lines below the cap. Examples at 0, 1, 10, 100, 1,000, 4,999, 5,000, 6,451 and infinity; doubling the lines adds the same height anywhere below the cap (it is a log scale).
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 3.3_

- [x] 5. Layout
  - [x] 5.1 Generators, built on the synthetic graveyard builder (which also covers task 12.1, because requirement 12.4 wants the tests and the performance check to share one builder): `model/prng.ts` (seeded Mulberry32, `intBetween`, `pick`), `model/synthetic.ts` (`makeSyntheticGraveyard`, shapes `tree`, `flat`, `deep`, `wide`, `mixed`; valid against `validateGraveyard`), `test/arbitraries.ts` (`graveyardArb`, `smallGraveyardArb`, `crowdedGraveyardArb` for 500 to 800 files in one folder, `deepGraveyardArb` for chains 100 to 300 deep, `thresholdsArb`, a seeded `shuffled` and `shuffledGraveyard`), `test/make-graveyard.ts` (`graveyardFrom`, for hand-made example graveyards), `test/real-data.ts`. Tests: `prng.test.ts`, `synthetic.test.ts` (including that every generated graveyard passes the validator, in every shape).
  - [x] 5.2 `model/layout-constants.ts`: the rest of the constants, a comment each. `layout-constants.test.ts` checks the relationships that must hold whatever the values are tuned to: `LEAN_REACH ≥ MAX_STONE_H × sin(MAX_LEAN_DEG)`, cells are the stone plus the reach, pitch is cell plus gap, the plaque fits the fence band.
  - [x] 5.3 `model/rect.ts` (`Rect`, `overlaps`, `contains`, tolerance 1e-9) and `model/layout.ts`: grouping, ghost placement, `blockShape`, `packRows` (shelf packing), sizes from the leaves up, positions from the root down, sign spots, no recursion. The layout also returns `blocks` (the rectangle of each folder's block of cells), which the design did not list.
  - [x] 5.4 Property tests in `layout.property.test.ts`, with the checkers in `test/layout-checks.ts` (a sort-and-sweep overlap check) and `test/layout-checks.test.ts` (the checkers are shown to fail on broken layouts, so the properties cannot pass for nothing): **P1**, **P2**, **P3** (twice, shuffled, input not changed), **P4**, **P6** (independent oracle; ghosts after the stones), **P10** (finite; crowded folder at most 3 times longer than wide).
  - [x] 5.5 Real-data tests in `layout.test.ts`: both test files lay out with no problem of any kind; oikos has 68 plots and 129 stones; spatialql has the plots `''`, `src`, `src/data`, a 69-cell `src` block (68 files and a ghost) that is near-square, and its two ghosts in `src/data` and `src`.
  - [x] 5.6 Examples in `layout.test.ts`: an empty graveyard, one stone, ordering, a 300-level chain, 600 files in one folder, 300 sibling folders, folders with nothing in them, names with spaces and non-ASCII characters, and ghost placement for an existing folder, a missing one, several missing levels and no existing ancestor but the root.
  - Example tests compute their expected numbers from the constants where they can, so the density review (task 25) can tune the constants without rewriting them.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 2, 3, 4_

- [x] 6. Visual parameters (`model/visual-params.ts`)
  - [x] 6.1 `model/visual-constants.ts` (the shapes of the curves: moss levels, lean minimum, glow, ghost opacity and float, floor tint range) and `model/visual-params.ts`: `mossAmount`, `leanDegrees`, `stoneVisual`, `ghostVisual`, `plotFloorShade(depth)`. None of them can read the decay score, size, recent commits or folder.
  - [x] 6.2 `visual-params.property.test.ts`: **P5** (moss does not decrease when the score rises, for files in the same state with the same `unused` flag; only ancient stones lean, never past `MAX_LEAN_DEG`), **P8** (flipping `unused` changes only cracks and glow; flipping `hot` only the candle; any decay score gives the same look; size, recent commits, folder, author and eulogy are ignored; changing the age within a state leaves cracks, glow, candle and hash variety alone; changing only the path leaves every data effect alone), **P9** (moss ranges per state, monotone in age, 1 from the decay cap on), **P17** (floor tint). Test helpers added to `test/arbitraries.ts`: `makeFileCase`, `fileCaseArb`, and an oracle copy of the analyser's state and score rules. P5's "when the score rises" is strict (`score₁ < score₂`), because scores are rounded and two ages can share one.
  - [x] 6.3 `visual-params.test.ts`: edge examples with thresholds 21/45/cap 90 (age 20 fresh and clean; 21, 44 and 45 stale, 45 still below the heavy level; 46 ancient; 90 and later full moss and the largest lean), a state that disagrees with the age follows the state, the fresh unused stone of the oikos file (`app/components/voice/index.ts`, 19 days old) is clean, upright, cracked and glowing, all three effects at once on one stone, ghost parameters, floor tint, and constants that keep the ordering (every stale amount below the heavy level, the lean minimum below the largest lean).
  - [x] 6.4 Test that `leanDegrees` never exceeds `MAX_LEAN_DEG`, the constant the layout reserved room for (in the property tests for any age and state, and in the examples).
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 3.6, 5_

- [x] 7. Signs (`model/signs.ts`)
  - [x] 7.1 `model/vec3.ts` (points and directions as plain `{x, y, z}` objects, with tests; the camera and picking code use it too) and `model/signs.ts`: `buildSignSources`, `signOpacity` (1 up to near, 0 from far, a smooth fall between), `visibleSigns`. The camera's `fovY` is in degrees, as three.js takes it.
  - [x] 7.2 `signs.property.test.ts` (**P14**): one source per plot, anchored at the plaque on the middle of the front edge, overlapping no stone, ghost or child plot; labels (repository name for the root, last segment otherwise); near distance grows with the plot and far is a fixed multiple of it; at most 30 shown (or the limit given); opacity from the minimum to 1; none beyond `far` or out of view; nearest first; every sign that clearly qualifies is shown unless 30 nearer ones fill the screen; independent of the order of the sources; opacity never rises as the camera moves away. The last part of P14, that the root's opacity is above 0 at the start pose, is tested in task 9, where the start pose is defined.
  - [x] 7.3 `signs.test.ts`: the fade (0.5 halfway), a sign in front, behind, at the side, just outside the screen but inside the margin, and past it; a camera looking in any direction and with a forward vector that is not of length 1; the nearest first with ties by path; the nearest 30 of 50, not the first 30 in the list; the real files' labels.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 10_

- [x] 8. Legend and statistics (`model/legend.ts`, `stats.ts`)
  - [x] 8.1 `buildLegend` (returns `{ snapshotLine, entries }`; entries fresh, moss, ancient, unused, hot, ghost, floor; `snapshotDay` gives the YYYY-MM-DD) and `computeStats` (files, folders, ghosts, fresh, stale, ancient, unused, hot).
  - [x] 8.2 **P11**: in `legend.test.ts`, each threshold number is read back out of the entry that explains it and equals the data file's (staleAfter in the clean-stone and moss entries, ancientAfter in the ancient entry, hotCommits and hotWindow in the candle entry); exactly the seven entries, each once, with words; the ground-tint entry says deeper folders are darker; changing the thresholds changes only the entries that carry a number; the snapshot day appears. In `stats.test.ts`: fresh + stale + ancient = files; unused, hot, ghosts and folders match a direct count; independent of the order of the files.
  - [x] 8.3 Examples: thresholds 21/45/5/30 give the exact texts ("Untouched 21 or more days. More moss the longer it has been untouched.", "Untouched more than 45 days.", "5 or more commits in the 30 days before the snapshot."); 1/2/1/1 read in the singular ("under 1 day", "in the 1 day before"); the real files' counts (oikos: 129 files, 68 folders, 0 ghosts, 12 unused, 7 hot; spatialql: 120 files, 3 folders, 2 ghosts, 2 unused, 24 hot).
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 9_

- [x] 9. Camera poses (`model/camera-pose.ts`)
  - [x] 9.1 `startPose`, `buildFlyTargets` (a map of every stone and ghost, which the scene model will hold), `flyToPose(targets, path)`, `interpolatePose`, `easeInOutCubic`. `GHOST_HEIGHT` and `GHOST_FLOAT_BASE` added to `visual-constants.ts` for the ghost's aim point. **A fix found while writing the root-sign test:** `SIGN_NEAR_PER_SIZE` is now 1 (was 0.6). With 0.6 the root sign had already faded out at the starting view of a graveyard more than about 160 units across; with 1 it is readable at any size. The reason is in the comment on the constant and in `design.md`.
  - [x] 9.2 `camera-pose.property.test.ts`: **P12** (for every file and ghost of a generated graveyard the pose is finite, above the ground, aimed inside the bounds padded by 5, 8 to 40 units from its target, and the stone is well inside the view; targets are exactly the files and ghosts; nothing for unknown paths or folders), **P16** (both end poses reached exactly, finite at any time, camera above the ground, rise at most 30 above the straight line, target on a straight line, horizontal progress never goes backwards), and the last part of **P14**: for graveyards of any shape and size, with a field of view of 45 to 100 degrees and aspect 1 to 2.4, the root's sign is shown, in view, with opacity above 0 at the starting pose.
  - [x] 9.3 `camera-pose.test.ts`: examples. The start pose of a tiny graveyard keeps the minimum distance of 20, a 400 by 300 graveyard is fitted with 15% to spare, easing is 0, 0.5 and 1 and slow at both ends, a stone is aimed at 55% of its height from in front and above at 3.5 × height + 6, a ghost at the middle of its floating figure, a long flight rises 30 and a 100-unit flight rises 15. The real files: the oikos fresh unused stone and both spatialql ghosts can be flown to; the root's name is shown at the start (opacity above 0.3) for both real files and for 2,000-file graveyards of every shape.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 7_

- [x] 10. Picking (`model/pick.ts`)
  - [x] 10.1 `buildPickTargets(stones, ghosts)` (takes plain numbers, so it does not depend on the scene model that is built in task 12; `GHOST_W` and `GHOST_D` added to `visual-constants.ts`), `rayBoxDistance`, `pickNearest` (slab test against every box, nearest wins, ties by smaller path, a ray with no direction hits nothing).
  - [x] 10.2 `pick.property.test.ts` (**P15**): a ray from in front and above through the middle of a target's box hits that target or something nearer; rays pointing up or away hit nothing; the answer does not depend on the order of the targets; the picked box is nearest, and the reported hit lies on or in it; an independent check that walks along the ray in small steps and asks whether the point is inside a box (what the walk finds, the exact test finds at least as near). On both real files, a ray from the starting camera to the middle of each stone and ghost hits it or something in front of it; a ray straight down onto any spatialql stone finds that stone.
  - [x] 10.3 `pick.test.ts`: the boxes of an upright and a leaning stone and of a ghost; two stones in line, the nearer wins whatever the list order; passing above or beside a stone misses; a leaning stone is easier to hit; a ray pointing away or at something behind the origin misses; an origin inside a box hits it at distance 0; rays along an axis; a ghost is hit only within the range it floats through; ties; a direction vector of any length.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 8_

- [x] 11. Selection store (`store/selection-store.ts`)
  - [x] 11.1 `getSelection`, `select`, `clearSelection`, `subscribeSelection`, `useSelection` (React's `useSyncExternalStore`). No library. The store keeps its own frozen copy of what it is given, returns the same object until the selection changes, tells listeners with the new state already in place, and keeps telling the others when one listener throws (it reports the error with `console.error`).
  - [x] 11.2 `selection-store.test.ts`: selecting notifies once; selecting the same stone again, even through a different object, does not; a file and a ghost with the same path are different; clearing publishes `null` and clearing nothing says nothing; unsubscribing stops notifications (twice is harmless; the same function subscribed twice is two subscriptions); a listener can change the selection or unsubscribe itself while being told; the store's copy is not changed by editing the object passed in; `useSelection` renders the current selection (checked with React's server renderer, no browser); and a property test over any sequence of selects and clears: the end state is the last action and listeners are told exactly once for each real change. Every test removes the listeners it adds, so none leaks into the next test.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 8.3 to 8.6_

- [x] 12. Synthetic graveyard and scene model
  - [x] 12.1 `model/synthetic.ts` and its tests: done in task 5.1, because the layout properties are built on it.
  - [x] 12.2 `model/scene-model.ts` (`buildSceneModel`): layout, a stone and a ghost model for every file and ghost (with their look), a floor for every plot, the lookup by path, statistics, legend, sign sources, pick boxes, fly targets and the starting pose, all once. `DEFAULT_FOV_Y` (50) added to `camera-pose.ts`. `scene-model.test.ts`: the lookup has exactly one entry per file and ghost and each points at the right item (also for generated graveyards of every shape); stones and ghosts are in the layout's order with their own layout and look; one pick box, fly target, sign and floor for what it should; the same model every time and for shuffled input; the real files can all be found, flown to and picked; the oikos fresh unused stone is clean, upright and cracked; the spatialql ghosts have their look; an empty graveyard; the data file is not changed.
  - [x] 12.3 Speed guards in `scene-model.test.ts`, which catch a slowdown that grows with the square of the size and not a few milliseconds: 2,000 files of every shape lay out in under 1 second and the whole model builds in under 2; a chain of 1,000 folders builds without running out of stack; 300 picks among 2,000 stones and 500 sign selections take under a second.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - _Requirements: 11.2, 11.3, 11.6_

- [x] 13. **Checkpoint A: the model is complete**. The whole suite (`npm run typecheck && npm test`) passed after task 12.
  - **Run:** `cd frontend && npm run typecheck && npm test`
  - Look for: all tests pass, including the two real-data tests. Send me any failure; fast-check prints a small counterexample that usually shows the bug.

---

## Part 2: Plain render with boxes

- [x] 14. App shell and loading. Tests pass; the browser check is done together with checkpoint B (task 20)
  - [x] 14.1 `ui/fetch-graveyard.ts` (the only fetch, with the fetch passed in so the failure cases are tested without a browser; a development server's HTML answer for a missing file counts as not found), `ui/useGraveyardLoad.ts` (states `loading`, `error`, `ready`; cancels the request when it starts again), `ui/webgl.ts` (`hasWebGL`), `ui/StatusMessage.tsx`, `App.tsx`, `main.tsx` and `index.css` (full-window dark page, browser font stacks only). Until the scene is added, a loaded graveyard shows its name and counts (built through `buildSceneModel`), so loading and the model can be seen working on real files.
  - [x] 14.2 Messages, all plain text, for: name not allowed, file not found, server error, network error, not JSON, not a graveyard file, wrong schema version (naming both versions), invalid file (first five problems), no WebGL, loading. Tests: `fetch-graveyard.test.ts` (every case above plus a cancelled request, exactly one request, the real files) and `webgl.test.ts`.
  - **Run:** `cd frontend && npm run typecheck && npm test`, then see it in the browser:
    ```
    npm run dev
    ```
    and open `http://localhost:5173/` (the default, spatialql) and `http://localhost:5173/?graveyard=demo.oikosledger`. Each shows its name, counts and states. Try `?graveyard=nope` (expect "Graveyard not found"), `?graveyard=../x` (expect "Name not allowed", and no request in the browser's network panel) and `?graveyard=` (expect "Name not allowed").
  - _Requirements: 1_

- [x] 15. Plain scene. Tests pass; the page is looked at together with the camera at checkpoint B (task 20)
  - [x] 15.1 `model/fences.ts`: `fenceForPlot` and `fenceInstances` (posts at most 1.5 units apart, corners shared, five rails per plot with the front split to leave a gate gap of the plaque's width plus 0.8, the fence line just inside each plot's edge). `fences.test.ts`: every post on the fence line and none in a gate, a post at each side of the gate, the rails add up to the fence minus the gate, no rail across the gate, spacing, the smallest plot, any plot size (property), five rails per plot and no post shared between plots in any generated graveyard, and sensible counts for the real files.
  - [x] 15.2 `scene/`: `instances.ts` (the matrix helper and the no-raycast function), `colors.ts` (the plain colours), `Ground.tsx` (the ground and `PlotFloors`: one instanced quad per plot, tinted by `plotFloorShade`, drawn first and in plot order without depth so a plot's floor lies over its parent's), `Fences.tsx` (two instanced meshes), `Stones.tsx` (plain grey boxes for stones, as tall as their lines of code; plain translucent boxes for ghosts), `Plaques.tsx` (a post and a board as one merged shape, one instanced mesh), `SceneCanvas.tsx` (the canvas, a pixel ratio of at most 2, hemisphere and directional light, the starting pose). `App.tsx` now shows the scene once a graveyard is ready. Nothing in the scene is raycast by three.js.
  - **Run:** `cd frontend && npm run typecheck && npm test`, then `npm run dev` and look at the page (the camera does not move yet; the mouse and keys come in task 16).
  - _Requirements: 2, 3, 4, 5.9, 11.1_

- [x] 16. Camera
  - [x] 16.1 `model/fly-controls.ts` (pure: which keys mean which way, the speed, one step of movement) with `fly-controls.test.ts`; `scene/useFlyKeys.ts` (keys by code, ignored while typing and with Ctrl, Alt or Meta held, everything let go when the window loses focus); `scene/CameraRig.tsx`: drei `OrbitControls` (left drag orbits, right drag pans along the ground, wheel zooms, damping, no going below the level of the look-at point, distance from 3 to three times the graveyard's radius), the starting pose, and keyboard flying (W A S D and the arrows, Q and E, Shift is three times as fast; the look-at point may wander one radius beyond the graveyard's edge). A bug found while writing the tests: a look-at point stopped by the ground must not stop the camera coming down, so only the sideways limits are shared between the two.
  - [x] 16.2 `scene/flight.ts` (the state machine: start, step, cancel; no clock of its own) and `scene/api.ts` (`registerScene`, `flyTo(path)`): a flight takes 1,000 ms, eased; `flyTo` returns `true` when it starts one, `false` for a path that is not a file or ghost, a folder, and before a scene is on the screen or after it has gone. The rig registers its fly targets and ends a flight on any mouse, wheel or flying-key input. `SceneCanvas` now uses the rig.
  - [x] 16.3 `flight.test.ts` (at the start, partway, exactly at the end, however late the next frame, idle, cancelled, replaced, a clock going backwards; for any time the pose is the interpolated one) and `api.test.ts` (every file and ghost can be flown to; nothing for unknown paths, folders, before and after the scene; a newer scene is not removed by an older one going away late).
  - **Run:** `cd frontend && npm run typecheck && npm test`, then `npm run dev` and try the mouse (drag, right-drag, wheel) and the keys (W A S D, arrows, Q, E, Shift) on `http://localhost:5173/`.
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
