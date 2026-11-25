# Backlog

Ideas kept out of the current tasks on purpose. Each needs its own small spec before it is built.

- **GitHub Action that generates the graveyard file in CI**: run the analyser on each push to the default branch and publish the `.graveyard.json` as an artifact (or to Pages), so the graveyard stays current.
- **Pull requests from your own account** (bury-and-resurrect, out of scope): sign in with GitHub to open Bury and Resurrect pull requests on your own repositories instead of the demo forks.
- **After a merge**: updating the graveyard when a Bury or Resurrect pull request is merged (open pull requests are shown live on load; once merged, the grave shows the data file again until it is regenerated).
- **Several files in one pull request**: bury a whole folder of unused files, or resurrect a deleted folder, as one change.
- **Tree clusters with gaps** in the forest: groves and clearings instead of an even wall, without trees ever coming inside the camera's limits (`model/camera-bounds.ts`).
- **Rim light** on stone edges, if the ambient fill and the moonlight still leave stones hard to separate from the ground (see task 25, step 4).

**From task 24b (reconciled at the close of task 25).** The ambient decoration was built as the horizon and atmosphere work: clouds, ground mist, the forest, the nearer trees and the framing trees, all stopping under reduced motion. Bats and shooting stars, two of the three parts of 24b not built then, are now built (Done, below); the third is kept here:
- **Moon dimming** (24b.3): clouds passing the moon would dim the moonlight by up to `MOON_DIM_MAX`; it needs a check that cracks, moss and candles stay readable at the darkest moment.

**From the narrow-window fix (task 28).** On an ultra-wide window (2.4 wide to tall), zoomed out as far as the camera limits allow, spatialql shows one tree of the ring (`forest/0/104`) at the side edge of the frame, nearer than the front fence. Nothing crosses the graveyard and the first frame, Reset view and the opening move are clear at every shape from 0.75 to 2.4; this is only the fully zoomed-out view at the widest shape. A fix would plan the ring for the zoomed-out camera too (`ZOOM_OUT_SHARE` times the establishing distance), or check `treeProblems` for the zoomed-out pose in `model/tree-placement.property.test.ts` and pull the zoom-out limit in where it fails.

**From the interface spec.** A graveyard file opened from disk (Open a graveyard file on the boot screen) is not kept across a reload: the page address has no `graveyard` parameter for it, so a reload returns to the boot screen and the file has to be opened again. Keeping it (for example in session storage, read back on load) was considered and left out on purpose.

## Done

Taken from this list, or asked for alongside it, and built:
- **Importer list** (`.kiro/specs/importers/`): the analyser records who imports each file and which files are entry points; the detail panel lists the importers as links that fly to them, and the hover adds "imported by N" when it fits.
- **Sky motion: the witch.** A witch on a broomstick crosses the moon (`model/witch.ts`, `scene/Witch.tsx`): first as the opening move settles, then every 45 to about 70 seconds, hidden under reduced motion.
- **The gravedigger during Bury** (`model/gravedigger.ts`, `scene/Gravedigger.tsx`): he digs while the request runs, pats the mound and plants the stake on success, or shakes his head on an error.
- **The screaming ghost during Resurrect** (`riseFrame` and `ghostWait` in `model/pr-scene.ts`): the ghost shivers while the request runs, then screams, rises into the sky and fades, and the stone forms once it is halfway up.
- **Shooting stars, bats and distant lightning, with a sky director** (`model/sky-director.ts`, `scene/SkyEvents.tsx`): one event in the sky at a time with the witch, 9 to 14 s of quiet between them, seeded; lightning dim, behind the clouds over the forest, at most 2 flashes and 30 s apart; none under reduced motion.
- **npx entry point** (`analyser/`, published as `repo-in-peace` 0.1.0): `npx repo-in-peace <clone> --out <name>.graveyard.json` analyses a repo without cloning this one; open the file on the live site with Open a graveyard file.
