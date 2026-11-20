import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { candleSpots } from '../src/model/candle-placement';
import { RIP_TEXT, engravingFor } from '../src/model/engraving';
import { buildSceneModel } from '../src/model/scene-model';
import { CANDLE_HEIGHT } from '../src/model/visual-constants';

/**
 * Smoke test of the stone material in the real app, on the oikos_ledger file: the shaders compile, a stone shows what
 * its facts say (moss for age, cracks and a red glow for unused) and nothing else, and hover and selection are a rim of
 * light at the edge, not a tint of the surface. The pixels are counted in a window around each stone after flying to it.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);

const stoneWhere = (test: (s: (typeof model.stones)[number]) => boolean) => model.stones.find(test)!;
const freshUnused = stoneWhere((s) => s.file.path === 'app/components/voice/index.ts'); // 19 days old: fresh, and unused
const freshUsed = stoneWhere((s) => s.file.decayState === 'fresh' && !s.file.unused && s.layout.height > 1.2);
const mossy = [...model.stones].filter((s) => s.file.decayState === 'ancient' && !s.file.unused).sort((a, b) => b.visual.mossAmount - a.visual.mossAmount)[0]!;
const ancientUnused = stoneWhere((s) => s.file.decayState === 'ancient' && s.file.unused);

type Kind = 'green' | 'red' | 'magenta' | 'yellow';

/** How many pixels of a kind are in the window of `half` pixels around (x, y) of the page. */
async function countPixels(page: Page, kind: Kind, centre: { x: number; y: number }, half = 90): Promise<number> {
  const clip = { x: Math.max(0, Math.round(centre.x) - half), y: Math.max(0, Math.round(centre.y) - half), width: 2 * half, height: 2 * half };
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, what }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
        if (what === 'green' && g > r + 12 && g > b + 12 && g > 50) count++;
        if (what === 'red' && r > g + 45 && r > b + 45 && r > 90) count++;
        if (what === 'yellow' && r > 55 && g > 50 && r >= 1.7 * b && Math.abs(r - g) <= 15) count++; // the candle's yellow, lit: red and green about equal, blue far lower
        if (what === 'magenta' && r > 170 && b > 120 && g < r - 60 && g < b - 30) count++;
      }
      return count;
    },
    { data: png, what: kind },
  );
}

async function flyTo(page: Page, path: string): Promise<{ x: number; y: number }> {
  await page.evaluate((p) => window.repoInPeace!.flyTo(p), path);
  await page.waitForTimeout(1700);
  await page.mouse.move(640, 20); // the pointer out of the way
  const at = await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), path);
  expect(at, `${path} should be on screen`).not.toBeNull();
  return at!;
}

test.describe('stone material, in the real app', () => {
  const problems: string[] = [];

  test.beforeEach(async ({ page }) => {
    problems.length = 0;
    page.on('console', (message) => {
      const text = message.text();
      // The software renderer's own performance notes and a deprecation notice are not problems with the shaders.
      if (message.type() === 'error' || /THREE\.WebGL|shader|GLSL|program/i.test(text) && message.type() === 'warning') problems.push(`${message.type()}: ${text.slice(0, 300)}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1000);
  });

  test('the shaders compile and draw without errors', async ({ page }) => {
    await flyTo(page, mossy.file.path);
    await flyTo(page, freshUnused.file.path);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the engraving atlas has RIP and every stone\'s name drawn in it', async ({ page }) => {
    const lit = await page.evaluate(() => window.repoInPeace!.getEngravingAtlas());
    expect(lit[RIP_TEXT], 'pixels of RIP in its cell').toBeGreaterThan(500);
    for (const s of model.stones) {
      const name = engravingFor(s.file.path, s.file.unused).name!;
      expect(lit[name] ?? 0, `pixels of ${name} in its cell`).toBeGreaterThan(150);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('moss shows on an old stone and not on a fresh one', async ({ page }) => {
    const old = await countPixels(page, 'green', await flyTo(page, mossy.file.path));
    const fresh = await countPixels(page, 'green', await flyTo(page, freshUsed.file.path));
    expect(old, `green pixels on the mossy stone (${mossy.file.path}, moss ${mossy.visual.mossAmount.toFixed(2)})`).toBeGreaterThan(150); // 284 with the night lighting of task 24 (over 400 under the plain lights); task 25.02 brightens the effects
    expect(fresh, 'green pixels on a clean fresh stone').toBeLessThan(old / 8);
  });

  test('cracks and the red glow show on an unused stone, fresh or old, and not on a used one', async ({ page }) => {
    const cracked = await countPixels(page, 'red', await flyTo(page, freshUnused.file.path), 60);
    const crackedOld = await countPixels(page, 'red', await flyTo(page, ancientUnused.file.path), 60);
    const used = await countPixels(page, 'red', await flyTo(page, freshUsed.file.path), 60);
    const mossyUsed = await countPixels(page, 'red', await flyTo(page, mossy.file.path), 60);
    expect(cracked, 'red pixels on the fresh unused stone').toBeGreaterThan(25);
    expect(crackedOld, 'red pixels on the old unused stone').toBeGreaterThan(8);
    expect(used, 'red pixels on a used fresh stone').toBeLessThan(5);
    expect(mossyUsed, 'red pixels on a used, mossy stone').toBeLessThan(5);
  });

  test('a selected stone gets a rim of light at its edge: pink pixels at its top, none when it is not selected', async ({ page }) => {
    const at = await flyTo(page, freshUsed.file.path);
    const top = (await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [freshUsed.layout.x, freshUsed.layout.height, freshUsed.layout.z]))!;
    expect(await countPixels(page, 'magenta', top, 25), 'pink at the top of the stone before it is selected').toBe(0);
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), freshUsed.file.path);
    await page.waitForTimeout(600);
    expect(await countPixels(page, 'magenta', top, 25), `pink rim at the top of the selected stone (the stone is at ${JSON.stringify(at)})`).toBeGreaterThan(5);
    await page.evaluate(() => window.repoInPeace!.clearSelection());
    await page.waitForTimeout(600);
    expect(await countPixels(page, 'magenta', top, 25), 'pink at the top after the selection is cleared').toBe(0);
  });

  test('a hot stone has a lit candle that glows yellow beside it, and a stone that is not hot has none', async ({ page }) => {
    const spots = candleSpots(model.stones);
    expect(spots.length, 'oikos_ledger has 7 hot files').toBe(7);
    const spot = spots[1]!;
    await flyTo(page, spot.path);
    const flame = (await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [spot.x, CANDLE_HEIGHT + 0.1, spot.z]))!;
    const lit = await countPixels(page, 'yellow', flame, 45);
    expect(lit, 'yellow pixels around the candle of a hot stone').toBeGreaterThan(20);

    const cold = await flyTo(page, freshUsed.file.path);
    expect(await countPixels(page, 'yellow', cold, 90), 'yellow pixels around a stone that is not hot').toBeLessThan(5);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
