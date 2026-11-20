import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import type { CameraPose } from '../src/model/camera-pose';
import { forestTrees, horizonPlan, nearTrees } from '../src/model/horizon';
import { buildSceneModel } from '../src/model/scene-model';
import { DEFAULT_FOV_Y } from '../src/model/camera-pose';
import { treeProblems, treesInTheWay } from '../src/model/tree-sightline';

/**
 * The camera can never get past the trees around the graveyard, in the real app: zoom out as far as the wheel goes and fly back
 * with Shift held, from the opening view and after orbiting round to the back and the sides, on both test files; after each, no
 * tree stands between the camera and the graveyard. The trees and the test of the line of sight come from the modules the app uses.
 */

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());

async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function zoomOutFully(page: Page): Promise<void> {
  await page.mouse.move(640, 360);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(800);
}

for (const name of ['demo.oikosledger', 'demo.spatialql']) {
  const graveyard = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
  const bounds = buildSceneModel(graveyard).layout.bounds;
  const plan = horizonPlan(bounds);
  const trees = [...forestTrees(plan), ...nearTrees(plan)];

  test(`${name}: zooming out fully and flying back never puts a tree between the camera and the graveyard`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?graveyard=${name}`);
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);

    const check = async (what: string): Promise<void> => {
      const p = await pose(page);
      const inTheWay = treesInTheWay(p.position, bounds, trees);
      expect(inTheWay.map((t) => t.key), `${what}: camera at ${JSON.stringify(p.position)}`).toEqual([]);
    };

    await zoomOutFully(page);
    await check('zoomed out fully from the opening view');
    await hold(page, ['Shift', 'KeyS'], 4000);
    await check('then flown back');

    // Orbit round to the back, then to each side, and zoom out and fly back again from there.
    for (const [label, dx] of [['the back', 900], ['one side', 450], ['the other side', -900]] as const) {
      await page.mouse.move(640, 360);
      await page.mouse.down();
      await page.mouse.move(640 + dx * 0.5, 360, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await zoomOutFully(page);
      await check(`orbited to ${label} and zoomed out`);
      await hold(page, ['Shift', 'KeyS'], 3000);
      await check(`orbited to ${label} and flown back`);
      await hold(page, ['Shift', 'KeyA'], 1500);
      await check(`orbited to ${label} and flown sideways`);
    }
  });
}

/**
 * Narrow windows (a laptop with DevTools docked at the side, a portrait screen): the establishing shot stands further back there, and
 * the trees are planned beyond it. From the first frame, zoomed out fully, and during and after Reset view, no tree is between the
 * camera and the graveyard, the camera is inside the ring of trees, and no tree shows in the frame nearer than the front fence.
 */
for (const [width, height] of [[1200, 1450], [900, 1200]] as const) {
  for (const name of ['demo.oikosledger', 'demo.spatialql']) {
    test(`${name} at ${width} × ${height}: the first frame, zooming out and Reset view keep every tree beyond the camera and out of the way`, async ({ page }) => {
      const graveyard = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
      const bounds = buildSceneModel(graveyard).layout.bounds;
      const plan = horizonPlan(bounds);
      const ring = forestTrees(plan);
      const trees = [...ring, ...nearTrees(plan)];
      await page.setViewportSize({ width, height });
      await page.goto(`/?graveyard=${name}`);
      await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
      await page.waitForTimeout(800);
      const check = async (what: string): Promise<void> => {
        const p = await pose(page);
        const viewShift = await page.evaluate(() => window.repoInPeace!.getViewShift());
        expect(treeProblems(bounds, trees, ring, { pose: p, viewShift }, width / height, DEFAULT_FOV_Y), `${what}: camera at ${JSON.stringify(p.position)}`).toEqual([]);
      };
      await check('the first frame');
      await zoomOutFully(page);
      await check('zoomed out fully');
      await hold(page, ['Shift', 'KeyS'], 3000);
      await check('then flown back');
      // Reset view: during the flight back and at its end.
      await page.keyboard.press('Home');
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(250);
        await check(`Reset view, ${(i + 1) * 250} ms in`);
      }
      await page.waitForTimeout(800);
      await check('after Reset view');
    });
  }
}
