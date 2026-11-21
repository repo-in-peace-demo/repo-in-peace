# How we used Kiro

Notes for the write-up: how the specs, steering and property tests shaped Repo In Peace. Kept short and factual; each spec's own `requirements.md`, `design.md` and `tasks.md` in `.kiro/specs/` holds the detail.

## Steering

Three always-on steering files (`.kiro/steering/`) set the rules every spec followed:

- **product.md**: every effect maps to one fact in the data; the scene must stay readable, not just spooky; eulogies never invent facts; Bury and Resurrect only ever open a pull request.
- **tech.md**: TypeScript strict everywhere; one shared, versioned schema; every time-based score relative to the snapshot commit, never the clock; deterministic layout; pure logic kept apart from rendering so it can be property-tested; and a working agreement that Kiro writes the code and names the commands, and the human runs installs, builds and the full test suites.
- **structure.md**: where pure logic, scene components and panels live, and that `.kiro/` is always committed.

## Specs

| Spec | What it built |
| --- | --- |
| `repo-analyser` | A local git clone in, one graveyard data file out: ages, sizes, decay, Knip's unused files, and ghosts for deleted files |
| `graveyard-scene` | The 3D scene: nested plots, tombstones, moss, cracks, candles and ghosts, signs, the camera and its limits, the atmosphere, the opening move |
| `interface` | Everything around the scene: boot screen → digging → scene, the hover line, the detail panel, the list and search |

## The interface spec, step by step

1. **Requirements, then questions.** Kiro wrote the requirements and a list of open questions instead of guessing. Answering them changed the spec:
   - **Bury only on unused stones**, whatever their age. The first wording ("cracked or ancient") would have offered to delete old code that is still used, which is stable, not dead. The concept doc was corrected to match.
   - **Ghosts after the stones** in the default sort: a clean-up list should not push the unused stones down with files that are already gone.
   - **Filters**: kinds (fresh, stale, ancient, ghosts) combine with OR, flags (unused, hot) with AND, and the two groups with AND. Read literally, "every active filter" would have made fresh + stale match nothing.
   - **The demo list** comes from a Vite plugin reading the folder, so the analyser stays unaware of it.
   - A **richer hover line** was added during review, with calendar dates rather than snapshot-relative ages, which are easy to misread at a glance.
2. **Design**, then **tasks**, reviewed before any code. One task (freeing the GPU resources of a scene when leaving it, with a check that switches demos five times) was added in review.
3. **Pure model first** (routes and app flow, the demo list, the boot text, the shared wording, panel placement, list rows, the virtual window, search ranking), each with property tests, then one section of the interface per task, each with a browser check and a screenshot.

## The flow: boot screen → digging → scene

- A bare address shows the **boot screen**. `?graveyard=<name>` links go straight in, so the address can be shared and Back returns to the boot screen.
- The **digging screen** shows the real counts and never adds more than a second of waiting.
- The **scene** opens with its opening move. Leaving it frees its GPU resources.
- A file can be opened from disk; it is read in the browser and never uploaded (and, by choice, not kept across a reload: `docs/backlog.md`).

## Properties that guard it

Each property is a fast-check test beside its module (`frontend/src/model/*.property.test.ts`):

| | Property |
| --- | --- |
| P1 | Filtering returns exactly the rows of a selected kind (OR) that have every selected flag (AND) |
| P2 | Sorting is deterministic, ties fall back to path, reversing twice is the identity, and stones come before ghosts |
| P3 | Search ranks an exact name above a prefix, above a name match, above a path-only match |
| P4 | Whatever selects a grave (scene, list, search), the store holds it and exactly one list row is highlighted (checked end to end in the browser) |
| P5 | The state sentence names the file's decay state, its age and the data file's threshold |
| P6 to P13 | The demo list, the version check for picked files, the digging screen's timing, the panel's side, path shortening, the hover line, UTC dates (tested in a +14 h time zone), and Bury exactly on unused stones |

## Where specs and steering caught things

- **Snapshot-relative ages** (tech.md) are the reason the hover line shows calendar dates and the detail panel shows both: an age counted from the snapshot reads as "days ago" from today unless the panel says otherwise.
- **No uploads** (the "browser only reads data files" rule) shaped Open a graveyard file: the File API only, with no request carrying the file's content.
- **Pure logic apart from rendering** let a property test find a real layout bug while building the interface: a packing rule added during the scene's density pass could stretch 0.6% of large synthetic graveyards to 2.6 times as long as wide. It is now capped at 2.2, with the reason recorded in the scene's design.
- **The working agreement** (the human runs the long commands) kept each step small: Kiro ran only the typecheck and the test files it touched, and every browser check and screenshot was run by the human and looked at before the next step.
