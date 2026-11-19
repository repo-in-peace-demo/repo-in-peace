# Requirements: Graveyard scene

## Introduction

The graveyard scene is the 3D view in `frontend/`. It loads one graveyard data file (schema version 2, produced by the analyser) and draws it as a night-time cemetery in the spirit of SGI's FSN flyover: folders are fenced plots with nested folders inside, files are tombstones whose height is their size, and every visual effect means one fact from the data (see `product.md`).

The scene only reads a static file. It never calls the GitHub API. Layout and visual parameters are pure, deterministic functions kept apart from rendering so they can be property-tested.

## Glossary

- **Data file**: a graveyard data file; types come from `shared/graveyard-schema.ts` and are never redefined.
- **Plot**: the fenced rectangle on the ground that stands for one folder. The root folder `""` has the outermost plot.
- **Stone**: a tombstone, one per current file.
- **Ghost**: one per entry in `ghosts`, drawn as a translucent figure or stone.
- **Footprint**: the ground rectangle a stone or ghost occupies. For a leaning stone it includes the ground its top can reach.
- **Age**: whole days from a file's `lastCommitDate` to `meta.snapshotDate`, never negative. This is the analyser's age; it is never measured from today.
- **Moss amount**: a number from 0 (clean) to 1 (fully overgrown) that drives how much moss a stone shows.
- **Lean**: the angle, in degrees, a stone tilts from upright.
- **Thresholds**: `meta.thresholds` from the data file (`staleAfterDays`, `ancientAfterDays`, `decayCapDays`, `hotCommits`, `hotWindowDays`). The scene reads them and never assumes defaults: the test files use 21/45 and 14/30.
- **Selection**: the one stone or ghost the user last clicked.

## Test data

Two files are in `frontend/public/graveyards/` (the plain `demo.graveyard.json`, spatialql with the default thresholds, is being deleted and is not used):

| File | Content |
| --- | --- |
| `demo.oikosledger.graveyard.json` | oikos_ledger: 129 files, 0 ghosts, 68 folders (a deep tree with few files each), thresholds 21/45, decay cap 90, 12 unused files |
| `demo.spatialql.graveyard.json` | spatialql: 120 files, 2 ghosts, 3 folders (the root, `src`, `src/data`), thresholds 14/30, decay cap 60. 68 of its files sit directly in `src/`: the crowded flat folder. It is the default file because it has ghosts |

## Requirements

### 1. Loading

**User story:** As a viewer, I open the page and see a graveyard, or a clear reason why not.

1. THE scene SHALL read the graveyard name from the URL parameter `graveyard` (for example `?graveyard=demo.spatialql`) and load `graveyards/<name>.graveyard.json` from the site's own static files. WHEN the parameter is absent THE scene SHALL load `demo.spatialql`.
2. THE scene SHALL accept only names of 1 to 100 characters from `A-Z a-z 0-9 . _ -`. IF the name is anything else THEN THE scene SHALL show a message and SHALL NOT request a file. (The name comes from the URL, so it is untrusted input.)
3. THE scene SHALL make no network request other than that one file and its own application files. It SHALL NOT call the GitHub API or any third-party host, and SHALL NOT load fonts, textures or models from one.
4. THE scene SHALL check `meta.schemaVersion` before anything else. IF it is missing or is not 2 THEN THE scene SHALL show, on screen, which version the file has, which version the viewer reads, and that the file should be made again with the current analyser.
5. THE scene SHALL check the whole file with `validateGraveyard` from `shared/`. IF the file is not found, is not JSON, or fails validation THEN THE scene SHALL show a message saying which, with the first few validation errors, and SHALL NOT draw a partial graveyard.
6. WHILE the file loads THE scene SHALL show a plain "Loading" message. (The styled digging screen belongs to the next spec.)
7. A data file with no source files and no ghosts SHALL load and show the empty ground with the root plot and statistics of zero.
8. IF the browser cannot create a WebGL context THEN THE scene SHALL show a message saying so, instead of a blank page.

### 2. Layout: plots

**User story:** As a viewer, I see the folder structure as nested fenced plots, as in FSN.

1. THE layout SHALL be a pure function of the data file: `layout(graveyard)` returns the plots, the stone positions and the ghost positions, and reads no clock, random source or renderer.
2. Every folder in `folders` SHALL be shown by exactly one plot (its own, or a merged one, see 2.9). Plots SHALL be axis-aligned rectangles on the ground, in world units, with the root plot as the outermost one.
3. A folder's plot SHALL contain the plots of its child folders, so nested folders sit inside their parent's plot.
4. Sibling plots SHALL NOT overlap, and a plot SHALL leave room for its fence between it and its siblings.
5. A folder's plot SHALL be sized from what it holds: its own stones and ghosts, and its child plots. It SHALL be computed from the leaves up, so a folder with nothing inside it other than its fence is the smallest plot.
6. THE layout SHALL NOT depend on the order of the arrays in the data file. Folders, files and ghosts SHALL be placed in order of path (code-point order), so the same data always gives the same layout.
7. THE layout SHALL work for a chain of folders at least 300 levels deep without a stack overflow, and for a folder with 500 or more files.
8. A plot SHALL be packed tightly. A folder's items (its own block of stones and ghosts, counted as one item, and its child plots) SHALL be placed largest first, ties by path, with a skyline packing that keeps the plot close to square. Each plot's area SHALL be at most a documented fixed multiple (`AREA_BOUND`, 2) of the area of what it contains, counting a gap around every item.
9. A folder that is not the root, holds no files and no ghosts, and has exactly one child folder SHALL be merged with that child into one plot. The sign SHALL show the folders' names joined by a slash (for example `accounts/compare`), and hover labels SHALL keep the full real folder path. The root and any folder that holds a ghost SHALL NOT be merged.

### 3. Layout: stones

1. A folder's stones SHALL stand in rows inside its plot, in order of path, in a roughly square block: for a folder with no child folders and 500 or more files the plot SHALL be no more than 3 times longer than it is wide. (The crowded flat folder in `spatialql` is one such case.)
2. A folder's own stones SHALL NOT overlap its child plots. Stones and child plots SHALL both lie inside the parent plot, with the child plots set beside the block of stones.
3. A stone's height SHALL come from the file's `linesOfCode` on a logarithmic scale, clamped between a minimum and a maximum height. The height SHALL never decrease as `linesOfCode` increases, SHALL be the minimum for 0 or 1 lines, and SHALL be the maximum from a stated number of lines upward. The real range in the test data is 1 to 6,451 lines.
4. A stone's width and depth SHALL NOT depend on the file, so the rows stay regular.
5. No two footprints (stones and ghosts together) SHALL overlap.
6. A stone's footprint SHALL include the ground its top reaches when it leans at the largest lean allowed for its height, so a leaning stone never reaches into a neighbour.
7. Every number that sets the layout (sizes, spacing, fence width, height range) SHALL be a named constant in one module.

### 4. Layout: ghosts

1. A ghost SHALL be placed in the plot of its old folder (the directory part of its path) when that folder is in `folders`.
2. WHEN its old folder is not in `folders` (it no longer has current files) THE ghost SHALL be placed in the plot of its nearest ancestor that is, up to the root plot.
3. Ghosts SHALL take their own cells in their plot's block, after the stones, so a ghost never overlaps a stone, another ghost, or a child plot.
4. A ghost's drawn position SHALL differ from its cell only by a small height offset for floating. The ground position never moves out of its cell.

### 5. Visual mapping

**User story:** As a viewer, each effect tells me one fact, and effects can combine.

Each effect has exactly one source. The sources are listed, and no effect reads any other fact.

1. **Moss and state.** The state comes from the file's `decayState`.
   1. A `fresh` stone is clean: moss amount 0.
   2. A `stale` stone has moss amount above 0 and below the heavy level, rising as its age rises from `staleAfterDays` toward `ancientAfterDays`.
   3. An `ancient` stone is heavily overgrown: moss amount at or above the heavy level, rising to 1 at `decayCapDays` and staying there.
   4. Moss amount SHALL be a function of the file's age and the thresholds only. It SHALL NOT depend on `unused`, `hot`, size or position. (The analyser's decay score adds a bonus for unused files; reading moss from the score would show "unused" as extra moss, so moss reads the age instead. See Open question 1.)
   5. Moss amount SHALL be clamped into the range of its state, so a file whose state and age disagree still shows the moss of its state.
2. **Lean.**
   1. A stone leans only when it is `ancient`. `fresh` and `stale` stones are exactly upright.
   2. An ancient stone's lean SHALL be above 0, SHALL NOT decrease as its age rises, and SHALL NOT exceed a stated maximum.
   3. The direction of the lean SHALL come from a hash of the path, so it is varied but always the same.
3. **Unused.** A stone with `unused: true` SHALL show cracks and a faint red glow. A stone with `unused: false` SHALL show neither. This is independent of state: a fresh unused stone is clean and upright and also cracked.
4. **Hot.** A stone with `hot: true` SHALL show a lit candle at its base. A stone with `hot: false` SHALL show none.
5. **Ghost.** A ghost SHALL be translucent and SHALL float gently. Ghosts have no decay state, no moss, no lean, no cracks and no candle.
6. Changing one fact SHALL change only its own effect: changing `unused` changes only the cracks and glow, changing `hot` changes only the candle, changing the age within a state changes only moss and, for ancient, lean.
7. Small per-stone variety (the lean direction, the float phase, the flicker phase) SHALL come from a hash of the path. THE scene SHALL NOT use a random source for anything that affects what a file looks like.
8. THE visual parameters SHALL be computed by pure functions of one file and the thresholds, returning plain numbers and flags.
9. **Plot ground.** A plot's floor SHALL be tinted by how deeply its folder is nested: the root is the lightest and each level down is slightly darker, down to a limit, so the tint stays subtle. The tint depends only on the nesting depth and is stated in the legend ("darker ground: a deeper folder"). It is a map of the folder structure, not an effect on a file.

### 6. Atmosphere and assets

1. THE scene SHALL show a dark night sky, a moon with moonlight, fog that hides the far distance, and a ground.
2. Everything SHALL be built in code or from original assets. THE scene SHALL NOT use third-party models, textures, fonts or sounds unless they are CC0, and the source SHALL be recorded in `docs/`. THE scene SHALL NOT use SGI, IRIX or FSN names or logos.
3. THE scene SHALL make no sound.
4. Text on the screen SHALL use the browser's own font stacks (no downloaded font file).
5. Atmosphere SHALL NOT carry data: no lighting, colour or fog effect varies with a file's facts, so the scene stays readable.

### 7. Camera

**User story:** As a viewer, I fly over the graveyard like FSN.

1. THE camera SHALL start framing the whole graveyard from above and in front, whatever its size.
2. THE user SHALL be able to orbit, pan and zoom with the mouse, and to fly with the keyboard: W A S D or the arrow keys to move, Q and E for down and up, Shift to go faster. The keys SHALL be listed on screen.
3. THE camera SHALL stay within stated limits whichever input moves it (keys, mouse orbit, pan, zoom, or the end of a flight), all applied by one rule, `clampPose`:
   1. The camera's height SHALL be at least 1 and at most `max(100, 3 × radius)`, the same value as the furthest zoom. (`radius` is half the diagonal of the root plot.)
   2. The look-at point's height SHALL be between 0 and the tallest stone height. Going up further SHALL raise only the camera, so the view tilts down onto the graveyard.
   3. The look-at point SHALL stay within the root plot plus one radius on every side, for keys and for panning. When it is stopped, the camera SHALL move by the same amount, so the view slides to a stop and does not jump.
   4. Tilt is limited only near the horizon (0.02 radians short of it); looking straight down is allowed. Zoom is between 3 and `max(100, 3 × radius)` from the look-at point.
4. THE scene SHALL expose `flyTo(path)`, which smoothly moves the camera to a pose that frames the stone or ghost with that path, looking at it from a distance that depends on its height.
   1. `flyTo` SHALL take about one second and ease in and out.
   2. `flyTo` for a path that is neither a file nor a ghost SHALL do nothing and report that.
   3. Any mouse or keyboard camera input during the flight SHALL end the flight and give control back.
   4. The target pose SHALL be a pure function of the layout and the path, so it can be tested without rendering.
5. `flyTo` SHALL be importable from one module that later specs (list view, search) call, and SHALL work for every file and ghost of any data file.

### 8. Hover and selection

1. WHEN the pointer is over a stone or ghost THE scene SHALL highlight it and show a label with its file name and its folder path, in a text box that follows the pointer.
2. THE highlight SHALL be feedback only (a pale outline), so it SHALL NOT use the colours of the data effects (moss green, crack red, candle yellow).
3. WHEN the user clicks a stone or ghost, without dragging, THE scene SHALL mark it as selected with a distinct outline and SHALL publish `{ kind: 'file' | 'ghost', path }` to a small shared store.
4. A drag to orbit or pan SHALL NOT change the selection.
5. WHEN the user clicks empty ground or presses Escape THE selection SHALL clear and the store SHALL publish `null`.
6. THE store SHALL be readable and subscribable from React components and from code outside React, and SHALL hold only the selection. A later spec builds the detail panel from it.
7. Hovering and selecting SHALL NOT cost anything while the pointer is idle.

### 9. Overlays

1. THE legend SHALL list every effect with what it means, using the real values from `meta.thresholds`. With thresholds 21/45/cap 90/5 commits in 30 days it SHALL say, in plain words:
   - a clean upright stone: last commit under 21 days before the snapshot;
   - moss: untouched 21 or more days, with more moss the longer it has been;
   - a leaning, heavily overgrown stone: untouched more than 45 days;
   - cracks with a red glow: Knip reports the file unused (this combines with the others);
   - a lit candle: 5 or more commits in the 30 days before the snapshot;
   - a translucent floating figure: a file that was deleted;
   - darker ground: a folder nested deeper.
2. THE legend text SHALL be built by a pure function of the thresholds, so a change of thresholds changes the words and nothing else.
3. THE legend SHALL show the snapshot date it measures from, and SHALL be collapsible.
4. THE statistics overlay SHALL show the counts of fresh, stale, ancient, unused, hot and ghost, plus the total files and folders. The counts of fresh, stale and ancient SHALL add up to the number of files, and unused and hot SHALL be counted among all files, whatever their state.
5. THE overlays (legend, statistics, hover label, signs' text) SHALL be drawn as page elements over the canvas, not inside the 3D scene.

### 10. Folder signs

**User story:** As a viewer, I can tell which folder I am looking at, as in FSN, without the scene filling with text.

1. EVERY plot SHALL have a sign: a small plaque on a post at the middle of its front fence (the gate side). The root plot's sign SHALL show the repository name (`meta.name`); every other plot's sign SHALL show its folder name (the last segment of its path).
2. THE plaques (the boards and posts) SHALL be drawn with instanced meshes. The text on them SHALL be drawn as page elements over the canvas, using the browser's own font stacks, positioned from the plaque's place in the scene.
3. A sign's text SHALL be shown only when the camera is near enough to read it, and SHALL fade out with distance: fully visible within a near distance, invisible beyond a far distance, and in between more transparent the farther the camera is. Both distances SHALL grow with the size of the plot, so the root's name can be read from the starting view and a small folder's name only close up.
4. THE scene SHALL show at most 30 signs at once, the nearest first, and none for a plaque behind the camera or outside the view.
5. THE visible signs and their opacity SHALL be computed by a pure function of the plaque positions, the camera position and the limits, and SHALL be updated only when the camera has moved.
6. Where a plaque stands SHALL be part of the layout: it lies on the front fence line of its plot, centred, and does not overlap any stone, ghost or child plot.
7. A sign SHALL carry no data effect: all signs look alike and have no colour or size that depends on a file's facts. A stone's hover label still shows its full folder path.

### 11. Performance

1. THE scene SHALL draw stones, ghosts, candles and fence parts with instanced meshes, so the number of draw calls does not grow with the number of files. The number of draw calls SHALL stay below 40 for any data file.
2. THE layout, the visual parameters and the statistics SHALL be computed once when a file loads, never per frame.
3. THE scene SHALL keep a frame time of 20 ms or less (50 frames per second) at the 95th percentile on a laptop with integrated graphics, with a graveyard of 2,000 stones, while flying. To check this without a 2,000-file repository, a deterministic synthetic graveyard of any size SHALL be available through the URL parameter `synthetic=<n>`, development builds only.
4. THE scene SHALL limit the pixel ratio to 2 and SHALL NOT use one real light per candle.
5. THE signs' page elements SHALL be a fixed pool of 30, reused, not created or removed per frame.
6. THE layout of a 2,000-file graveyard SHALL take well under a second.

### 12. Structure and testability

1. Pure logic SHALL be in files named for what they compute, with tests beside them: `layout.ts`, `tombstone-height.ts`, `visual-params.ts`, `legend.ts`, `stats.ts`, `signs.ts`, `camera-pose.ts`, `graveyard-load.ts`, `hash.ts`. None of them SHALL import React, three.js or the DOM.
2. Rendering SHALL be under `frontend/src/scene/` and overlays under `frontend/src/ui/`.
3. THE types SHALL be imported from `shared/graveyard-schema.ts`. THE code SHALL be TypeScript in strict mode, and any use of `any` SHALL have a comment saying why.
4. The synthetic graveyard builder and the generators for property tests SHALL be shared, so tests and the performance check describe the same kinds of graveyard.

## Correctness properties

Each property gets a fast-check property test. Generators produce folder trees of every shape (very deep chains, wide trees, 500 or more files in one folder, empty folders in `folders` that hold only child folders), files with any `linesOfCode` and any state, and ghosts whose old folders do and do not exist.

| # | Property | Covers |
| --- | --- | --- |
| P1 | No two stones and ghosts overlap, no two sibling plots overlap, and no stone or ghost overlaps a child plot of its own folder. | Req 2.4, 3.2, 3.5, 3.6, 4.3 |
| P2 | Every stone and ghost footprint lies inside its folder's plot, and every nested plot lies inside its parent's plot. | Req 2.3, 3.2 |
| P3 | The same data file always produces the same layout, also when the arrays in it are shuffled. | Req 2.1, 2.6 |
| P4 | Every file and every ghost gets exactly one position, and every real folder is shown by exactly one plot (its own or a merged one). Merging follows 2.9 exactly, and each plot's area is at most `AREA_BOUND` times the area of what it contains. | Req 2.2, 2.8, 2.9, 3, 4 |
| P5 | Within a state, moss never decreases as the decay score rises (for files with the same `unused` flag); and only ancient stones lean. | Req 5.1, 5.2 |

Supporting properties, added because they follow from the rules:

- **P6** A ghost sits in its old folder's plot when that folder exists, otherwise in its nearest existing ancestor's plot (Req 4.1, 4.2).
- **P7** Stone height never decreases as lines of code increase, and stays within the minimum and maximum (Req 3.3).
- **P8** Each effect depends on its own fact only: flipping `unused`, flipping `hot`, or changing only the age within a state changes only the effects listed in Req 5.6 (Req 5.4, 5.6).
- **P9** Moss amount is 0 for fresh, above 0 for stale and ancient, at or above the heavy level for ancient, within 0 to 1, and non-decreasing in age (Req 5.1).
- **P10** No coordinate in the layout is `NaN` or infinite, and a folder with 500 or more files and no subfolders gives a plot at most 3 times longer than wide (Req 2.7, 3.1).
- **P11** The legend text contains the real threshold numbers and an entry for the ground tint, and the statistics add up (Req 9).
- **P12** `flyTo` gives a finite camera pose for every file and ghost, looking at it from above the ground (Req 7.4).
- **P13** The graveyard name check accepts exactly the allowed names (Req 1.2), and a file with another schema version always gives the version message (Req 1.4).
- **P14** Signs: every plot has a plaque on its front fence that overlaps nothing; at most 30 signs show; each opacity is from 0 to 1 and never rises as the camera moves away; no sign shows beyond its far distance; and the result does not depend on the order of the plots (Req 10).
- **P15** Picking: a ray through the middle of a target's box hits that target or something nearer, a ray that misses every box hits nothing, and the answer does not depend on the order of the targets (Req 8).
- **P16** Camera interpolation reaches both end poses, stays finite, and keeps the camera above the ground between two poses above it (Req 7.4).
- **P17** The floor tint never gets lighter as the nesting depth grows, stays within a stated subtle range, and is the lightest at the root (Req 5.9).
- **P18** `clampPose`: the result is inside every limit; clamping twice equals clamping once; a pose inside the limits comes back unchanged; and when only the look-at point is stopped sideways, the camera moves with it and the view direction does not change (Req 7.3).

Property P5 is worded differently from the original request, as agreed: moss and lean read the file's age and the thresholds, never the `unused` flag (Req 5.1.4), and P8 checks that each effect depends only on its own fact.

## Out of scope

- Detail panel, list view, search, boot and digging screens (the next spec).
- Eulogies, and the bury and resurrect actions.
- Sound.
- Time-lapse, GitHub sign-in, and any call to the GitHub API.

## Decisions

Settled in review:

1. **Moss and lean read the age and the thresholds only**, never `unused`. The decay score is not used for moss. A new property (P8) checks that each effect depends only on its own fact.
2. **File naming:** `<name>.graveyard.json` in `frontend/public/graveyards/`, the URL parameter `graveyard=<name>` with the safe-character check, and the default `demo.spatialql`.
3. **Folder signs** are in scope (Requirement 10): a plaque at each plot, text shown only near the camera and fading with distance, at most 30 at once. The root sign shows the repository name.
4. **Ghosts count as occupants** in the overlap properties, and no stone overlaps a child plot of its own folder.
5. **Leaning stones reserve room** for their largest lean (Req 3.6).
6. **Selection clears** on an empty-ground click or Escape.
7. **Performance:** 50 frames per second at the 95th percentile and under 40 draw calls, checked by hand with the development-only `?synthetic=2000`.
8. **The store** is hand-written, with no new dependency.
9. **Commands:** the `frontend/` package does not exist yet. The tasks create it and list the commands for you to run. I run no commands for this spec.
10. **Plot floors** are tinted by nesting depth, subtly, and the legend says so (Req 5.9).
11. **Dev-only extras** (`window.repoInPeace`, the performance overlay, `?synthetic`) must not ship in production builds, and the tasks check that.

Left to the design: the layout constants, the exact moss and lean curves, the sign distances (near and far), how pointer picking works on instanced meshes, and how the plaque text is projected.
