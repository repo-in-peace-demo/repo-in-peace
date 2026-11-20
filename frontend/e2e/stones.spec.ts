import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { candleSpots } from '../src/model/candle-placement';
import { RIP_TEXT, engravingFor } from '../src/model/engraving';
import { buildSceneModel } from '../src/model/scene-model';
import { STONE_W } from '../src/model/layout-constants';
import { CANDLE_HEIGHT } from '../src/model/visual-constants';

/** Task 25.02 thresholds for the default view at 1280 x 720, set from the tuned look (see design.md). */
const UNUSED_MIN_RED = 8; // the least on a visible unused stone was 10 (oikos app/components/ui/index.ts)
const STALE_MIN_GREEN = 20; // the least on a visible stale or ancient stone was 28
/** A stone is hidden from the default view when nearer stones cover this share of its window. */
const HIDDEN_SHARE = 0.9;
// Behind a taller stone in the row in front: a layout matter (stone order within a block), not the shader. See design.md.
const KNOWN_HIDDEN: Record<string, string[]> = {
  'demo.oikosledger': ['app/lib/db/queries/insights.ts'],
  'demo.spatialql': ['src/assets.ts', 'src/components.ts', 'src/grab-debug.ts'],
};

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

/**
 * Task 25.02: from the default view of each file, without flying, every stale stone shows green, every unused stone
 * shows red, and a fresh used stone shows neither. The window of each stone is its own outline on screen (projected
 * from its foot and top), so a stone a few pixels wide is counted on its own pixels.
 */
const COUNT_FILES = ['demo.oikosledger', 'demo.spatialql'] as const;

type Rect = { path: string; x0: number; x1: number; y0: number; y1: number; near: number };

/** The share of a stone's window covered by the windows of stones nearer the camera (sampled on a 1-pixel grid). */
function hiddenShare(r: Rect, all: readonly Rect[]): number {
  const nearer = all.filter((o) => o.near < r.near - 1e-6 && o.x1 > r.x0 && o.x0 < r.x1 && o.y1 > r.y0 && o.y0 < r.y1);
  let covered = 0;
  let total = 0;
  for (let y = r.y0 + 0.5; y < r.y1; y++) {
    for (let x = r.x0 + 0.5; x < r.x1; x++) {
      total++;
      if (nearer.some((o) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1)) covered++;
    }
  }
  return total === 0 ? 1 : covered / total;
}

async function countInRects(page: Page, rects: readonly Rect[]): Promise<Record<string, { green: number; red: number; area: number }>> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, rects }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      const out: Record<string, { green: number; red: number; area: number }> = {};
      for (const r of rects) {
        let green = 0;
        let red = 0;
        let area = 0;
        for (let y = Math.max(0, Math.floor(r.y0)); y <= Math.min(canvas.height - 1, Math.ceil(r.y1)); y++) {
          for (let x = Math.max(0, Math.floor(r.x0)); x <= Math.min(canvas.width - 1, Math.ceil(r.x1)); x++) {
            const i = (y * canvas.width + x) * 4;
            const [cr, cg, cb] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
            area++;
            if (cg > cr + 12 && cg > cb + 12 && cg > 50) green++;
            if (cr > cg + 40 && cr > cb + 30 && cr > 80) red++;
          }
        }
        out[r.path] = { green, red, area };
      }
      return out;
    },
    { data: png, rects },
  );
}

for (const name of COUNT_FILES) {
  test(`from the default view of ${name}: every stale stone is green, every unused one red, a fresh used one neither`, async ({ page }) => {
    const g = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
    const m = buildSceneModel(g);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?graveyard=${name}`);
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.mouse.move(640, 5);
    const rects: Rect[] = [];
    for (const s of m.stones) {
      const r = await page.evaluate(
        ([x, z, h, w]) => {
          const api = window.repoInPeace!;
          const foot = api.projectPoint(x!, 0, z!);
          const top = api.projectPoint(x!, h!, z!);
          const side = api.projectPoint(x! + w! / 2, h! / 2, z!);
          const p = api.getPose().position;
          const near = Math.hypot(p.x - x!, p.y - h! / 2, p.z - z!);
          return foot && top && side ? { foot, top, side, near } : null;
        },
        [s.layout.x, s.layout.z, s.layout.height, STONE_W],
      );
      if (r === null) continue;
      const half = Math.max(2, Math.abs(r.side.x - r.foot.x));
      rects.push({ path: s.file.path, x0: r.foot.x - half, x1: r.foot.x + half, y0: Math.min(r.top.y, r.foot.y), y1: Math.max(r.top.y, r.foot.y), near: r.near });
    }
    const counts = await countInRects(page, rects);
    const byPath = new Map(m.stones.map((s) => [s.file.path, s] as const));
    const report: string[] = [];
    // A stone whose window is mostly behind nearer stones cannot show anything; those are listed and must stay the known few.
    const hidden = rects.filter((r) => hiddenShare(r, rects) >= HIDDEN_SHARE).map((r) => r.path);
    const visible = (s: (typeof m.stones)[number]) => !hidden.includes(s.file.path);
    const unused = m.stones.filter((s) => s.file.unused && visible(s));
    const stale = m.stones.filter((s) => s.file.decayState !== 'fresh' && !s.file.unused && visible(s));
    const hiddenFlagged = m.stones.filter((s) => (s.file.unused || s.file.decayState !== 'fresh') && !visible(s)).map((s) => s.file.path).sort();
    report.push(`hidden: ${JSON.stringify(hiddenFlagged)}`);
    expect.soft(hiddenFlagged, 'stale or unused stones hidden behind nearer stones from the default view').toEqual(KNOWN_HIDDEN[name]);
    for (const s of unused) {
      const c = counts[s.file.path]!;
      report.push(`unused ${s.file.path}: red ${c.red}/${c.area}`);
      expect.soft(c.red, `red pixels on unused ${s.file.path} (of ${c.area})`).toBeGreaterThanOrEqual(UNUSED_MIN_RED);
    }
    for (const s of stale) {
      const c = counts[s.file.path]!;
      report.push(`${s.file.decayState} ${s.file.path}: green ${c.green}/${c.area}`);
      expect.soft(c.green, `green pixels on ${s.file.decayState} ${s.file.path} (of ${c.area})`).toBeGreaterThanOrEqual(STALE_MIN_GREEN);
    }
    // The nearest fresh used stone (biggest on screen) is the one whose window holds only itself.
    const fresh = m.stones
      .filter((s) => s.file.decayState === 'fresh' && !s.file.unused && counts[s.file.path] !== undefined)
      .sort((a, b) => counts[b.file.path]!.area - counts[a.file.path]!.area)[0]!;
    const c = counts[fresh.file.path]!;
    report.push(`fresh ${fresh.file.path}: green ${c.green} red ${c.red} / ${c.area}`);
    expect.soft(c.green + c.red, `green and red on fresh used ${fresh.file.path}`).toBeLessThanOrEqual(Math.max(2, c.area * 0.01));
    expect(byPath.size).toBe(m.stones.length);
    if (process.env.SHOW_COUNTS) console.log(report.join('\n'));
  });
}
