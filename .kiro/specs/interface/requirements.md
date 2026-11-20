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
2. THE boot screen SHALL list the demo graveyards from the manifest, each with its repository name and its file count (and its ghost count when there are any). THE manifest SHALL be made from the files in `public/graveyards/` at build time and by the dev server, so a data file added there appears without editing any list by hand.
3. THE boot screen SHALL type a short fake workstation boot, line by line, in the terminal style, then show the choices. THE text SHALL be our own; it SHALL NOT name SGI, IRIX or FSN, or copy their screens.
4. Any key press or click while the boot text types SHALL show all of it at once and the choices. It SHALL NOT also choose a graveyard.
5. WHILE the system asks for reduced motion THE boot text SHALL appear at once, with no typing and no blinking cursor.
6. THE choices SHALL be reachable and usable with the keyboard alone (arrow keys or Tab to move, Enter to choose), with a visible focus.
7. THE boot screen SHALL offer **Open a graveyard file**: a file picker and a drop area for a `.graveyard.json`. THE file SHALL be read in the browser with the File API and SHALL NOT be sent anywhere.
8. A local file SHALL go through the same checks as a demo file (the scene spec's Req 1.4 and 1.5): IF its `meta.schemaVersion` is not 2 THEN the boot screen SHALL say which version the file has, which version the viewer reads, and that the file should be made again with the current analyser. IF it is not JSON or fails validation THEN it SHALL say which, with the first few errors. In both cases the user SHALL stay on the boot screen and can choose again.
9. IF the manifest cannot be loaded THEN the boot screen SHALL still offer **Open a graveyard file**, and say that the demo list is missing.
10. Choosing a demo graveyard SHALL set the page address to `?graveyard=<name>` (so the address can be copied and shared), then show the digging screen. Choosing a local file SHALL leave the address without a `graveyard` parameter (a reload returns to the boot screen).

### 2. Direct links

1. WHEN the page address has `?graveyard=<name>` THE app SHALL skip the boot screen and go straight to the digging screen, then the scene. The name check of the scene spec (Req 1.2) SHALL still apply.
2. THE scene SHALL play its opening move after the digging screen, whichever way the graveyard was chosen (subject to reduced motion, as in the scene spec).

### 3. Digging screen

1. WHILE the data file loads and the scene model is built THE app SHALL show the digging screen: a few terminal-style lines using the real counts of the graveyard being opened, such as "exhuming 129 graves…" and "summoning 2 ghosts…" (no ghost line when there are none).
2. THE digging screen SHALL add no artificial delay of more than 1 second beyond the real loading. WHEN loading is instant it SHALL show for a brief beat (at least 400 ms) so it does not flash.
3. Under reduced motion its lines SHALL appear at once.
4. Load errors (not found, wrong version, invalid) SHALL replace the digging screen with the scene spec's messages, plus a way back to the boot screen.

### 4. Detail panel

**User story:** As a viewer, I select a grave and read what it is and why it looks the way it does.

1. THE detail panel SHALL open when a stone or ghost is selected, by whatever means: a click or double-click in the scene, a list row, or search. It SHALL show the selection held in the shared store, and update when it changes.
2. Escape or the panel's close button SHALL clear the selection, which closes the panel. (Escape already clears the selection; it SHALL keep doing exactly that.)
3. For a **stone** it SHALL show: the file name and full path; the state in words (see 4.4); whether it is unused; whether it is hot, with its number of commits in the hot window (`recentCommits` in the last `hotWindowDays` days); lines of code; the last commit's date and author; and the decay score.
4. THE state wording SHALL use the file's age and the data file's thresholds: "Fresh: last touched N days before the snapshot", "Stale: untouched N days before the snapshot (stale after S days)", "Ancient: untouched N days before the snapshot (ancient after A days)", with N the age in whole days and the singular "1 day". THE wording SHALL agree with the file's `decayState`.
5. For a **ghost** it SHALL show: the file name and path; the date it was deleted and by whom; the commit it was deleted in (short SHA, with the full SHA available to copy); and its file type, from its extension, as on its toe tag.
6. THE panel SHALL show the eulogy from the data file. WHILE it is empty (the analyser leaves it empty until spec 4) it SHALL show a short placeholder line, styled so it cannot be mistaken for a eulogy.
7. THE panel SHALL show a **Bury** button for a stone that is unused or ancient, and a **Resurrect** button for a ghost. Both SHALL be visible but disabled, with a note that they arrive with the PR function. (They do nothing in this spec.)
8. THE panel SHALL NOT cover the selected stone or ghost on screen: it SHALL open on the side of the window away from it. IF it would still cover it (a narrow window) THEN the camera SHALL be moved sideways just enough, smoothly, without changing what is selected.
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
2. THE default sort SHALL be most dead first: decay score from highest to lowest, ties by path (code-point order). Ghosts SHALL sort as most dead of all (above every file), by deleted date, oldest first, ties by path.
3. THE list SHALL offer sorts by **decay** (as above), **age** (oldest first: a file by its age, a ghost by the days from its deletion to the snapshot), **name** (file name, then path) and **size** (lines of code, largest first; ghosts, which have no size, last). Every sort SHALL fall back to path for ties, and a second click on the same sort SHALL reverse it.
4. THE list SHALL offer filters: **fresh**, **stale**, **ancient**, **ghosts** (what a row is), and **unused**, **hot** (flags of a file). A row SHALL be shown when it is one of the selected kinds (any kind when none is selected) AND has every selected flag. THE list SHALL show how many rows match, out of how many.
5. A click on a row, or Enter on a focused row, SHALL select its file or ghost and fly to it with `flyTo`.
6. WHEN the selection changes from anywhere else (the scene, search) THE list SHALL highlight the matching row and scroll it into view. WHEN the selected row is filtered out THE list SHALL highlight nothing and say that the selection is hidden by the filters.
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

## Correctness properties

Each property gets a fast-check property test.

| # | Property | Covers |
| --- | --- | --- |
| P1 | Filtering returns exactly the rows that are one of the selected kinds (any when none) and have every selected flag; clearing the filters returns every row. | Req 5.4 |
| P2 | Sorting is deterministic: the same rows in any input order give the same order; ties fall back to path; reversing twice gives the original order. | Req 5.2, 5.3 |
| P3 | Search ranking: an exact file-name match ranks above a prefix match, which ranks above a match elsewhere in the name, which ranks above a path-only match; a non-matching row never appears. | Req 6.3 |
| P4 | Selection sync: whatever selects a file or ghost (the scene, a list row, search), the store holds it, and the list highlights exactly one row, that one (or none when it is filtered out). | Req 4.1, 5.5, 5.6, 6.4 |
| P5 | The detail panel's state wording names the file's `decayState`, its day count is the file's age, and the threshold it quotes is the data file's. | Req 4.4, 4b.5 |

Supporting properties:

- **P6** The manifest lists exactly the `*.graveyard.json` files of the folder, with the counts in each file (Req 1.2).
- **P7** A local file with any `schemaVersion` other than 2 always gives the version message, and a valid version-2 file always loads (Req 1.8).
- **P8** The digging screen's added delay is between 0 and 1 second and its total time is at least 400 ms, for any loading time (Req 3.2).
- **P9** The panel side: the detail panel is always placed on the half of the window away from the selected item's screen position (Req 4.8).
- **P10** Middle shortening of a long path always keeps the whole file name (Req 4.9).
- **P11** The hover line of a stone starts with the state word that matches its `decayState`, carries its last commit date and its lines, and has exactly the flags that apply (unused when `unused`, hot with `recentCommits` when `hot`) and no others; a ghost's line starts with "Ghost" and ends with its toe-tag type. The words are the same as the detail panel's for the same item (Req 4b.2 to 4b.5).
- **P12** Dates on the hover line are the data file's dates in UTC, for any time zone the tests run in, and carry the year exactly when it differs from the snapshot's (Req 4b.4).

## Out of scope

- Writing eulogies (spec 4).
- The PR function, and the bury and resurrect animations (spec 5).
- Sound.

## Open questions for review

1. **Manifest.** The browser cannot list `public/graveyards/`, so I propose a small Vite plugin that writes `index.json` (name, repository name, file and ghost counts) from the folder in the dev server and in builds. The alternative is that the analyser updates `index.json` when it writes a file. Which do you want?
2. **No parameter means the boot screen.** Today a bare address loads spatialql. With this spec it shows the boot screen; only `?graveyard=` goes straight in. Agreed?
3. **Filters.** "Rows that satisfy every active filter" read literally makes fresh + stale match nothing. I propose kinds (fresh, stale, ancient, ghosts) combine with OR and flags (unused, hot) with AND (Req 5.4, P1). Agreed?
4. **Ghosts in the sorts.** Ghosts have no decay score or size. I propose they sort as most dead of all under decay, by days since deletion under age, and last under size (Req 5.2, 5.3).
5. **Bury** applies to stones that are unused or ancient ("cracked or ancient"), including a fresh unused stone. Agreed?
6. **Local files and the address.** A local file leaves no `graveyard` parameter, so a reload goes back to the boot screen. Keeping the file across a reload (in session storage) is possible but not proposed.
7. **Hover dates.** Month and day, with the year added when it is not the snapshot's year (both demo files fall within their snapshot's year, so they never show one; a long-lived repository will). Always UTC, as the data file's dates are (Req 4b.4).
8. **Which side.** The list docks on the left and the detail panel opens on the right by default, moving to the left when the selected item is on the right half of the screen (Req 4.8). The stats panel (top left) and legend (top right) stay where they are and collapse below 1600 px as now.
