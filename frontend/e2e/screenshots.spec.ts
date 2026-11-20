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

  test('engraving close up: an unused stone (RIP and its name) and a used one (its name only)', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    for (const name of ['demo.oikosledger', 'demo.spatialql']) {
      const g = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/?graveyard=${name}`);
      await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
      await page.waitForTimeout(800);
      const unused = g.stones.find((s) => s.file.unused)!;
      // A fresh used stone (clean blue-grey), so the three pictures are three different looks: fresh, overgrown and unused.
      const used = g.stones.find((s) => s.file.decayState === 'fresh' && !s.file.unused && s.layout.height > 1.5) ?? g.stones.find((s) => !s.file.unused)!;
      const mossy = [...g.stones].filter((s) => s.file.decayState !== 'fresh' && !s.file.unused && s.layout.height > 1.2).sort((a, b) => b.visual.mossAmount - a.visual.mossAmount)[0];
      for (const [label, stone] of [['unused', unused], ['used', used], ...(mossy ? [['overgrown', mossy] as const] : [])] as const) {
        // Straight in front of the stone, a little above its top, close: nothing in the way.
        const { x, z, height } = stone.layout;
        await page.evaluate((p) => window.repoInPeace!.setPose(p), { position: { x, y: height * 0.75 + 0.6, z: z + 2.1 }, target: { x, y: height * 0.7, z } });
        await page.waitForTimeout(600);
        await page.mouse.move(640, 10);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}engrave-${name}-${label}.png` });
      }
      console.log(name, JSON.stringify(await page.evaluate(() => window.repoInPeace!.getEngravingAtlas())).slice(0, 200));
    }
  });

  // Task 25 follow-up 1: the wheel toward a front-row stone, and a double-click on a stone, on both files.
  for (const name of ['demo.oikosledger', 'demo.spatialql']) {
    test(`zoom toward the pointer and double-click to fly: ${name}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const g = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/?graveyard=${name}`);
      await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
      await page.waitForTimeout(1200);
      const rows = [...g.stones].sort((a, b) => b.layout.z - a.layout.z);
      let target: { path: string; at: { x: number; y: number } } | null = null;
      for (const s of rows) {
        const at = await page.evaluate((path) => window.repoInPeace!.getScreenPoint(path), s.file.path);
        if (at && at.x > 160 && at.x < 1120 && at.y > 120 && at.y < 600) {
          target = { path: s.file.path, at };
          break;
        }
      }
      if (target === null) throw new Error('no front-row stone on screen');
      const found = target;
      let at = found.at;
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(at.x, at.y);
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(80);
        at = (await page.evaluate((path) => window.repoInPeace!.getScreenPoint(path), found.path)) ?? at;
      }
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}zoom-${name}.png` });
      await page.evaluate(() => window.repoInPeace!.resetView());
      await page.waitForTimeout(1800);
      await page.mouse.dblclick(found.at.x, found.at.y);
      await page.waitForTimeout(1900);
      await page.mouse.move(640, 8);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}dblclick-${name}.png` });
    });
  }

  // Task 25 follow-up 3: signs up close on oikos_ledger, near accounts/compare, where two signs used to overlap.
  test('signs up close: only the nearest of overlapping signs, smaller plaque boards', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const g = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1000);
    const stone = [...g.stones].filter((s) => s.layout.folder.includes('compare')).sort((a, b) => b.layout.z - a.layout.z)[0] ?? g.stones[0]!;
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), stone.file.path);
    await page.waitForTimeout(1900);
    await page.mouse.move(640, 8);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}signs-close-oikosledger.png` });
  });
});
