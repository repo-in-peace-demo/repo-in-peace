import { test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { ghostBaseHeight } from '../src/model/ghost-motion';
import { buildSceneModel } from '../src/model/scene-model';

/**
 * Pictures to judge by eye, not a check: a close-up of a ghost after `flyTo`, so its hem (two tips pointing down and curling
 * outward, like a pair of curly braces) can be seen. Skipped unless SCREENSHOTS=1, so the normal run stays fast. The pictures go
 * to test-results/screenshots/ (ignored by git); the run prints where.
 *
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const model = buildSceneModel(JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard);
const OUT = fileURLToPath(new URL('../test-results/screenshots/', import.meta.url));

test.describe('screenshots to judge by eye', () => {
  test.skip(process.env.SCREENSHOTS !== '1', 'set SCREENSHOTS=1 to take the pictures');

  // The opening view of each graveyard at both laptop shapes (`SHOT` names the files, e.g. SHOT=mist), and one lower view.
  for (const name of ['demo.oikosledger', 'demo.spatialql']) {
    test(`the opening view of ${name}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const tag = process.env.SHOT ?? 'view';
      for (const [w, h] of [[1280, 800], [1280, 720], [1920, 1080]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/?graveyard=${name}`);
        await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.repoInPeace!.setAnimationTime(4));
        await page.mouse.move(w / 2, 10);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}${tag}-${name}-${w}x${h}.png` });
      }
      // Lower and nearer: fly to a front stone, where the mist between the rows is seen across the ground.
      const g = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard);
      const front = [...g.stones].sort((a, b) => b.layout.z - a.layout.z)[0]!;
      await page.evaluate((p) => window.repoInPeace!.flyTo(p), front.file.path);
      await page.waitForTimeout(1700);
      await page.screenshot({ path: `${OUT}${tag}-${name}-close.png` });
      // Orbited as far to the side as the camera goes (the limit), from the opening view: the side trees and the stones' sides.
      await page.evaluate(() => window.repoInPeace!.resetView());
      await page.waitForTimeout(1600);
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(640, 360);
        await page.mouse.down();
        await page.mouse.move(1250, 360, { steps: 15 });
        await page.mouse.up();
      }
      await page.mouse.move(640, 10);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}${tag}-${name}-side.png` });
      console.log(`${name}: ${OUT}${tag}-${name}-*.png`);
    });
  }

  test('a ghost close up after flyTo, and its hem', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.spatialql');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);

    for (const [i, ghost] of model.ghosts.entries()) {
      await page.evaluate((p) => window.repoInPeace!.flyTo(p), ghost.ghost.path);
      await page.waitForTimeout(1700);
      await page.evaluate(() => window.repoInPeace!.setAnimationTime(0)); // the same moment of the bob as the hem tests
      await page.mouse.move(640, 20); // off the ghost, so no hover tint or label
      await page.waitForTimeout(300);

      const full = `${OUT}ghost-${i + 1}-flyto.png`;
      await page.screenshot({ path: full });

      // A tight crop around the lower half of the ghost and its hem, from its middle to just under its base.
      const base = ghostBaseHeight(ghost.visual, 0);
      const centre = await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [ghost.layout.x, base + 0.6, ghost.layout.z]);
      const foot = await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [ghost.layout.x, base, ghost.layout.z]);
      if (centre && foot) {
        const half = Math.max(60, Math.round((foot.y - centre.y) * 2.2));
        const x = Math.min(1280 - 1, Math.max(0, Math.round(centre.x - half)));
        const y = Math.min(720 - 1, Math.max(0, Math.round(centre.y - half / 2)));
        const clip = { x, y, width: Math.min(half * 2, 1280 - x), height: Math.min(Math.round(half * 1.4), 720 - y) }; // inside the viewport
        await page.screenshot({ path: `${OUT}ghost-${i + 1}-hem.png`, clip });
      }
      console.log(`ghost ${ghost.ghost.path}: ${full}${centre && foot ? ` and ${OUT}ghost-${i + 1}-hem.png` : ''}`);
    }
  });

  test('the front stone selected after flyTo, with its ring', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.spatialql');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
    // The stone nearest the camera in the starting view, as e2e/selection.spec.ts picks it.
    const middleX = model.layout.bounds.x + model.layout.bounds.w / 2;
    const front = [...model.stones].sort((a, b) => b.layout.z - a.layout.z || Math.abs(a.layout.x - middleX) - Math.abs(b.layout.x - middleX))[0]!;
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), front.file.path);
    await page.waitForTimeout(1600);
    await page.mouse.move(640, 30);
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), front.file.path);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}stone-selected-flyto.png` });
    const foot = await page.evaluate(([x, z]) => window.repoInPeace!.projectPoint(x!, 0.02, z!), [front.layout.x, front.layout.z]);
    if (foot) {
      const x = Math.min(1280 - 300, Math.max(0, Math.round(foot.x) - 150));
      const y = Math.min(720 - 300, Math.max(0, Math.round(foot.y) - 150));
      await page.screenshot({ path: `${OUT}stone-selected-ring.png`, clip: { x, y, width: 300, height: 300 } });
    }
    console.log(`stone ${front.file.path}: ${OUT}stone-selected-flyto.png, foot at ${JSON.stringify(foot)}`);
  });
});
