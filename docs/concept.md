# Repo In Peace — Concept

Nov 1, 2026 · @sun

## Pitch

Repo In Peace turns any GitHub repo into a haunted 3D graveyard, so finding and burying dead code feels like a night walk instead of a chore.

It resurrects SGI's 1990s 3D file navigator for the Kiroween 2026 Resurrection category. Folders become crypts, files become tombstones, stale code grows moss, and deleted files drift as ghosts. One click buries dead code or brings a lost file back, each as a reviewable pull request.

## The dead tech: FSN on IRIX

FSN (File System Navigator) was SGI's experimental 3D file browser for IRIX, the Unix that ran on SGI graphics workstations in the early 1990s. It showed a file system as a landscape: folders were platforms, files were blocks sized by file size, and you flew over it to find things. It became famous from a scene in *Jurassic Park*, then died with SGI's workstations.

What we keep: the flyover, the landscape layout, size as height. What we add: time. FSN showed what files exist; Repo In Peace shows which ones are alive, dying or dead.

Rules to respect: no SGI, IRIX or FSN logos, no film footage or audio. Recreate the era's look ourselves.

## Problem and audience

Dead code piles up in every codebase, and cleaning it is boring, so nobody does it. Unused files and exports slow builds, confuse new contributors and hide real bugs. Existing tools report dead code as long text lists that people skim and ignore.

Who it's for:

- **Open-source maintainers** who want a quick picture of what in their repo has rotted.
- **Engineers joining a codebase** who need to see what is alive before they touch anything.
- **Tech leads** planning a cleanup sprint who need something a team will actually look at.

The pitch to judges: the same findings a dead-code report gives, made impossible to ignore.

## The graveyard and its decay rules

Every visual effect means one specific thing, so the scene stays readable, not just spooky. Thresholds below are first drafts to tune once real repo data is in.

| In the repo | In the graveyard | Rule (draft) |
| --- | --- | --- |
| Folder | Crypt or fenced plot | One per folder; nested folders sit inside |
| File | Tombstone | Height = lines of code |
| Recently changed file | Clean, upright stone | Last commit under 3 months ago |
| Stale file | Moss creeping up the stone | 3 to 12 months untouched; more moss with age |
| Ancient file | Leaning, heavily overgrown | Over 12 months untouched |
| Unused file or export | Cracked stone, faint red glow | Knip reports it as unused |
| Deleted file | Translucent ghost hovering near its old spot | Exists in git history, not in the current tree |
| Hot file | Lit candle at the base | Many commits in the last month |

Decay score per file = age since last commit, plus a strong weight if Knip flags it unused. The score drives moss and lean; the crack and ghost states are yes/no.

## Core screens

Four screens carry the whole experience; the graveyard is where most of the time is spent.

1. **Boot screen.** A green-phosphor terminal types out a fake workstation boot, then offers the demo repo, two or three other pre-analysed repos, or a graveyard file you made yourself with the local command. Judges never hit an empty state.
2. **Digging.** A short loading scene while the graveyard data loads: shovel sounds, progress lines in terminal style ("exhuming 1,204 commits…").
3. **The graveyard.** The 3D flyover. Fog, moonlight, crypts and tombstones laid out like FSN's landscape. Fly with mouse or keys; a search box flies the camera to any file. A legend explains moss, cracks, ghosts and candles.
4. **Grave detail panel.** Opens when you click a tombstone or ghost. Shows the file path, date of last commit, last author, size, why it's flagged, and a one-paragraph "eulogy" written by an LLM summarising what the file did. Holds the Bury or Resurrect button.

A list view docks beside the scene: every file sorted by decay, most dead first, with filters for stale, unused and ghost. Clicking a row flies the camera to that grave; clicking a grave highlights its row. This keeps the tool fast for real cleanup work, not just a flythrough. A stats overlay shows counts of living, stale, dead and ghost files.

## Bury and resurrect

Both actions open a pull request and never change a branch directly, so nothing is lost and a human always approves.

- **Bury** (only on a cracked stone, one Knip lists as unused, whatever its age; an old file that is still used is stable, not dead, and is never offered for burial): opens a PR that deletes the file, with the eulogy and the reasons it was flagged in the PR description. In the scene, a hand pulls the stone into the ground.
- **Resurrect** (on a ghost): opens a PR that restores the deleted file exactly as it was at its last commit. No rewriting. In the scene, the ghost solidifies back into a stone.

For judges: the hosted demo opens PRs against a fork of the demo repo in your own GitHub account, so it always works without asking judges to log in. Opening PRs on someone's own repo needs GitHub sign-in and is a nice-to-have. Safeguards: the PR function uses a GitHub token scoped to the demo fork only, limits how often anyone can trigger it, and the fork can be reset to a clean state at any time.

## Architecture

Analysis happens ahead of time, not when someone opens the site: the analyser runs locally or in a GitHub Action and writes one graveyard data file per repo, eulogies included.

&#91;embedded content: Repo In Peace architecture · 6 parts\]

The browser only loads these static files, so judges trigger no GitHub API calls and no rate limits. The one live server piece is a small serverless function that opens PRs. To see your own repo, run the analyser as a local command and drop the resulting file into the site; live analysis of arbitrary repos on a server is out of scope, since Knip needs the repo cloned with its dependencies installed. Eulogies come from a current small, cheap LLM, generated once per file at analysis time.

## How Kiro is used to build it

Kiro is the build tool, not a part of the running app; its work shows in the committed `.kiro` folder and the write-up. Each feature gets used where it genuinely helps:

| Kiro feature | Where it's used |
| --- | --- |
| Specs | One spec each for: decay scoring, repo analysis pipeline, graveyard scene, bury/resurrect PR flow |
| Steering | The visual language (what moss, cracks, ghosts and candles mean), stack conventions and strict TypeScript types, tone of eulogies |
| Hooks | On save: run tests for the changed module; on spec change: refresh test fixtures |
| Property-based testing | Decay never decreases as a file ages; tombstones and crypts never overlap, for any randomly generated repo shape; the same repo snapshot always gives the same graveyard; resurrecting a buried file restores it byte for byte |
| MCP | GitHub MCP server for reading repo data and testing PR creation during development |
| Kiro Crew | Optional: parallel agents for the scene and the backend in the final push, if it proves useful |

Keep a running notes file in `docs/` of what each feature changed, so the write-up has real before/after examples.

## Scope

The must-haves are sized for about 3.5 solo weeks; everything else waits until they work end to end.

**In (must have)**

- Public JavaScript/TypeScript repos only
- Boot screen, digging screen, graveyard, grave detail panel
- Decay rules, moss, cracks, ghosts, legend, search-to-fly, list view synced with the scene
- LLM eulogy per grave, generated at analysis time
- Bury and Resurrect PRs against the demo fork
- Demo repo plus two or three other pre-analysed repos, loaded from static files; a local command that turns your own repo into a graveyard file

**Out**

- AI rewriting or modernising code
- Kiro running inside the app
- Languages other than JS/TS
- Private repos, and live analysis of arbitrary repos on a server

**Stretch (only if ahead of schedule)**

- GitHub sign-in to open PRs on your own repos
- Time-lapse: scrub through history and watch the graveyard grow
- Ambient sound and a "night walk" auto-tour camera for the video

## 3-minute demo arc

The video shows one complete loop, from boot to a real merged-ready PR, in under three minutes.

1. **0:00–0:20, the hook.** Green terminal boot. One line of text: the 1990s 3D file browser, back from the dead.
2. **0:20–0:40, the problem.** A long, boring dead-code text report scrolls past. "Nobody reads this."
3. **0:40–1:30, the graveyard.** Paste the demo repo, watch the digging screen, swoop into the fog. Fly past mossy stones, a cracked stone, a cluster of ghosts. Use search to fly to one file.
4. **1:30–2:15, bury and resurrect.** Click a cracked stone, read its eulogy, Bury: the stone sinks. Cut to the real PR on GitHub. Then Resurrect a ghost and show its PR.
5. **2:15–2:45, built with Kiro.** Quick tour of the `.kiro` folder: a spec, the steering doc, a hook firing, a property test catching a bug.
6. **2:45–3:00, close.** Who it's for, the repo link, the name.

All audio and fonts original or CC0; no film clips.

## Timeline to Dec 4

The build starts Nov 19, once SPECS is submitted, and aims to be feature complete by Nov 28.

&#91;embedded content: Build plan · 5 phases, 2 gates\]

The deadline is Dec 4 at 2:00 PM Pacific, which is early on Dec 5 in India, so plan to submit on Dec 3 and keep a day of buffer.

## Submission checklist and open questions

- [ ] Confirm in the Official Rules that residents of India can enter and receive prizes
- [ ] Public GitHub repo with MIT license showing in About
- [ ] `.kiro` folder at the root, committed, never in `.gitignore`
- [ ] Working hosted URL with the demo repo pre-loaded
- [ ] Demo video under 3 minutes, public on YouTube, no copyrighted material
- [ ] Text description and Kiro usage write-up
- [ ] Category: Resurrection
- [ ] Optional: blog post and #KiroweenHackathon26 social post during the submission period

Open question and decisions:

- Which demo repo? It should be a mid-sized TypeScript application, not a library: a library's unused exports are often public API, so the graveyard would mark live code as dead. Needs real rot and a long history with deleted files; don't plant fake dead code.
- Decided: static graveyard data files plus one serverless function for PRs, so judges hit no GitHub rate limits.
- Decided: eulogies come from a current small, cheap LLM, run once per file at analysis time; pick the model when building.
