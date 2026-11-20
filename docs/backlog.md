# Backlog

Ideas kept out of the current tasks on purpose. Each needs its own small spec before it is built.

- **Bats** crossing the sky now and then (task 24b.5 in `.kiro/specs/graveyard-scene/tasks.md`): one instanced mesh of 3 to 6, a wingspan of about 3 units, flapping in the vertex shader, hidden with reduced motion.
- **Shooting stars**: a rare streak across the upper sky, never near the moon, none with reduced motion.
- **Tree clusters with gaps** in the forest: groves and clearings instead of an even wall, without trees ever coming inside the camera's limits (`model/camera-bounds.ts`).
- **Rim light** on stone edges, if the ambient fill and the moonlight still leave stones hard to separate from the ground (see task 25, step 4).

**From task 24b (reconciled at the close of task 25).** The ambient decoration was built as the horizon and atmosphere work: clouds, ground mist, the forest, the nearer trees and the framing trees, all stopping under reduced motion. Three parts of 24b were not built and are kept here:
- **Bats** (24b.5 and the bat checks of 24b.7): the spec as written stands (3 to 6, about 3 units across, 22 to 32 high, first crossing within 4 to 14 seconds, then every 40 to 90; hidden under reduced motion; a dev `getAmbient()` for the browser test).
- **Shooting stars** (above).
- **Moon dimming** (24b.3): clouds passing the moon would dim the moonlight by up to `MOON_DIM_MAX`; it needs a check that cracks, moss and candles stay readable at the darkest moment.
