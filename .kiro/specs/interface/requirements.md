# Requirements: Interface

## Introduction

The interface is everything around the graveyard scene in `frontend/`: a boot screen to choose a graveyard, a digging screen while it loads, a detail panel for the selected stone or ghost, a list of every file and ghost, and a search box. It builds on the graveyard scene spec and reuses what it made: the selection store (`store/selection-store.ts`), `flyTo` and `resetView` (`scene/api.ts`), double-click to fly, the stats panel, the legend, the controls panel, the sign fading and the panel collapse rule (`model/panel-layout.ts`, open from 1600 px), and the opening move.

As before, the browser only reads static graveyard data files, or a file the user picks from their own disk. It never calls the GitHub API and never uploads anything. Pure logic (filtering, sorting, search ranking, wording, panel placement) is kept apart from rendering so it can be property-tested.

## Glossary

- **Data file**, **Stone**, **Ghost**, **Age**, **Thresholds**, **Selection**: as in the graveyard scene spec. Types come from `shared/graveyard-schema.ts` and are never redefined.
- **Demo graveyard**: a data file in `frontend/public/graveyards/`, named `<name>.graveyard.json`.
- **Manifest**: `frontend/public/graveyards/index.json`, the list of demo graveyards with their names and counts (see 1.2). The browser cannot list a folder, so it reads this.
- **Local file**: a `.graveyard.json` the user picks or drops, made with the local analyser command. It is read in the browser only.
- **Row**: one line of the list view, for one file or one ghost.
- **Terminal style**: green text on a near-black background in the browser's own monospace font, with a blinking block cursor. Our own look; no SGI, IRIX or FSN names, logos or screens.

## Test data

The two demo graveyards of the scene spec: `demo.oikosledger` (129 files, 12 unused, 7 hot, 0 ghosts, thresholds 21/45) and `demo.spatialql` (120 files, 2 ghosts, thresholds 14/30). `?synthetic=2000` (development builds) for the 2,000-row list.

## Requirements

### 1. Boot screen

**User story:** As a visitor without a link, I land on a workstation-style screen that lets me pick a graveyard.

1. WHEN the page address has no `graveyard` parameter (and, in development builds, no `synthetic` parameter) THE app SHALL show the boot screen instead of loading a graveyard. (Today it loads `demo.spatialql`; the boot screen replaces that default.)
2. THE boot screen SHALL list the demo graveyards from the manifest, each with its repository name and its file count (and its ghost count when there are any), without loading the data files themselves. THE manifest SHALL be written by a Vite plugin from the files in `public/graveyards/`, by the dev server and in builds, so a data file added there appears without editing any list by hand. THE analyser SHALL know nothing of it.
3. THE boot screen SHALL type a short fake workstation boot, line by line, in the terminal style, then show the choices. THE text SHALL be our own; it SHALL NOT name SGI, IRIX or FSN, or copy their screens.
4. Any key press or click while the boot text types SHALL show all of it at once and the choices. It SHALL NOT also choose a graveyard.
5. WHILE the system asks for reduced motion THE boot text SHALL appear at once, with no typing and no blinking cursor.
6. THE choices SHALL be reachable and usable with the keyboard alone (arrow keys or Tab to move, Enter to choose), with a visible focus. WHEN the choices appear THE first demo graveyard SHALL be highlighted and focused, so Enter opens it at once.
7. THE boot screen SHALL offer **Open a graveyard file**: a file picker and a drop area for a `.graveyard.json`. THE file SHALL be read in the browser with the File API and SHALL NOT be sent anywhere.
8. A local file SHALL go through the same checks as a demo file (the scene spec's Req 1.4 and 1.5): IF its `meta.schemaVersion` is not 2 THEN the boot screen SHALL say which version the file has, which version the viewer reads, and that the file should be made again with the current analyser. IF it is not JSON or fails validation THEN it SHALL say which, with the first few errors. In both cases the user SHALL stay on the boot screen and can choose again.
9. IF the manifest cannot be loaded THEN the boot screen SHALL still offer **Open a graveyard file**, and say that the demo list is missing.
10. Choosing a demo graveyard SHALL set the page address to `?graveyard=<name>` (so the address can be copied and shared), then show the digging screen. Choosing a local file SHALL leave the address without a `graveyard` parameter (a reload returns to the boot screen).

### 2. Direct links

1. WHEN the page address has `?graveyard=<name>` THE app SHALL skip the boot screen and go straight to the digging screen, then the scene. The name check of the scene spec (Req 1.2) SHALL still apply.
2. THE scene SHALL play its opening move after the digging screen, whichever way the graveyard was chosen (subject to reduced motion, as in the scene spec).

### 3. Digging screen

1. WHILE the data file loads and the scene model is built THE app SHALL show the digging screen: a few short terminal-style lines using the real counts of the graveyard being opened, in the one vocabulary: "opening oikos_ledger…", "exhuming 129 graves…", "12 lie Unused…", "summoning 2 ghosts…" (no line for a count of none), "raising the fences…".
2. THE digging screen SHALL be an intentional beat: it SHALL show for at least 1.8 seconds from the choice, long enough for its lines to type out and be read, and longer only while the loading takes longer. Any key or click SHALL skip the rest of it at once.
3. Under reduced motion its lines SHALL appear at once and it SHALL hold for about 0.6 seconds.
4. Load errors (not found, wrong version, invalid) SHALL replace the digging screen with the scene spec's messages, plus a way back to the boot screen.

### 4. Detail panel

**User story:** As a viewer, I select a grave and read what it is and why it looks the way it does.

1. THE detail panel SHALL open when a stone or ghost is selected, by whatever means: a click or double-click in the scene, a list row, or search. It SHALL show the selection held in the shared store, and update when it changes.
2. Escape or the panel's close button SHALL clear the selection, which closes the panel. (Escape already clears the selection; it SHALL keep doing exactly that.)
3. For a **stone** it SHALL show: the file name and full path; the state in words (see 4.4); whether it is unused; whether it is hot, with its number of commits in the hot window (`recentCommits` in the last `hotWindowDays` days); lines of code; the last commit's date and author; and the decay score.
4. THE state wording SHALL use the file's age and the data file's thresholds: "Fresh: last touched N days before the snapshot", "Stale: untouched N days before the snapshot (stale from S days)", "Ancient: untouched N days before the snapshot (ancient after A days)", with N the age in whole days and the singular "1 day". ("Stale from S days" because the analyser counts a file stale from `staleAfterDays` inclusive; "ancient after A days" because it is ancient only above `ancientAfterDays`.) THE wording SHALL agree with the file's `decayState`.
5. For a **ghost** it SHALL show: the file name and path; the date it was deleted and by whom; the commit it was deleted in (short SHA, with the full SHA available to copy); and its file type, from its extension, as on its toe tag.
6. THE panel SHALL show the eulogy from the data file. WHILE it is empty (the analyser leaves it empty until spec 4) it SHALL show a short placeholder line, styled so it cannot be mistaken for a eulogy.
7. THE panel SHALL show a **Bury** button only for a stone that Knip lists as unused (a cracked stone), whatever its age, and a **Resurrect** button for a ghost. A stone that is still used SHALL NOT be offered Bury, however old: old but used code is stable, not dead, and deleting it would break the app. So a fresh unused stone (`app/components/voice/index.ts`) gets Bury, and an ancient used stone does not. Both SHALL be visible but disabled, and look it (dimmed, dashed, a not-allowed cursor), with a note that they arrive with the PR function. (They do nothing in this spec.)
8b. **One panel per side.** WHILE the detail panel is open THE other panels on its side SHALL fold to their header bar (the legend on the right; the stats panel and the list on the left), keeping their own open or closed state, and WHEN it closes they SHALL come back as they were. A folded panel's header brings it back and closes the details. No two panels SHALL ever overlap.
8. THE panel SHALL NOT cover the selected stone or ghost on screen: it SHALL open on the side of the window away from it. IF it would still cover it (a narrow window) THEN the camera SHALL be moved sideways just enough, smoothly, without changing what is selected.
10. WHILE a stone or ghost is in focus (selected, or the last one flown to) THE signs nearer the camera than it whose board or label would cover it on screen SHALL fade out (over a quarter of a second, at once under reduced motion), board and label together, and SHALL fade back in when the focus moves on (another selection, clearing it, or Reset view). The camera's path is not changed for it.
11. AFTER `flyTo` (and so a double-click, a list row or a search result) nothing SHALL block the grave's face: `flyTo` SHALL pick, from a few camera positions inside the camera's limits (higher elevations first for a short stone, then small sideways shifts, then a little nearer), the first from which no stone, fence post or rail, or sign board stands between the camera and the face. IF none is fully clear THEN it SHALL take the one with the fewest in the way, and those SHALL fade (stones and fences by a per-instance dithered fade, signs with their labels) while the grave is in focus, and come back when the focus moves on.
9. Every value SHALL be text (never markup from the data file), and long paths SHALL wrap or shorten in the middle, keeping the file name readable.

### 4b. Richer hover label

**User story:** As a viewer moving the pointer over the graveyard, I see what a grave is before I click it.

1. THE hover label SHALL keep its file name and folder (`model/hover-label.ts`) and add one compact summary line below them.
2. For a **stone** the line SHALL read: the state, the last commit date, the size in lines, then only the flags that apply, joined by " · ". For example "Ancient · last commit Jun 13 · 26 lines · unused · hot (7 commits)", or "Fresh · last commit Aug 2 · 1 line" for a file with no flags. The hot flag SHALL carry the commit count in the hot window ("hot (1 commit)" in the singular).
3. For a **ghost** the line SHALL read "Ghost · deleted Oct 12 · .ts", with its file type as on its toe tag (the same `·` mark when it has no extension).
4. Dates on the hover line SHALL be calendar dates (month and day, and the year as well when it is not the snapshot's year), in UTC, as the data file's dates are, so the line does not depend on the viewer's time zone. THE hover line SHALL NOT show ages relative to the snapshot; the detail panel shows both the date and the age.
5. THE hover line and the detail panel SHALL get their words from the same pure functions (the state name, the date, the lines and the flags), so they never disagree.
6. THE line SHALL be one line: it SHALL NOT wrap, and IF it is wider than the label's maximum width THEN it SHALL be cut with an ellipsis at the end, keeping the state and the date.
7. THE label SHALL still be hidden while a drag (orbit or pan) is going on, as now, and SHALL still be text only.

### 5. List view

**User story:** As a maintainer planning a clean-up, I scan every grave sorted by how dead it is.

1. A collapsible list SHALL be docked on one side of the window, with a row for every file and every ghost.
2. THE default sort SHALL be most dead first: decay score from highest to lowest, ties by path (code-point order). Ghosts SHALL come after every stone (they are already deleted, so they do not push unused stones down a clean-up list), among themselves by deleted date, oldest first, ties by path.
3. THE list SHALL offer sorts by **decay** (as above), **age** (oldest first: a file by its age, a ghost by the days from its deletion to the snapshot), **name** (file name, then path) and **size** (lines of code, largest first; ghosts, which have no size, last). Every sort SHALL fall back to path for ties, and a second click on the same sort SHALL reverse it.
4. THE list SHALL offer filters in two groups: the kinds **fresh**, **stale**, **ancient**, **ghosts** (what a row is), which combine with OR, and the flags **unused**, **hot**, which combine with AND. The two groups combine with AND: a row SHALL be shown when it is one of the selected kinds (any kind when none is selected) and has every selected flag (a ghost has neither flag). THE list SHALL show how many rows match, out of how many.
5. A click on a row, or Enter on a focused row, SHALL select its file or ghost and fly to it with `flyTo`.
6. WHEN the selection changes from anywhere else (the scene, search) THE list SHALL highlight the matching row and scroll it into view. WHEN the selected row is filtered out THE list SHALL highlight nothing and say that the selection is hidden by the filters.
7b. WHENEVER the list becomes visible (opened, or back after the details folded it) its rows SHALL be drawn from its own scroll position, measured again, and the scroll position SHALL stay within the rows. WHEN the user opens it below the open stats panel with room for fewer than 8 rows (a 1280 × 720 window) THE stats panel SHALL fold to its header.
7. THE list SHALL stay smooth with 2,000 rows: it SHALL draw only the rows in view (virtualised), and sorting or filtering 2,000 rows SHALL take under 16 ms.
8. Each row SHALL show the file name, its folder, its state (with the same colour cue as the legend, and a word, not colour alone), and marks for unused, hot and ghost.

### 6. Search

1. A search box SHALL match file names and paths of files and ghosts, case-insensitively. Results SHALL update as the user types.
2. `/` and Cmd+K (Ctrl+K on other systems) SHALL focus the search box, when the user is not already typing in a field.
3. Results SHALL be ranked: an exact file-name match first, then a file-name prefix match, then a match anywhere in the file name, then a match only in the path. Within a rank, by path.
4. Enter SHALL select the top result and fly to it. Arrow keys SHALL move through the results; Enter on one selects and flies to it. Escape in the search box SHALL clear it, then on a second press leave the box. (It SHALL NOT clear the selection while the box has focus.)
5. Typing in the search box or the list SHALL never move the camera: the fly keys, Home, R and ? SHALL be ignored while a field has focus. (The scene already ignores fly keys while the user types; this extends to the new fields.)

### 7. Layout and access

1. At 1280 × 720 the panels SHALL NOT cover the middle of the graveyard in the default view: the list and the detail panel SHALL start collapsed or overlay only the edges, following the existing rule (panels open from 1600 px wide).
2. Every control SHALL be reachable with the keyboard, have a visible focus and an accessible name. Panels SHALL be landmarks or labelled regions.
3. Opening or closing a panel SHALL NOT move the camera, and SHALL NOT end the opening move unless it is a click or a key press (which end it anyway).
4. All new text SHALL use the browser's own fonts. No font, image or sound file is added.

### 8. One vocabulary, grouped by dimension

**User story:** As a viewer, I see the same names for the same facts everywhere, and I can tell that age and usage are separate things.

1. THE names and rules for states, flags and ghosts SHALL come from one module (`model/grave-facts.ts`), used by the stats panel, the legend, the list's tags, the hover line and the detail panel.
2. States SHALL always be named Fresh, Stale and Ancient; flags Unused and Hot; deleted files Ghosts (one is a Ghost). A file's age SHALL always be "last changed", always "before the snapshot" (never "untouched" or "last commit").
3. THE stats panel and the legend SHALL use the same four groups in the same order: **Age** (Fresh "under S days", Stale "S–A days", Ancient "over A days"), **Usage** (Unused "nothing in the project imports it (Knip)"), **Activity** (Hot "H+ commits in the W days before the snapshot") and **History** (Ghosts "deleted files"), with the numbers from the data file. The stats panel keeps Files and Folders at the top and shows each row's rule beside its count; the legend names each fact, how it looks and its rule, with the darker ground in a final **Layout** group.
4. THE legend SHALL say, in its Age group, that a file's age and its usage are independent, so a fresh file can be unused.
5. A list row's tag SHALL keep the dimensions apart: "Stale · Unused".



Each property gets a fast-check property test.

| # | Property | Covers |
| --- | --- | --- |
| P1 | Filtering returns exactly the rows whose kind is one of the selected kinds (OR; any kind when none is selected) and that have every selected flag (AND), the two groups combined with AND; clearing the filters returns every row. | Req 5.4 |
| P2 | Sorting is deterministic: the same rows in any input order give the same order; ties fall back to path; reversing twice gives the original order; under the default sort every stone comes before every ghost. | Req 5.2, 5.3 |
| P3 | Search ranking: an exact file-name match ranks above a prefix match, which ranks above a match elsewhere in the name, which ranks above a path-only match; a non-matching row never appears. | Req 6.3 |
| P4 | Selection sync: whatever selects a file or ghost (the scene, a list row, search), the store holds it, and the list highlights exactly one row, that one (or none when it is filtered out). | Req 4.1, 5.5, 5.6, 6.4 |
| P5 | The detail panel's state wording names the file's `decayState`, its day count is the file's age, and the threshold it quotes is the data file's. | Req 4.4, 4b.5 |

Supporting properties:

- **P6** The manifest lists exactly the `*.graveyard.json` files of the folder, with the counts in each file (Req 1.2).
- **P7** A local file with any `schemaVersion` other than 2 always gives the version message, and a valid version-2 file always loads (Req 1.8).
- **P8** The digging screen is held for the rest of its minimum (1.8 s from the choice; 0.6 s under reduced motion) and for nothing once that has passed, for any loading time (Req 3.2, 3.3).
- **P9** The panel side: the detail panel is always placed on the half of the window away from the selected item's screen position (Req 4.8).
- **P10** Middle shortening of a long path always keeps the whole file name (Req 4.9).
- **P11** The hover line of a stone starts with the state word that matches its `decayState`, carries its last commit date and its lines, and has exactly the flags that apply (unused when `unused`, hot with `recentCommits` when `hot`) and no others; a ghost's line starts with "Ghost" and ends with its toe-tag type. The words are the same as the detail panel's for the same item (Req 4b.2 to 4b.5).
- **P12** Dates on the hover line are the data file's dates in UTC, for any time zone the tests run in, and carry the year exactly when it differs from the snapshot's (Req 4b.4).
- **P14** For any thresholds, the stats panel, the legend and the detail panel give the same name and the same rule wording for every fact, the hover line the same state name, and the stats panel and legend the same groups in the same order (Req 8).
- **P15** After `flyTo` for every stone and ghost of both demo files, no sign left showing is nearer the camera than it with its board or label over it on screen; on oikos_ledger, `app/components/charts/index.ts` fades its own folder's sign (Req 4.10).
- **P16** After `flyTo` for every stone and ghost of both demo files, the camera is inside its limits, near enough to read the name, and every stone, fence or sign box on a line from it to the face is in the fade list (more than 95% of graves need none); `app/lib/db/queries/recommendations.ts` is seen with nothing in the way (Req 4.11).
- **P13** Bury is offered exactly for unused stones, whatever their state, and never for a used stone or a ghost; Resurrect exactly for ghosts (Req 4.7).

## Out of scope

- Writing eulogies (spec 4).
- The PR function, and the bury and resurrect animations (spec 5).
- Sound.

## Decisions

Settled in review:

1. **Demo list:** a Vite plugin writes `public/graveyards/index.json` from the folder, in the dev server and in builds, with each graveyard's name (from its `meta`), file count and ghost count. The analyser knows nothing of it.
2. **A bare address shows the boot screen.** It stays quick: the typing can be skipped, the first demo is highlighted and Enter opens it. `?graveyard=` links still go straight to the scene.
3. **Filters:** kinds (fresh, stale, ancient, ghosts) combine with OR, flags (unused, hot) with AND, and the two groups with AND (Req 5.4, P1).
4. **Ghosts in the sorts:** after every stone under decay; by the days from deletion to the snapshot under age; last under size.
5. **Bury only on unused stones**, whatever their age; never on a used stone, however old (Req 4.7, P13). `docs/concept.md` says the same.
6. **A local file is not kept:** a reload returns to the boot screen.
7. **Sides:** the list on the left, the detail panel on the right, switching sides when the item is on the right half of the screen; the camera nudges only if the panel would still cover it.
8. **Hover dates:** month and day, with the year only when it differs from the snapshot's, in UTC.
9. The digging screen is a beat of at least 1.8 s (0.6 s under reduced motion), skippable with any key or click (changed in review from at least 400 ms and at most 1 s added); a ghost's file type comes from its extension; Escape in the search box clears the text first, then leaves the box, without clearing the selection.
