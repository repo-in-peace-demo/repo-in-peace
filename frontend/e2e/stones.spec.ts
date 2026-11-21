import { expect, test, type Page } from './fixtures';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { candleSpots } from '../src/model/candle-placement';
import { RIP_TEXT, engravingBoxes, engravingFor } from '../src/model/engraving';
import { buildSceneModel } from '../src/model/scene-model';
import { STONE_D, STONE_W } from '../src/model/layout-constants';
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

type Kind = 'green' | 'red' | 'magenta' | 'yellow' | 'pink';

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
        if (what === 'pink' && r > 90 && r > g + 40 && b > g + 25) count++; // red with blue in it: pink to purple
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

/**
 * Follow-ups to task 25: the engraving reads up close on a fresh, a stale, an ancient and an unused stone, and only the letters differ
 * from the stone. The box of the name (and of RIP) is projected from the model. In it the carved letters are the lightest pixels (the
 * 95th percentile of the brightness stands clear of the median) and carry no moss green or crack red. Outside the letters the box is
 * the stone around it: the median brightness of the box without its letters, of a thin strip just inside each edge, and of the
 * stone just outside it (above and below) agree, so there is no band, no edge line and no lighter box.
 */
type ScreenBox = { x0: number; x1: number; y0: number; y1: number };

async function projectBox(page: Page, box: { x: number; y: number; w: number; h: number }, x: number, z: number): Promise<ScreenBox> {
  const front = z + STONE_D / 2;
  const a = await page.evaluate(([px, py, pz]) => window.repoInPeace!.projectPoint(px!, py!, pz!), [x + box.x - box.w / 2, box.y + box.h / 2, front]);
  const b = await page.evaluate(([px, py, pz]) => window.repoInPeace!.projectPoint(px!, py!, pz!), [x + box.x + box.w / 2, box.y - box.h / 2, front]);
  if (!a || !b) throw new Error('the box is not on screen');
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
}

type BandStats = { area: number; median: number; p95: number; letterGreen: number; letterRed: number; letters: number; plain: number; inTop: number; inBottom: number; above: number; below: number };

/** The numbers above, for each box, from one screenshot. `strip` is how many pixels the edge strips and the outside strips are. */
async function bandStats(page: Page, boxes: readonly ScreenBox[], strip: number): Promise<BandStats[]> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, boxes, strip }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      const px = (x: number, y: number) => {
        const i = (Math.min(canvas.height - 1, Math.max(0, y)) * canvas.width + Math.min(canvas.width - 1, Math.max(0, x))) * 4;
        return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!] as const;
      };
      const lumOf = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const median = (v: number[]) => (v.length === 0 ? NaN : [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)]!);
      const rows = (x0: number, x1: number, y0: number, y1: number) => {
        const out: number[] = [];
        for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) out.push(lumOf(px(x, y)));
        return out;
      };
      return boxes.map((b) => {
        // The middle 80% across, so the stone's own edges are not counted.
        const inset = (b.x1 - b.x0) * 0.1;
        const [x0, x1] = [b.x0 + inset, b.x1 - inset];
        const all: Array<{ l: number; c: readonly [number, number, number] }> = [];
        for (let y = Math.round(b.y0); y < Math.round(b.y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) {
          const c = px(x, y);
          all.push({ l: lumOf(c), c });
        }
        const lums = all.map((p) => p.l).sort((p, q) => p - q);
        const at = (share: number) => lums[Math.min(lums.length - 1, Math.floor(share * lums.length))]!;
        const cut = at(0.92);
        const letters = all.filter((p) => p.l >= cut);
        const letterGreen = letters.filter(({ c: [r, g, bl] }) => g > r + 12 && g > bl + 12 && g > 50).length;
        const letterRed = letters.filter(({ c: [r, g, bl] }) => r > g + 40 && r > bl + 30 && r > 80).length;
        const plainCut = at(0.7);
        return {
          area: all.length,
          median: at(0.5),
          p95: at(0.95),
          letterGreen,
          letterRed,
          letters: letters.length,
          plain: median(all.filter((p) => p.l < plainCut).map((p) => p.l)),
          inTop: median(rows(x0, x1, b.y0, b.y0 + strip).filter((l) => l < plainCut)),
          inBottom: median(rows(x0, x1, b.y1 - strip, b.y1).filter((l) => l < plainCut)),
          above: median(rows(x0, x1, b.y0 - strip, b.y0)),
          below: median(rows(x0, x1, b.y1, b.y1 + strip)),
        };
      });
    },
    { data: png, boxes, strip },
  );
}

const staleUsed = model.stones.find((s) => s.file.decayState === 'stale' && !s.file.unused && s.layout.height > 1.2) ?? mossy;
/** Brightness levels (0 to 255) the stone may vary by between the band and the stone around it: noise, moss and the light. */
const BAND_TOLERANCE = 14;

for (const [label, stone] of [
  ['fresh used', freshUsed],
  ['stale used', staleUsed],
  ['ancient and overgrown', mossy],
  ['unused', freshUnused],
  ['ancient and unused', ancientUnused],
] as const) {
  test(`the engraving reads up close on a stone that is ${label}: pale letters, no moss or glow on them, no band round them`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1200);
    const { x, z, height } = stone.layout;
    await page.evaluate((p) => window.repoInPeace!.setPose(p), { position: { x, y: height * 0.75 + 0.6, z: z + 2.1 }, target: { x, y: height * 0.7, z } });
    await page.waitForTimeout(600);
    await page.mouse.move(640, 5);
    await page.waitForTimeout(300);
    const { name, rip } = engravingBoxes(height);
    const boxes = [['name', name], ...(stone.file.unused ? [['RIP', rip] as const] : [])] as const;
    const screen = await Promise.all(boxes.map(([, box]) => projectBox(page, box, x, z)));
    const stats = await bandStats(page, screen, 3);
    boxes.forEach(([what], i) => {
      const st = stats[i]!;
      const where = `${what} on ${stone.file.path}`;
      expect(st.p95 - st.median, `${where}: letters should be lighter than the face (median ${st.median}, p95 ${st.p95})`).toBeGreaterThanOrEqual(20);
      expect(st.letterGreen, `${where}: moss green on the letters`).toBeLessThanOrEqual(st.letters * 0.05);
      expect(st.letterRed, `${where}: crack red on the letters`).toBeLessThanOrEqual(st.letters * 0.05);
      const around = (st.above + st.below) / 2;
      const report = JSON.stringify(st);
      expect(Math.abs(st.plain - around), `${where}: the box without its letters should be the stone around it ${report}`).toBeLessThanOrEqual(BAND_TOLERANCE);
      expect(Math.abs(st.inTop - st.above), `${where}: an edge line along the top of the box ${report}`).toBeLessThanOrEqual(BAND_TOLERANCE);
      expect(Math.abs(st.inBottom - st.below), `${where}: an edge line along the bottom of the box ${report}`).toBeLessThanOrEqual(BAND_TOLERANCE);
    });
  });
}

test('from the default view of oikos_ledger, no unused stone shows a box round its RIP: the box is the stone around it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.mouse.move(640, 5);
  const unusedStones = model.stones.filter((s) => s.file.unused && !(KNOWN_HIDDEN['demo.oikosledger'] ?? []).includes(s.file.path));
  const screen: ScreenBox[] = [];
  const which: string[] = [];
  for (const s of unusedStones) {
    const b = await projectBox(page, engravingBoxes(s.layout.height).rip, s.layout.x, s.layout.z).catch(() => null);
    // Only boxes at least 5 pixels tall: anything smaller is a pixel or two, too few to tell a box from the stone.
    if (b && b.y1 - b.y0 >= 5) {
      screen.push(b);
      which.push(s.file.path);
    }
  }
  const stats = await bandStats(page, screen, 2);
  stats.forEach((st, i) => {
    const around = (st.above + st.below) / 2;
    // The median of the whole box (letters too, as far away the letters have faded to stone).
    expect(Math.abs(st.median - around), `RIP box on ${which[i]} from the default view ${JSON.stringify(st)}`).toBeLessThanOrEqual(BAND_TOLERANCE);
  });
});

/** The least yellow (lit candle) pixels round each candle from the default view. A guess to be set from the tuned look (task 25.3 fixes). */
const CANDLE_MIN_YELLOW = 6;

test('from the default view of oikos_ledger every one of the 7 candles shows as a lit spot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.repoInPeace!.setAnimationTime(4)); // the same flicker every run
  await page.mouse.move(640, 5);
  await page.waitForTimeout(300);
  const spots = candleSpots(model.stones);
  expect(spots).toHaveLength(7);
  const report: string[] = [];
  for (const spot of spots) {
    const at = await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [spot.x, CANDLE_HEIGHT + 0.1, spot.z]);
    expect(at, `the candle of ${spot.path} should be in front of the camera`).not.toBeNull();
    const lit = await countPixels(page, 'yellow', at!, 14);
    report.push(`candle ${spot.path}: yellow ${lit}`);
    expect.soft(lit, `yellow pixels round the candle of ${spot.path} from the default view`).toBeGreaterThanOrEqual(CANDLE_MIN_YELLOW);
  }
  if (process.env.SHOW_COUNTS) console.log(report.join('\n'));
});

test('the cracks of a fresh (blue-grey) unused stone glow red-orange, not pink', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const fresh = model.stones.filter((s) => s.file.unused && s.file.decayState === 'fresh');
  expect(fresh.map((s) => s.file.path).sort()).toEqual(['app/components/voice/index.ts', 'app/lib/voice/index.ts']);
  for (const s of fresh) {
    const at = await flyTo(page, s.file.path);
    const red = await countPixels(page, 'red', at, 60);
    const pink = await countPixels(page, 'pink', at, 60);
    expect(red, `red-orange crack pixels on ${s.file.path}`).toBeGreaterThan(20);
    expect(pink, `pink pixels on ${s.file.path} (red ${red})`).toBeLessThanOrEqual(Math.max(3, red * 0.1));
  }
});

test('the selection on a short stone is a thin outline: the stone keeps its own colours (app/lib/db/queries/recommendations.ts)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const path = 'app/lib/db/queries/recommendations.ts';
  const stone = model.stones.find((st) => st.file.path === path)!;
  await page.evaluate((p) => window.repoInPeace!.flyTo(p), path);
  await page.waitForTimeout(1700);
  await page.mouse.move(640, 700);
  // The upper part of the stone on screen (the ring at its foot is magenta too, and is the main sign of the selection).
  const { x, z, height } = stone.layout;
  const corners = await page.evaluate(
    ([x, z, h]) => [[x! - 0.7, h!, z! + 0.25], [x! + 0.7, h!, z! + 0.25], [x! - 0.7, h! * 0.35, z! + 0.25], [x! + 0.7, h! * 0.35, z! + 0.25]].map(([a, b, c]) => window.repoInPeace!.projectPoint(a!, b!, c!)),
    [x, z, height],
  );
  const xs = corners.map((c) => c!.x);
  const ys = corners.map((c) => c!.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  // The middle of the face: half its width and height round its centre, well inside any outline.
  const inner = Math.round(Math.min(x1 - x0, y1 - y0) / 4);
  const whole = Math.round(Math.max(x1 - x0, y1 - y0) / 2) + 6;
  expect(await countPixels(page, 'magenta', centre, whole), 'no magenta before it is selected').toBe(0);
  await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), path);
  await page.waitForTimeout(600);
  const middle = await countPixels(page, 'magenta', centre, inner);
  const all = await countPixels(page, 'magenta', centre, whole);
  // For a look by eye: test-results/screenshots/selected-short-stone.png.
  mkdirSync(fileURLToPath(new URL('../test-results/screenshots/', import.meta.url)), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/screenshots/selected-short-stone.png', import.meta.url)), clip: { x: Math.max(0, centre.x - whole - 40), y: Math.max(0, centre.y - whole - 40), width: 2 * whole + 80, height: 2 * whole + 80 } });
  expect(middle, `magenta in the middle of the face (${(2 * inner) ** 2} pixels)`).toBeLessThanOrEqual(Math.ceil((2 * inner) ** 2 * 0.01));
  expect(all, 'an outline is drawn').toBeGreaterThan(20);
  // The ring at the foot never crosses the face: no magenta on the lower part of the face (where the name is), inside the outline.
  const foot = await page.evaluate(([x, z, h]) => [window.repoInPeace!.projectPoint(x! - 0.7, 0.02, z! + 0.25), window.repoInPeace!.projectPoint(x! + 0.7, h! * 0.5, z! + 0.25)], [x, z, height]);
  const [fx0, fx1] = [Math.min(foot[0]!.x, foot[1]!.x) + 4, Math.max(foot[0]!.x, foot[1]!.x) - 4];
  const [fy0, fy1] = [Math.min(foot[0]!.y, foot[1]!.y) + 4, Math.max(foot[0]!.y, foot[1]!.y) - 4];
  const lowerHalf = Math.floor(Math.min(fx1 - fx0, fy1 - fy0) / 2);
  expect(await countPixels(page, 'magenta', { x: (fx0 + fx1) / 2, y: (fy0 + fy1) / 2 }, lowerHalf), 'the ring over the lower face').toBeLessThanOrEqual(2);
});
