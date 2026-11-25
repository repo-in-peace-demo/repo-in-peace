# Guided tour (narrated): requirements

The landing page's **Take the tour** starts a narrated tour that drives the app by itself: it chooses a demo, flies the camera, opens panels, and plays a Bury and a Resurrect, with pre-recorded narration and captions. It runs the same way every time, so one run can be screen-recorded as the demo video. Target length about 2:15.

## Glossary
- **Step**: one row of the tour table: an on-screen action and one narration clip. A step ends when both have finished.
- **Narration source**: one file holding every step's caption text, pronunciation hints and optional voice override. It feeds both the audio script and the captions.
- **Manifest**: `frontend/public/tour/manifest.json`, written by the script: each step's audio file, duration and input hash.
- **Preview**: a Bury or Resurrect that plays its animations and sounds but opens no pull request.

## 1. Starting and ending
1. Take the tour SHALL start the tour from the landing page. Starting it SHALL count as the user action that allows audio.
2. The tour SHALL run its steps in order (section 3). Each step SHALL move on only when both its narration and its on-screen action have finished.
3. At the end it SHALL show an end card over the scene: "Repo In Peace", the command `npx repo-in-peace path/to/your-repo --out your-repo.graveyard.json`, the live URL, the GitHub repo link, and "Built with Kiro for Kiroween 2026", with **Enter the graveyard** and **Replay tour** buttons.
4. Exit (a button, or Esc) SHALL stop the tour at once and leave the normal app where it is: narration stops, captions and tour controls go, the camera stays, and the panels go back to collapsed.

## 2. Controls
1. Pause/Resume, Back, Next and Exit tour SHALL be on screen and reachable by keyboard.
2. Back and Next SHALL go to the start of the previous or next step, with the scene put in that step's starting state.
3. Any camera input from the user (drag, scroll, a flying key) SHALL pause the tour and show **Resume tour**. Resume continues the current step from its start.

## 3. The steps
The eight steps of the brief, in order. Each step's narration is in the narration source; its action:
1. Landing → boot screen typing → oikos_ledger chosen → digging screen → the opening camera rise, with the witch crossing the moon.
2. A slow pan across the graveyard.
3. Fly to a clean stone, a mossy one, a leaning overgrown one, then a candle, each with its legend entry highlighted.
4. Fly to `app/components/dashboard/DashboardClient.tsx` (cracked); its legend entry is highlighted.
5. The detail panel and the dead chain: see open question 2.
6. Bury, confirmed: the gravedigger digs, the stone sinks, the mound and stake appear.
7. Switch to spatialql (through the boot screen, quickly), fly to the ghost `src/surface-placement.ts`, Resurrect: it shivers, rises screaming, and the new stone appears.
8. Back to the overview; the end card.

The stones of step 3 SHALL be fixed paths chosen once, not picked at run time.

## 4. Bury and Resurrect in the tour
1. By default both SHALL be previews: the animations and sounds play, no request reaches the PR function, and the stake reads "PR preview".
2. With `?tour=real` in the address, both SHALL open real pull requests through the normal flow and its limits.
3. The narration SHALL describe the real behaviour either way.

## 5. Narration, captions and sound
1. A caption band at the bottom SHALL show each step's narration text from the narration source, readable at 1280 × 720, with a permanent note: "Narration: AI-generated voice (OpenAI)".
2. Narration SHALL play even when the app's sound toggle is off at the start. Turning sound off during the tour SHALL mute the narration too; the captions continue.
3. Ambient and effect sounds SHALL follow the normal toggle.
4. The deployed site SHALL never call OpenAI; no key SHALL be in the browser or the repository.

## 6. The narration script (`scripts/`, run by the user)
1. It SHALL read the narration source, call OpenAI text to speech with `OPENAI_API_KEY` from the environment, and write one audio file per step to `frontend/public/tour/`, and the manifest.
2. The voice, model, speed and voice instructions SHALL be settings at the top of the script; a step MAY override the voice in the narration source.
3. The manifest SHALL store, per step, a hash of everything that affects its audio (text, voice, model, speed, instructions).
4. A normal run SHALL generate only steps whose hash changed or whose file is missing. `--only <step>` (repeatable) SHALL limit the run to those steps; `--force --only <step>` regenerates them even if unchanged; `--force` alone regenerates all, after asking for confirmation. `--dry-run` SHALL list what would be generated and the characters to be sent, and call nothing.
5. Every run SHALL end with a summary: generated, skipped, characters sent.

## 7. Determinism and reduced motion
1. The tour SHALL use the same camera paths, choices and timings on every run (no randomness, no dependence on load time beyond waiting for its own steps).
2. Under reduced motion, flights SHALL be camera cuts and animations instant changes; narration and captions as normal, and the tour SHALL still complete.

## 8. Tests
1. A pure tour model: steps in order, each with a caption and a manifest clip; Back, Next, Pause, Resume and Exit always valid from any state; the planned total between 2:00 and 2:30.
2. The script's regeneration logic, with a fake API client: unchanged steps are never sent; a changed step regenerates exactly that file; `--dry-run` sends nothing.
3. Browser checks with short fake audio clips: the whole tour runs to the end card; in preview mode no request reaches `POST /api/pr`; Exit and Esc stop it cleanly; a camera drag pauses it; captions match the source; under reduced motion it completes.
4. Screenshots of steps 3, 5, 6, 7 and the end card.

## Out of scope
- Narration in other languages; a tour of a file opened from disk; live text to speech.

## Open questions
1. **The year.** The narration says FSN was 1993; the logo says 1992. FSN shipped with IRIX in 1992 and became famous from Jurassic Park in 1993. Which year should both say?
2. **Step 5's chain is the other way round.** `DashboardClient.tsx` has no importers: its panel says "Unused: nothing in the project imports it (Knip)" with no links. It is `BankAccountsSection.tsx` whose panel says "Unused: only imported by other unused files", with a link to `DashboardClient.tsx`. Proposal: in step 5, select `BankAccountsSection.tsx`, show its panel, click the link to `DashboardClient.tsx`, and land on it, ready for step 6's Bury. Step 4 still introduces the cracked `DashboardClient.tsx`.
3. **Which stone does step 6 bury?** Proposal: `DashboardClient.tsx`, the end of the chain shown in step 5.
4. **The spatialql switch in step 7.** Proposal: the tour goes through the boot screen with the typing skipped and the digging screen's beat at its minimum, about 2 s in all.
5. **Back and Next across the demo switch** (steps 6 to 7): proposal: they load the other demo directly (no boot screen).
6. **The voice settings to start from.** Proposal: model `gpt-4o-mini-tts`, voice `onyx`, speed 1.0, with a short instruction ("calm, low, unhurried, a hint of mischief"). You pick the final voice by ear.
7. **Audio format.** Proposal: MP3, about 100 KB a clip, so the tour's audio is under 1 MB in all.
8. **Duration check.** The narration's length decides most of the 2:15. If the generated clips make the total fall outside 2:00 to 2:30, should the tour's pauses stretch or shrink to fit, or should the test fail so the text is adjusted? Proposal: the test fails, and you adjust the text.
