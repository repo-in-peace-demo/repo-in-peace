# Design: Graveyard scene

Implements `requirements.md` in this folder. Requirement numbers below refer to it.

## Approach in one page

- Everything that decides **where** or **how** something looks is a pure function in `frontend/src/model/`: layout, tombstone height, visual parameters, signs, camera poses, picking, legend text, statistics. None of them imports React, three.js or the DOM, so they are property-tested directly.
- `buildSceneModel(graveyard)` runs them once when a file loads and returns one plain object. Rendering reads that object and never recomputes it per frame.
- Rendering (`frontend/src/scene/`) is react-three-fiber with instanced meshes and small GLSL patches on standard materials. Overlays (`frontend/src/ui/`) are page elements.
- Pointer picking does not use three.js raycasting against geometry. It uses a pure ray-versus-box function over boxes taken from the layout, which is cheap for 2,000 stones and testable.
- Two outputs for later specs: a selection store and `flyTo(path)`.

## Packages and versions

| Package | Why |
| --- | --- |
| `react@19`, `react-dom@19` | R3F 9 pairs with React 19 |
| `three` | rendering |
| `@react-three/fiber@9` | React renderer for three. **Not v10**: v10 defaults to WebGPU, and GLSL (`onBeforeCompile`, `ShaderMaterial`) works there only through its legacy entry. This design uses GLSL on the WebGL renderer |
| `@react-three/drei@10` | `OrbitControls` only |
| `vite`, `@vitejs/plugin-react`, `typescript` | build |
| `vitest`, `fast-check` | tests (pure logic runs in the Node environment) |
| `@types/react`, `@types/react-dom`, `@types/three` | types |

No state library, no font, no texture, no model. The exact versions are taken from npm when you install; if a peer-dependency error names a conflict, send it to me.

## Files

```
frontend/
  package.json  tsconfig.json  vite.config.ts  index.html
  public/graveyards/*.graveyard.json
  src/
    main.tsx  App.tsx
    model/                        PURE. No React, three.js or DOM imports.
      hash.ts          age.ts          sort.ts
      graveyard-load.ts              tombstone-height.ts
      layout-constants.ts            layout.ts
      visual-params.ts               signs.ts
      legend.ts                      stats.ts
      camera-pose.ts                 pick.ts
      scene-model.ts                 synthetic.ts
      (each with <name>.test.ts and, where a property applies, <name>.property.test.ts)
    store/
      selection-store.ts          the shared store
    scene/                        react-three-fiber
      SceneCanvas.tsx   Atmosphere.tsx   Ground.tsx   Fences.tsx
      Stones.tsx        Candles.tsx      Ghosts.tsx   Plaques.tsx
      CameraRig.tsx     flight.ts        Picker.tsx   SelectionRing.tsx
      stone-material.ts ghost-material.ts   (GLSL patches)
      api.ts                      flyTo, for later specs
    ui/
      useGraveyardLoad.ts   StatusMessage.tsx   Legend.tsx   StatsPanel.tsx
      HoverLabel.tsx        SignLayer.tsx       KeysHelp.tsx PerfStats.tsx (dev)
  test/
    arbitraries.ts            generators shared by the property tests
```

`model/` is plain TypeScript so a later worker or test can import it without a browser. Types come from `../../shared/graveyard-schema` through an alias `@shared` (set in `tsconfig.json`, `vite.config.ts` and the Vitest config; the Vite dev server is allowed to read the repository root so it can serve that folder).

## World and units

One unit is about one metre. The ground is the plane `y = 0`, `y` is up, `x` points east and `z` points toward the starting camera, so "front" means larger `z`. A rectangle is `{ x, z, w, d }` with `(x, z)` its minimum corner, so containment and overlap are simple comparisons. Two rectangles overlap only if their interiors intersect; touching edges are allowed, with a tolerance of `1e-9`.

## Pure model

### `hash.ts`, `age.ts`, `sort.ts`

- `fnv1a32(text): number` (32-bit FNV-1a over the UTF-8 bytes, with `Math.imul`), `mix32` (the MurmurHash3 finalizer, which spreads every input bit over the output so similar paths do not get similar values), and `hash01(text, salt?) → [0, 1)`, the mixed hash of the text, a separator and the salt. All per-file variety (lean direction, float phase, flicker phase) comes from `hash01(path + salt)`. There is no random source in `model/` except `synthetic.ts`, which takes an explicit seed.
- `ageDays(lastCommitDate, snapshotDate)` is `max(0, floor((snapshot − last) / 86 400 000))`, the same rule the analyser uses. Tested against that definition.
- `compareCodePoint(a, b)`: the same locale-independent ordering the analyser uses for paths. A small copy, with its own tests, because the frontend does not import analyser code.

### `graveyard-load.ts` (Req 1)

```ts
parseGraveyardName(search: string): { ok: true; name: string } | { ok: false; message: string }
  // reads ?graveyard=, default 'demo.spatialql'; accepts /^[A-Za-z0-9._-]{1,100}$/ only
graveyardUrl(name: string, baseUrl: string): string        // `${baseUrl}graveyards/${name}.graveyard.json`
checkGraveyardData(value: unknown): LoadResult
type LoadResult =
  | { ok: true; graveyard: Graveyard }
  | { ok: false; kind: 'not-a-graveyard' | 'wrong-version' | 'invalid'; message: string; details: string[] }
```

`checkGraveyardData` first checks that `value.meta` is an object (else `not-a-graveyard`), then `meta.schemaVersion === SCHEMA_VERSION` (else `wrong-version`, with the message naming both versions and telling the user to make the file again with the current analyser), and only then calls `validateGraveyard` (else `invalid`, with the first five errors as `details`). A version-1 file therefore gets the version message, not a list of missing fields.

The fetch itself is in `ui/useGraveyardLoad.ts` (the one place with I/O): a `loading`, `error` or `ready` state. A 404 names the file; a JSON parse failure says the file is not JSON. No other request is made (Req 1.3).

### `tombstone-height.ts` (Req 3.3)

```ts
stoneHeight(linesOfCode: number): number
  // t = clamp01( ln(max(loc, 1)) / ln(LOC_AT_MAX_HEIGHT) );  MIN_STONE_H + (MAX_STONE_H - MIN_STONE_H) * t
```

With `LOC_AT_MAX_HEIGHT = 5000`, `MIN_STONE_H = 0.6`, `MAX_STONE_H = 4.0`. One line and zero lines give the minimum; 5,000 lines and more give the maximum (the largest real file, 6,451 lines, is clamped). The function never decreases as lines increase.

### `layout-constants.ts` and `layout.ts` (Req 2, 3, 4, 10.6)

Constants (all in one module, each with a comment):

| Constant | Value | Meaning |
| --- | --- | --- |
| `STONE_W`, `STONE_D` | 1.0, 0.4 | the slab's base |
| `MAX_LEAN_DEG` | 10 | the largest lean any stone can have |
| `LEAN_REACH` | 0.7 | at least `MAX_STONE_H × sin(MAX_LEAN_DEG)` (0.69); a test checks this |
| `CELL_W`, `CELL_D` | `STONE_W + 2·LEAN_REACH` = 2.4, `STONE_D + 2·LEAN_REACH` = 1.8 | a cell: the footprint that includes the lean reach |
| `CELL_GAP` | 0.3 | between cells (pitch 2.7 × 2.1) |
| `FENCE_BAND` | 1.5 | the inset between a plot's outer rectangle and what it holds |
| `ITEM_GAP` | 2.5 | between the stone block and child plots, and between child plots |
| `SIGN_W`, `SIGN_D` | 1.6, 0.5 | a plaque's footprint |

**Output** (all arrays sorted by path in code-point order):

```ts
interface Rect { x: number; z: number; w: number; d: number }
interface PlotLayout   { path: string; folders: string[]; label: string; parent: string | null; depth: number; rect: Rect; sign: SignSpot }
// path = the deepest real folder shown; folders = every real folder shown, outermost first (last = path); label = their last names joined by '/' ('' for the root)
// parent = the real parent of the outermost folder, which is the path of the plot above; depth = the real depth of `path`
interface SignSpot     { x: number; z: number; footprint: Rect }       // centre of the front fence, inside the fence band
interface StoneLayout  { path: string; folder: string; cell: Rect; x: number; z: number; height: number }  // x, z = centre of the base
interface GhostLayout  { path: string; folder: string; cell: Rect; x: number; z: number }               // folder = the plot it sits in
interface Layout       { plots: PlotLayout[]; blocks: BlockLayout[]; stones: StoneLayout[]; ghosts: GhostLayout[]; bounds: Rect }
interface BlockLayout  { folder: string; rect: Rect; columns: number; rows: number; count: number }   // a folder's block of cells
layout(graveyard: Graveyard): Layout
blockShape(count): { columns; rows; w; d }          // exported, for tests
packItems(items): { offsets; w; d }                 // exported, for tests: the skyline packing
nearestExistingFolder(path, folders): string        // exported, for tests: where a ghost sits
```

**Algorithm**, with no recursion, so a chain 300 or more folders deep is safe (Req 2.7):

1. **Group.** Put each file in its folder's list. Resolve each ghost's plot: the directory of its path if it is in `folders`, otherwise the nearest ancestor that is, ending at the root `""` (Req 4.1, 4.2). Sort every list by path with `compareCodePoint`. Because the sort is the only ordering used, the shuffled arrays of a data file give the same result (Req 2.6).
2. **Block of cells.** For a folder with `n` items (its stones first, then its ghosts, Req 4.3), use `c = max(1, ceil(sqrt(n × PZ / PX)))` columns and `r = ceil(n / c)` rows, where `PX`, `PZ` are the pitches. Cell `k` is at column `k mod c`, row `⌊k / c⌋`. The block is `(c−1)·PX + CELL_W` wide and `(r−1)·PZ + CELL_D` deep. This makes the block close to square in world units: for 500 items it is 20 columns by 25 rows, about 54 by 52 units (Req 3.1).
3. **Chains.** A folder that is not the root, has no files, no ghosts and exactly one child folder is merged with that child. Plots exist for the other folders (the tail of each chain); the plot's `folders` lists the chain. Nothing is placed inside a merged folder, so its fence is the fence of the tail.
4. **Plot sizes, leaves up.** Visit plots from the deepest to the root. A plot's content items are its block of cells (if it has any, one item with id `block`) and its child plots (id `child:<path>`). Pack them with `packItems`, a skyline packer: items are sorted by area (largest first), then longer side, then id. For each of `PACK_WIDTH_CANDIDATES` (25) strip widths between the widest item and the widest item plus 2 × sqrt(total area), the items are placed one by one at the lowest, then leftmost, spot where they fit, with `ITEM_GAP` between items. The width giving the smallest longer side wins, then the smaller area, then the narrower strip. The content is the bounding box. A plot's rectangle is the content plus `FENCE_BAND` on every side; an empty folder is `2·FENCE_BAND` square. Because the block is just another item, a folder's own stones sit beside its child plots and not in a separate strip.
5. **Positions, root down.** The root plot's corner is `(0, 0)`. Visit folders from the root down; a child's absolute corner is its parent's corner plus `FENCE_BAND` plus its offset in the parent's packing. Cell and stone positions follow the same way. `bounds` is the root rectangle.
6. **Signs.** A plot's sign is centred on its front edge: `x = rect.x + rect.w / 2`, with a footprint that lies inside the fence band, `SIGN_D` deep, ending at `rect.z + rect.d`. The band is `FENCE_BAND` deep and nothing else lies in it, so a sign overlaps no stone, ghost or child plot (Req 10.6).

Why this satisfies the properties: cells of one folder are on a grid with gaps, so they cannot overlap; the block and the child plots are different items on shelves with gaps; child plots are inside the content, which is inside the parent's rectangle; stones lie inside their block. The packer places each item at a spot where it does not meet an earlier one, so nothing is placed twice.

**Area bound.** The test property: for every plot, (content width + `ITEM_GAP`) × (content depth + `ITEM_GAP`) is at most `AREA_BOUND` (2) × the sum of (item width + `ITEM_GAP`) × (item depth + `ITEM_GAP`). The value 2 is a first estimate to be checked against counterexamples, and it is a fixed number, so a layout that wastes more space fails the test.

`stoneHeight` is applied here so `StoneLayout` carries the height that `flyTo` and picking need.

### `visual-params.ts` (Req 5)

```ts
interface StoneVisual {
  mossAmount: number          // 0..1
  leanDegrees: number         // 0 unless ancient
  leanDirection: number       // radians, from hash(path)
  cracked: boolean            // = unused
  glow: number                // = unused ? GLOW : 0
  candle: boolean             // = hot
  flickerPhase: number        // from hash(path)
}
interface GhostVisual { opacity: number; floatAmplitude: number; floatSpeed: number; phase: number }

mossAmount(age: number, state: DecayState, t: Thresholds): number
leanDegrees(age: number, state: DecayState, t: Thresholds): number
stoneVisual(file: FileEntry, meta: RepoMeta): StoneVisual
ghostVisual(ghost: Ghost): GhostVisual
```

`mossAmount` and `leanDegrees` have no parameter for `unused`, `hot`, size or score, so they cannot read them. Let `S = staleAfterDays`, `A = ancientAfterDays`, `C = decayCapDays`, and `clamp01` clamp to 0..1.

| State | Moss amount | Lean (degrees) |
| --- | --- | --- |
| fresh | 0 | 0 |
| stale | `0.10 + 0.55 × clamp01((age − S) / (A − S + 1))`, so 0.10 up to just under 0.65 | 0 |
| ancient | `0.70 + 0.30 × clamp01((age − A) / (C − A))`, so 0.70 up to 1 at `C` | `2 + 8 × clamp01((age − A) / (C − A))`, so 2 up to 10 |

The state comes from `file.decayState`. Because each state's amount is computed with `clamp01` on its own range, a file whose state and age disagree still shows the moss of its state (Req 5.1.5). The heavy level is 0.70, above everything a stale stone can show (Req 5.1.2, 5.1.3). The largest lean is `MAX_LEAN_DEG`, the number the layout reserved room for (Req 3.6); a test ties the two constants together.

`glow` is the constant `GLOW = 0.35` for an unused stone. It is the same for every unused stone, so the glow carries only "unused" and no second fact. The candle is a flag, and the flicker phase only varies when each candle flickers.

**Plot floor tint** (Req 5.9): `plotFloorShade(depth)` multiplies the floor's base colour by `1 − 0.30 × min(depth, 6) / 6`: 1.0 at the root and 0.70 from depth 6 on, so the tint is subtle and never turns the floor black. It is in `visual-params.ts` so it can be tested.

A ghost has a constant `opacity` (0.45), a float amplitude (0.15) and speed, and a phase from its path. It has no moss, lean, cracks or candle (Req 5.5).

### `signs.ts` (Req 10)

```ts
interface SignSource { path: string; label: string; x: number; y: number; z: number; near: number; far: number }
interface CameraView { position: Vec3; forward: Vec3; fovY: number; aspect: number }
interface VisibleSign { path: string; label: string; opacity: number }

buildSignSources(layout: Layout, repoName: string): SignSource[]
  // label: repo name for the root, else the last path segment. y = SIGN_HEIGHT (1.4).
  // near = 14 + 1.0 × max(w, d) of the plot;  far = 2.2 × near
visibleSigns(sources: SignSource[], view: CameraView, limit = 30): VisibleSign[]
  // opacity = 1 when distance <= near, 0 when >= far, smooth between (smoothstep, so it never rises with distance)
  // dropped: opacity < 0.02, behind the camera, or outside a cone slightly wider than the view
  // nearest first (ties by path), at most `limit`
```

Because `near` and `far` grow with the plot, the root sign (a plot as large as the whole graveyard) is readable from the starting view, and a leaf folder's sign appears only once the camera is within about 40 units of it (Req 10.3). The factor of 1 on the plot's size is what keeps the root's name readable in a large graveyard: the starting camera is about 1.5 times the root's longer side from the root's sign, and the sign has faded out only at 2.2 × (14 + that side); with a factor of 0.6 the sign would already be gone from the starting view of a graveyard more than about 160 units across. A test checks that the root's opacity at the starting pose is above 0, for graveyards of any size.

### `legend.ts`, `stats.ts` (Req 9)

```ts
buildLegend(meta: RepoMeta): Legend              // { snapshotLine, entries: LegendEntry[] }; entry { id, title, text }; ids: fresh, moss, ancient, unused, hot, ghost, floor
computeStats(g: Graveyard): Stats                // files, folders, fresh, stale, ancient, unused, hot, ghosts
```

The legend text is a template filled with the numbers of `meta.thresholds`, singular and plural handled ("1 day", "5 days", "1 commit"). With 21/45/5/30 it reads, for example, "Moss: untouched 21 or more days. More moss the longer it has been untouched." and "Lit candle: 5 or more commits in the 30 days before the snapshot." The last entry reads "Darker ground: a folder nested deeper." It also gives the snapshot date, shortened to `YYYY-MM-DD`. Statistics count `decayState` for the three states and the flags for unused and hot, so `fresh + stale + ancient = files` and unused and hot are counted across all states.

### `camera-pose.ts` (Req 7)

```ts
interface CameraPose { position: Vec3; target: Vec3 }
startPose(bounds: Rect, fovY: number): CameraPose
buildFlyTargets(layout: Layout): Map<string, FlyTarget>                        // every stone and ghost by path: kind, x, z, height
flyToPose(targets: ReadonlyMap<string, FlyTarget>, path: string): CameraPose | undefined   // undefined when path is neither a file nor a ghost
interpolatePose(a: CameraPose, b: CameraPose, t: number): CameraPose // easeInOutCubic; adds a small rise in the middle of long flights
easeInOutCubic(t: number): number
```

- `startPose`: the target is the centre of the bounds at ground level; the camera sits back and above along the direction `(0, 0.6, 1)`, at the distance that fits a sphere of the bounds' radius in the view, times 1.15, never less than 20.
- `flyToPose`: the target is the stone's centre at 55% of its height (a ghost: at its floating height), and the camera sits in front and above it, along `(0, 0.35, 1)`, at `clamp(3.5 × height + 6, 8, 40)`.
- `interpolatePose` lerps both position and target. For long flights it adds `min(0.15 × distance, 30) × sin(π t)` to the camera height, so the flight rises and settles instead of skimming the fences.

The flight lasts 1,000 ms (Req 7.4.1). `scene/flight.ts` holds the little state machine (`idle` or `flying { from, to, startedAt }`) so the timing is the only thing not in `model/`.

### `pick.ts` (Req 8)

```ts
interface PickTarget { kind: 'file' | 'ghost'; path: string; min: Vec3; max: Vec3 }
buildPickTargets(stones: PickStone[], ghosts: PickGhost[]): PickTarget[]   // PickStone: { path, x, z, height, leanDegrees }; the scene model supplies them
rayBoxDistance(target, origin, direction): number | undefined             // exported, for tests
pickNearest(targets: PickTarget[], origin: Vec3, direction: Vec3): PickTarget | undefined
```

A stone's box is its base slab padded by 0.1, from the ground to its height, and, if it is ancient, padded further by `height × sin(lean)` on all sides. A ghost's box is its cell core with its floating range. `pickNearest` is a ray-versus-box test over all targets and returns the nearest hit; equal distances are broken by path. For 2,000 targets this takes well under a millisecond, and it runs only when the pointer moves, so an idle pointer costs nothing (Req 8.7).

### `scene-model.ts`

```ts
interface SceneModel {
  graveyard: Graveyard
  layout: Layout
  stones: Array<{ file: FileEntry; layout: StoneLayout; visual: StoneVisual }>
  ghosts: Array<{ ghost: Ghost; layout: GhostLayout; visual: GhostVisual }>
  floors: Array<{ plot: PlotLayout; shade: number }>   // one per plot, shade = plotFloorShade(depth)
  lookup: Map<string, { kind: 'file' | 'ghost'; index: number }>
  stats: Stats
  legend: Legend
  signSources: SignSource[]
  pickTargets: PickTarget[]
  flyTargets: Map<string, FlyTarget>
  start: CameraPose
}
buildSceneModel(graveyard: Graveyard, fovY = DEFAULT_FOV_Y): SceneModel     // DEFAULT_FOV_Y = 50, in camera-pose.ts
```

It is built once per loaded file inside `useMemo`. It is the only thing the scene components receive.

### `synthetic.ts` (Req 11.3)

`makeSyntheticGraveyard({ files, seed, shape })` returns a valid `Graveyard` (it passes `validateGraveyard`). It uses a seeded generator (mulberry32), so the same arguments always give the same file. Shapes: `tree` (branching folders), `flat` (one crowded folder), `deep` (a long chain). States, sizes, unused and hot flags and a few ghosts are drawn to look like a real repository, with thresholds 21/45/5/30. It is used by the property tests, by the layout speed test, and, in development builds only, by `?synthetic=<n>` (the import is behind `import.meta.env.DEV`, so production builds do not contain it).

## State outside the model

### Selection store (`store/selection-store.ts`, Req 8.3 to 8.6)

```ts
type Selection = { kind: 'file' | 'ghost'; path: string } | null
getSelection(): Selection
select(selection: Selection): void          // does nothing and does not notify when equal to the current one
clearSelection(): void
subscribeSelection(listener: () => void): () => void
useSelection(): Selection                   // React hook over useSyncExternalStore
```

About 30 lines, no dependency, usable outside React. It holds only the selection. Hover state is private to the scene.

### `scene/api.ts` (Req 7.4, 7.5)

```ts
flyTo(path: string): boolean       // true when the path is a file or ghost and a flight started
```

The scene registers itself with this module when it has a model and a camera; before that, and for an unknown path, `flyTo` returns `false` and does nothing. It starts the flight by writing the target pose into `flight.ts`; `CameraRig` runs it. In development builds `window.repoInPeace = { flyTo, resetView, getSelection, select, clearSelection, getPose }` (from `scene/dev-api.ts`, imported dynamically behind `import.meta.env.DEV`) is available to try it from the browser console.

## Rendering (`scene/`)

### Draw calls

| Draw call | What |
| --- | --- |
| 1 | `Stones`: one instanced mesh for every tombstone |
| 2, 3 | `Candles`: wax, and flame with a small glow quad |
| 4 | `Ghosts`: one instanced mesh, transparent |
| 5, 6 | `Fences`: posts, and rails |
| 7 | `Plaques`: board and post, one geometry |
| 8 | `PlotFloors`: one quad per plot, tinted by nesting depth |
| 9 | `Ground` |
| 10, 11, 12 | sky dome, stars, moon |
| 13 | `SelectionRing`, only when something is selected |

Thirteen draw calls, whatever the number of files (Req 11.1, below 40). Nothing is created per frame.

### Stones

One geometry shared by all stones: a slab with a rounded top, built once from a `Shape` (a rectangle with an arch, radius 0.5) and extruded to the stone's depth with a small bevel. Its vertices carry an attribute `aTop` that is 1 for the arch and 0 for the body. The instance matrix holds the stone's position and its lean (a rotation about the base, around the axis at right angles to the lean direction), with no scaling in `y`. Per-instance attributes (`InstancedBufferAttribute`) hold the rest:

| Attribute | Content |
| --- | --- |
| `aHeight` | the stone's height |
| `aMoss` | moss amount |
| `aCrack` | 1 if cracked, else 0 |
| `aHighlight` | 0 none, 0.5 hover, 1 selected |
| `aSeed` | `hash01(path)`, to vary noise per stone |

A `MeshStandardMaterial` is patched with `onBeforeCompile`, so lighting and fog stay three.js's own. In the vertex shader the height is applied without distorting the arch: body vertices are scaled by `bodyHeight = aHeight − 0.5` and arch vertices (`aTop = 1`) are shifted up by `bodyHeight`. In the fragment shader:

- **Stone**: a grey base colour with value noise for a weathered surface (procedural, no texture).
- **Moss**: green, rising from the base. A pixel is mossy when its height up the stone, plus noise, is below `aMoss`, so low values creep up the foot and the sides and high values cover the stone.
- **Cracks**: dark thin lines from a noise function, only where `aCrack = 1`; inside the cracks a faint red emissive term of strength `GLOW`.
- **Highlight**: a pale blue-white rim (fresnel), 50% for hover and 100% with a slow pulse for selected. It is not green, red or yellow, so it cannot be mistaken for a data effect (Req 8.2).

The attribute values are written once when the model loads, and a single element is written when hover or selection changes.

### Candles, ghosts, fences, plaques

- **Candles**: one instance for each stone with `candle = true`, placed in front of the stone's base inside its cell. The flame is an emissive teardrop that flickers by scaling with time and the stone's flicker phase, plus an additive glow quad. There are no real point lights (Req 11.4); the glow is part of the flame's shader.
- **Ghosts**: a pale blue translucent sheet shape (a rounded top and a wavy lower edge). It is transparent with `depthWrite` off, bobs by `floatAmplitude × sin(time × speed + phase)` in the vertex shader, and has no highlight other than the rim.
- **Fences**: `fenceInstances(layout)` (a small pure function) lists posts every 1.5 units along each plot's four sides and one rail per side, split in two on the front side to leave a gate gap where the plaque stands. Posts and rails are instanced boxes.
- **Plaques**: an instanced board on a post at each plot's sign spot.
- **Plot floors**: slightly raised (0.01) quads, each tinted with `plotFloorShade(depth)`, so nested plots read as nested and deeper folders are a little darker. The legend says so (Req 5.9).

### Atmosphere

A dark blue-black sky dome with a vertical gradient that follows the camera position, about 900 stars at positions taken from `hash01`, a moon disc with a soft glow at a fixed direction, a directional light (cool white, intensity about 1.1) from the moon's direction, and a dim hemisphere light. `FogExp2` with `density = 0.35 / max(boundsRadius, 40)` fades the far edge of the graveyard. There are no shadow maps. The ground is a very dark plane with faint noise in its shader, large enough to reach the fog. Colours and intensities are constants in one file. None of them depends on any file's data (Req 6.5).

### Camera

`clampPose(pose, limits)` in `model/fly-controls.ts` is the one rule for where the camera may be. `cameraLimits(bounds)` gives `{ area, minCameraHeight: 1, maxCameraHeight: max(100, 3 r), maxTargetHeight: MAX_STONE_H }`, where `r` is half the diagonal of the root plot and `area` is the root plot plus `0.25 r` (`WANDER_MARGIN_SHARE`) on every side. `clampPose` brings the look-at point into `area` and moves the camera by the same sideways amount (so the view direction is unchanged), holds the look-at point's height between 0 and `maxTargetHeight` without moving the camera, and holds the camera's height between the floor and the ceiling. It returns the same object when nothing needs to change. `moveCamera` applies no limit. `CameraRig` runs `clampPose` at the end of every frame, after drei's `OrbitControls` has applied the mouse and the keys and flights have run, and clamps a flight's end pose before the flight starts. The starting pose and every `flyTo` pose are inside the limits, which a test checks.

`CameraRig` uses drei's `OrbitControls`: left drag orbits, right drag pans, wheel zooms, with damping, `maxPolarAngle` just under 90° (the camera cannot go below the ground), `minDistance` 3 and `maxDistance` 3 × the bounds radius. Keyboard flying runs in `useFrame`: W, A, S, D and the arrows move the camera and the orbit target together along the ground in the camera's heading, Q and E move down and up (never below 1), and Shift triples the speed; the base speed is `clamp(0.15 × boundsRadius, 5, 80)` units a second. Keys are ignored when the event target is an input, a textarea or an editable element, and when Ctrl, Alt or Meta is held (the later search box will need this).

A flight is started by `flyTo`. In `useFrame` the rig samples `interpolatePose(from, to, t)` and writes the camera position and the control target. A flight ends at `t = 1` or at the first mouse or keyboard camera input (the controls' `start` event, a key press, or the wheel).

### Picking, hover and selection

`Picker` listens on the canvas element, not on the meshes, and the meshes are marked so three.js does not raycast them. On `pointermove` (at most once per animation frame) it builds a ray from the camera and the pointer, calls `pickNearest`, and if the hit changed updates the hover highlight and the label. A click is a `pointerdown` and `pointerup` less than 5 px and less than 500 ms apart. On a click, a hit calls `select({ kind, path })` and a miss calls `clearSelection()`; Escape also clears. A selection ring (a thin ring on the ground) and the `aHighlight` value mark the selected stone. When the store changes from elsewhere (a later spec calling `select`), the scene reads the new selection and updates the same way.

## Overlays (`ui/`)

All overlays are page elements over the canvas, with `pointer-events: none` except the collapse button (Req 9.5).

- **Legend**: top right. One row per `buildLegend` entry with a small CSS swatch (green, red, yellow and so on, as stand-ins for the effect), the snapshot date, and a collapse button.
- **Stats**: top left. Repository name, snapshot date and short SHA, then the counts.
- **Hover label**: follows the pointer. The file name in full contrast and its folder path dimmed; a ghost is prefixed "ghost". It is a text node, never HTML from the data, so a file named `<script>` is shown as text.
- **Signs** (`SignLayer`): a fixed pool of 30 `div`s. When the camera has moved, the layer calls `visibleSigns`, projects each chosen sign's 3D point to screen with the camera, and sets each pooled element's text, position and opacity. Elements not needed are hidden, none are created or removed (Req 11.5). Text uses the browser's monospace stack.
- **Controls**: bottom left. A "Reset view" button, a "?" button and the controls help it opens (`ui/ControlsPanel.tsx`, from `model/controls-help.ts`). Home and R reset the view; ? toggles the help.
- **Status**: centred. "Loading", the schema-version message, the validation message, the bad-name message, or the no-WebGL message. All text only.
- **Perf stats** (development, `?stats` or any `?synthetic`): frames per second, the 95th-percentile frame time over the last 300 frames, and `renderer.info` draw calls and triangles. This is how Req 11.3 is checked by hand.

## Errors and edge cases

| Situation | Behaviour |
| --- | --- |
| Name not matching the character rule | Message; no request |
| File not found, not JSON, wrong version, invalid | Message with the reason; nothing drawn |
| Zero files and zero ghosts | Empty ground, root plot, sign with the repo name, statistics of zero |
| A folder with no files and no children | Smallest plot, with its sign |
| Folder chain 300+ deep, 500+ files in one folder | Works (no recursion; near-square block) |
| File whose state and age disagree | Moss and lean follow its state, clamped into the state's range |
| `lastCommitDate` after the snapshot | Age 0 |
| Ghost whose folder and parents are gone | Placed in the root plot |
| `flyTo` for an unknown path, or before the scene is ready | Returns `false`, nothing happens |
| WebGL missing | Message |
| Pointer drag during a click | Not a click; selection unchanged |

## Performance

- The layout, visuals, signs list and picking boxes are built once in `buildSceneModel`. The per-frame work is the camera, the flight or keyboard step, the time uniform, and the signs update when the camera moved.
- 2,000 stones is about 2,000 instances of a geometry of a few hundred vertices: well within a laptop GPU. Thirteen draw calls. No shadows, no real lights per candle, pixel ratio capped at 2.
- Picking is a linear scan of 2,000 boxes only on pointer movement.
- A layout speed test builds a 2,000-file synthetic graveyard and requires the layout to finish in under 1 second. The bound is generous because it is a guard against a quadratic mistake, not a benchmark.
- The frame-rate target is checked by hand: run `?synthetic=2000`, fly around, read the p95 frame time in the perf overlay.

## Tests

Pure logic is tested in Node with Vitest and fast-check. Rendering code is not unit-tested (a canvas is not worth faking); instead the logic it consumes is, and a manual checklist covers the rest.

### Generators (`test/arbitraries.ts`)

- `graveyardArb`: a valid `Graveyard` of a random **shape**: random tree; deep chain (up to 300 levels); one crowded folder (up to 600 files, nothing else); wide (many sibling folders); and mixtures. Files get `linesOfCode` from a log-uniform range including 0, 1, 6,451 and larger; any state, `unused` and `hot` flags; consistent dates and thresholds drawn from valid random thresholds. Some folders hold only child folders or nothing (allowed by the schema). Ghosts are placed in existing folders, in missing folders under existing ones, and in missing folders under missing ones. A test checks that every generated graveyard passes `validateGraveyard`.
- `fileArb`: `(age, state, unused, hot, thresholds)` made consistent, with the decay score from a copy of the analyser's formula, for the visual properties.
- A seeded `shuffle` helper so a failing order can be replayed.

### Properties

| # | Property | Test design |
| --- | --- | --- |
| P1 | No overlap among stones and ghosts, among sibling plots, or between a folder's cells and its child plots | Lay out `graveyardArb`; check all cells of one folder pairwise with a sort-and-sweep (fast enough for 600+), sibling plots pairwise per parent, and each plot's cells against its children. Touching is allowed. |
| P2 | Cells inside their plot's content area; child plots inside the parent plot | Containment checks; also that a plot's content area is inside the fence band inset |
| P3 | Same data, same layout | Lay out twice and compare as JSON; lay out with the `folders`, `files` and `ghosts` arrays shuffled (seeded) and compare again |
| P4 | One position per file and ghost, one plot per folder | Path sets equal the data's, with no duplicates |
| P5 | Moss never decreases as the decay score rises within a state and `unused` flag; only ancient stones lean | Pairs from `fileArb`: same state, same `unused`: `score₁ ≤ score₂ ⇒ moss₁ ≤ moss₂`. Lean is 0 for fresh and stale and in `(0, MAX_LEAN_DEG]` for ancient |
| P6 | Ghost placement | The oracle walks the ghost's path upward through a set of the folders; `layout` must agree |
| P7 | Height | Non-decreasing in lines, within `[MIN, MAX]`, `MIN` for 0 and 1, `MAX` from 5,000 up |
| P8 | Each effect has one source | Flip `unused`: only `cracked` and `glow` change. Flip `hot`: only `candle`. Change `decayScore` to anything: nothing changes. Change the age inside a state: only moss (and lean when ancient). Change `linesOfCode` or `path`: no data effect changes (only hash-derived variety for `path`) |
| P9 | Moss ranges | 0 for fresh; in `(0, 0.65)` for stale; in `[0.7, 1]` for ancient; non-decreasing in age; 1 from the decay cap on |
| P10 | Finite coordinates; crowded folder aspect | No `NaN` or infinite value anywhere in the layout; for 500 to 800 files in one folder and no subfolders, `max(w, d) / min(w, d) ≤ 3` |
| P11 | Legend and statistics | The legend text contains each of the five threshold numbers it should (and the snapshot date), and has a ground-tint entry; `fresh + stale + ancient = files`; `unused` and `hot` match a direct count |
| P12 | `flyTo` poses | For every file and ghost of a generated graveyard: finite numbers, camera above the ground, target inside the bounds padded by the stone's height; `undefined` for unknown paths |
| P13 | Name and version | The name check agrees with the regular expression on arbitrary strings (including `..`, slashes, empty, very long); any `meta.schemaVersion` other than 2 gives `wrong-version` naming both versions |
| P14 | Signs | One sign spot per plot, on the front edge, overlapping no cell, ghost or child plot; at most 30 shown; opacity in `[0, 1]` and never rising as the camera moves away; none beyond `far`; the result is the same when the sources are shuffled; at the start pose the root's opacity is above 0 |
| P15 | Picking | For each target, a ray from in front and above through the centre of its box hits it or something nearer; a ray that misses every box returns `undefined`; the result does not depend on the order of the targets |
| P16 | Camera interpolation | `interpolatePose` at 0 and 1 gives the end poses, stays finite, and the camera height stays above the ground between two poses above it |
| P17 | Floor tint | `plotFloorShade` is 1 at depth 0, never increases with depth, stays within `[0.70, 1]`, and is constant from depth 6 on |
| P18 | Camera limits | `clampPose`: the result is inside every limit; clamping twice equals clamping once; a pose inside the limits is returned unchanged; when only the look-at point is stopped sideways, the camera moves with it and the view direction is unchanged |

### Example tests

- **Real data**: `demo.oikosledger` and `demo.spatialql` are read from `public/graveyards/`, checked with `checkGraveyardData`, laid out, and the invariants of P1 to P4 and P10 are asserted. spatialql's 68-file `src` folder gives a near-square block; its two ghosts sit in the plots of their old folders (or the nearest existing ancestor).
- **Loading**: a version-1 file gives the version message; a file with `meta` missing gives `not-a-graveyard`; a file with a broken folder reference gives `invalid` with details.
- **Legend**: with thresholds 21/45/5/30 the text contains "21", "45", "5 or more commits" and "30 days"; with 1/2/1/1 the singular forms read correctly.
- **Height**: 1, 100, 1,000, 5,000 and 6,451 lines give increasing heights up to the maximum.
- **Moss and lean edges**: age `S − 1` (fresh), `S` and `A` (stale; at `A`, still stale), `A + 1` (ancient) and the cap give the amounts in the table above.
- **Hash**: fixed known values, so the variety cannot silently change between releases.
- **Constants**: `LEAN_REACH ≥ MAX_STONE_H × sin(MAX_LEAN_DEG)`; `leanDegrees` never exceeds `MAX_LEAN_DEG`.
- **Store**: `select` notifies once; selecting the same value does not notify; unsubscribe stops notifications.
- **Layout speed**: 2,000 synthetic files in under 1 second; 300-level chain without error.

### Manual checklist (rendering)

Because rendering is not unit-tested, the tasks end with a short checklist for you to run in the browser with both test files and `?synthetic=2000`: a clean fresh stone; moss growing across the stale range, heavy and leaning on ancient; a cracked red-glowing fresh stone; a candle on a hot stone; the two ghosts floating in their old folders; signs fading in as you approach and out as you leave; hover label and outline; click selection and its ring; Escape; `window.repoInPeace.flyTo('<a path>')`; fog and sky; the perf overlay under 40 draw calls and p95 frame time at or below 20 ms.

## Requirement coverage

| Requirement | Where |
| --- | --- |
| 1 Loading | `graveyard-load.ts`, `useGraveyardLoad.ts`, `StatusMessage.tsx` |
| 2 Layout: plots | `layout.ts`, `layout-constants.ts` |
| 3 Layout: stones | `layout.ts`, `tombstone-height.ts` |
| 4 Layout: ghosts | `layout.ts` |
| 5 Visual mapping | `visual-params.ts`, `stone-material.ts`, `Stones.tsx`, `Candles.tsx`, `Ghosts.tsx` |
| 6 Atmosphere and assets | `Atmosphere.tsx`, `Ground.tsx`; no external assets |
| 7 Camera | `camera-pose.ts`, `CameraRig.tsx`, `flight.ts`, `api.ts` |
| 8 Hover and selection | `pick.ts`, `Picker.tsx`, `selection-store.ts`, `HoverLabel.tsx` |
| 9 Overlays | `legend.ts`, `stats.ts`, `Legend.tsx`, `StatsPanel.tsx` |
| 10 Folder signs | `signs.ts`, `layout.ts` (sign spots), `Plaques.tsx`, `SignLayer.tsx` |
| 11 Performance | instancing, `scene-model.ts`, `PerfStats.tsx`, `synthetic.ts` |
| 12 Structure | `model/` is pure; `scene/`, `ui/` as in the steering docs |

## Assumptions to confirm

1. The stone spacing is generous (pitch 2.7 by 2.1) because every cell reserves the largest lean's reach. A graveyard of 2,000 stones in one folder is about 120 by 100 units. A graveyard should feel crowded rather than sparse, so a task near the end of the rendering work reviews the density on both test files and tunes the constants once (`MAX_STONE_H`, `MAX_LEAN_DEG`, the gaps) in `layout-constants.ts`. Any change must keep all properties passing.
2. Plot floors are tinted by nesting depth, subtly, and the legend says so. The tint carries one fact (nesting depth) and nothing else.
3. Dev-only `window.repoInPeace`, the perf overlay and `?synthetic` are additions beyond the requirements, for trying `flyTo` and checking the frame rate. They are behind `import.meta.env.DEV`, so they are not in production builds; a task checks the built files for them.
3a. The README of `frontend/` records why fiber is pinned to 9 (v10 defaults to WebGPU, and the GLSL patches here need WebGL), so nobody upgrades into it by accident.
4. Version pins: React 19 with `@react-three/fiber@9` and `@react-three/drei@10`, as explained above.
