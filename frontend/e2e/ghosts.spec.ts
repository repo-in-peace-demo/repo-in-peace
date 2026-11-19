import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { ghostBaseHeight } from '../src/model/ghost-motion';
import { GHOST_EYES, ghostRadiusAt, ghostTagPlacement, tipCurl } from '../src/model/ghost-shape';
import { RING_LIFT } from '../src/model/selection-ring';
import { buildSceneModel } from '../src/model/scene-model';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT } from '../src/model/visual-constants';

/**
 * Smoke test of the ghosts in the real app, on spatialql (two ghosts): they are pale cyan, they float clearly above the
 * ground with a gap under them, they can be seen from the default view, and the selection ring follows their bob.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const model = buildSceneModel(JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard);
const ghosts = model.ghosts;
const first = ghosts[0]!;

type Clip = { x: number; y: number; width: number; height: number };

/** Pixels in `clip` that are pale cyan (little red, a lot of green and blue): the colour of a ghost and of nothing else in the scene. */
async function countCyan(page: Page, clip: Clip): Promise<number> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
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
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 1]! > 90 && rgba[i + 1]! > rgba[i]! + 40 && rgba[i + 2]! > rgba[i]! + 40) count++;
    return count;
  }, png);
}

/** Where the middle of the pink selection ring is, from the pixels in `clip` outside the middle `skip` pixels; null if none. */
async function ringCentreY(page: Page, clip: Clip, skip: number): Promise<number | null> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, top, skipMiddle }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const pixel = i / 4;
        if (Math.abs((pixel % canvas.width) - canvas.width / 2) < skipMiddle) continue;
        const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
        if (r > 170 && b > 120 && g < r - 60 && g < b - 30) {
          sum += Math.floor(pixel / canvas.width);
          count++;
        }
      }
      return count === 0 ? null : top + sum / count;
    },
    { data: png, top: clip.y, skipMiddle: skip },
  );
}

/** The leftmost and rightmost bright cyan pixels of `clip` on the page, or null if there are none. */
async function brightCyanExtentX(page: Page, clip: Clip): Promise<{ left: number; right: number } | null> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, leftEdge }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = Infinity;
      let right = -Infinity;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 1]! > 150 && rgba[i + 1]! > rgba[i]! + 60 && rgba[i + 2]! > rgba[i]! + 60) {
          const x = (i / 4) % canvas.width;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      return right < 0 ? null : { left: leftEdge + left, right: leftEdge + right };
    },
    { data: png, leftEdge: clip.x },
  );
}

/** The lowest cyan pixel of `clip` on the page (the largest y), or null if there are none. */
async function cyanLowestY(page: Page, clip: Clip): Promise<number | null> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, top }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let lowest = -1;
      for (let i = 0; i < rgba.length; i += 4) {
        // Bright cyan only: the faint glow pool on the ground is cyan too, but much dimmer than the figure and its hem.
        if (rgba[i + 1]! > 150 && rgba[i + 1]! > rgba[i]! + 60 && rgba[i + 2]! > rgba[i]! + 60) lowest = Math.max(lowest, Math.floor(i / 4 / canvas.width));
      }
      return lowest < 0 ? null : top + lowest;
    },
    { data: png, top: clip.y },
  );
}

/** The vertical middle of the cyan pixels of `clip` on the page, or null if there are none. */
async function cyanCentreY(page: Page, clip: Clip): Promise<number | null> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, top }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 1]! > 90 && rgba[i + 1]! > rgba[i]! + 40 && rgba[i + 2]! > rgba[i]! + 40) {
          sum += Math.floor(i / 4 / canvas.width);
          count++;
        }
      }
      return count === 0 ? null : top + sum / count;
    },
    { data: png, top: clip.y },
  );
}

/** The average colour of the pixels in `clip`, each channel from 0 to 255. */
async function averageColour(page: Page, clip: Clip): Promise<{ r: number; g: number; b: number }> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
    const sum = [0, 0, 0];
    for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += rgba[i + c]!;
    const n = rgba.length / 4;
    return { r: sum[0]! / n, g: sum[1]! / n, b: sum[2]! / n };
  }, png);
}

const project = (page: Page, x: number, y: number, z: number) => page.evaluate(([a, b, c]) => window.repoInPeace!.projectPoint(a!, b!, c!), [x, y, z]);

test.describe('ghosts, in the real app', () => {
  const problems: string[] = [];

  test.beforeEach(async ({ page }) => {
    problems.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error' || (message.type() === 'warning' && /THREE\.WebGL|shader|GLSL|program/i.test(message.text()))) problems.push(`${message.type()}: ${message.text().slice(0, 300)}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.spatialql');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1000);
    await page.mouse.move(640, 20);
  });

  test('both ghosts are pale cyan and can be seen from the default view, and the shader compiles', async ({ page }) => {
    for (const ghost of ghosts) {
      const at = (await project(page, ghost.layout.x, ghostBaseHeight(ghost.visual, 0) + GHOST_HEIGHT / 2, ghost.layout.z))!;
      const cyan = await countCyan(page, { x: Math.round(at.x) - 25, y: Math.round(at.y) - 25, width: 50, height: 50 });
      expect(cyan, `cyan pixels around ${ghost.ghost.path} in the default view`).toBeGreaterThan(8);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('a ghost floats well above the ground: its body is cyan and the gap under it is not', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const { x, z } = first.layout;
    const low = ghostBaseHeight(first.visual, 0);
    const bodyAt = (await project(page, x, low + GHOST_HEIGHT * 0.65, z))!;
    // The sheet is translucent, so its colour is a cyan tint on what is behind it: green and blue clearly above red.
    const body = await averageColour(page, { x: Math.round(bodyAt.x) - 7, y: Math.round(bodyAt.y) - 7, width: 14, height: 14 });
    expect(body.g - body.r, `the body of the ghost should be tinted cyan (average ${JSON.stringify(body)})`).toBeGreaterThan(28);
    expect(body.b - body.r).toBeGreaterThan(28);

    // The gap: the lowest visible part of the ghost is clearly above the ground, not standing on it. The figure fades out toward its
    // bottom, so look for where the cyan stops, and compare with the screen height of a point half a unit above the ground.
    const halfUnit = (await project(page, x, 0.35, z))!;
    const ground = (await project(page, x, 0.05, z))!;
    const top = (await project(page, x, low + GHOST_HEIGHT, z))!;
    expect(ground.y - halfUnit.y, '0.3 of a unit should be tall enough on the screen to look at').toBeGreaterThan(10);
    const lowest = await cyanLowestY(page, { x: Math.round(bodyAt.x) - 50, y: Math.max(0, Math.round(top.y) - 20), width: 100, height: Math.round(ground.y - top.y) + 40 });
    expect(lowest, 'no cyan ghost found').not.toBeNull();
    expect(lowest!, `the lowest bright cyan pixel (y ${lowest}) should be above the point 0.35 off the ground (y ${halfUnit.y.toFixed(0)}); the ground is at y ${ground.y.toFixed(0)}`).toBeLessThan(halfUnit.y);
  });

  test('the ghost bobs, and the selection ring goes up and down with it, every frame', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(([p]) => window.repoInPeace!.select({ kind: 'ghost', path: p! }), [first.ghost.path]);
    await page.mouse.move(640, 20);

    const { floatSpeed, phase } = first.visual;
    const high = (Math.PI / 2 - phase) / floatSpeed + (2 * Math.PI) / floatSpeed; // at the top of its bob
    const low = high + Math.PI / floatSpeed; // at the bottom of it
    const centres: number[] = [];
    const expected: number[] = [];
    const bodies: number[] = [];
    for (const t of [high, low]) {
      await page.evaluate((seconds) => window.repoInPeace!.setAnimationTime(seconds), t);
      await page.waitForTimeout(500);
      const base = (await project(page, first.layout.x, ghostBaseHeight(first.visual, t) + RING_LIFT, first.layout.z))!;
      const y = await ringCentreY(page, { x: Math.max(0, Math.round(base.x) - 200), y: Math.max(0, Math.round(base.y) - 150), width: 400, height: 300 }, 45);
      expect(y, `no pink ring found at time ${t.toFixed(2)}`).not.toBeNull();
      centres.push(y!);
      expected.push(base.y);
      // The drawn ghost itself: the middle of its cyan, in a window that holds the whole figure and not the ring.
      const top = (await project(page, first.layout.x, ghostBaseHeight(first.visual, t) + GHOST_HEIGHT, first.layout.z))!;
      const body = await cyanCentreY(page, { x: Math.round(top.x) - 40, y: Math.max(0, Math.round(top.y) - 20), width: 80, height: Math.max(10, Math.round(base.y - top.y) + 10) });
      expect(body, `no cyan ghost found at time ${t.toFixed(2)}`).not.toBeNull();
      bodies.push(body!);
    }
    expect(bodies[1]! - bodies[0]!, 'the drawn ghost should go down by about as much as the ring when it bobs down').toBeGreaterThan((expected[1]! - expected[0]!) * 0.5);
    expect(bodies[1]! - bodies[0]!).toBeLessThan((expected[1]! - expected[0]!) * 1.6);
    expect(expected[1]! - expected[0]!, 'the bob should move the base on the screen, or this check proves nothing').toBeGreaterThan(6);
    for (let i = 0; i < 2; i++) expect(Math.abs(centres[i]! - expected[i]!), `ring at ${i === 0 ? 'the top' : 'the bottom'} of the bob: ring y ${centres[i]} vs base y ${expected[i]}`).toBeLessThan(9);
    expect(centres[1]! - centres[0]!, 'the ring should go down by about as much as the ghost').toBeGreaterThan((expected[1]! - expected[0]!) * 0.6);
  });

  test('a soft cyan glow pool lies on the ground right under the ghost, and not away from it', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const under = (await project(page, first.layout.x, 0.05, first.layout.z))!;
    const away = (await project(page, first.layout.x + 5, 0.05, first.layout.z))!;
    const green = async (at: { x: number; y: number }) => (await averageColour(page, { x: Math.round(at.x) - 4, y: Math.round(at.y) - 4, width: 8, height: 8 })).g;
    const pool = await green(under);
    const bare = await green(away);
    expect(pool, `the ground under the ghost (green ${pool.toFixed(0)}) should be lit more than ground away from it (${bare.toFixed(0)})`).toBeGreaterThan(bare + 12);
  });

  test('the face has two dark eye holes, darker than the body around them', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const base = ghostBaseHeight(first.visual, 0);
    const front = ghostRadiusAt(GHOST_EYES.left.y);
    const body = (await project(page, first.layout.x, base + 1.15, first.layout.z + ghostRadiusAt(1.15)))!;
    const bodyColour = await averageColour(page, { x: Math.round(body.x) - 2, y: Math.round(body.y) - 2, width: 4, height: 4 });
    for (const eye of [GHOST_EYES.left, GHOST_EYES.right]) {
      const at = (await project(page, first.layout.x + eye.x, base + eye.y, first.layout.z + front))!;
      const colour = await averageColour(page, { x: Math.round(at.x) - 2, y: Math.round(at.y) - 2, width: 4, height: 4 });
      expect(colour.g, `an eye hole (green ${colour.g.toFixed(0)}) should be darker than the body (green ${bodyColour.g.toFixed(0)})`).toBeLessThan(bodyColour.g - 15);
    }
  });

  test('the toe tag shows the file type: the atlas has the text drawn, and the tag glows beside the ghost up close', async ({ page }) => {
    const lit = await page.evaluate(() => window.repoInPeace!.getGhostTagAtlas());
    expect(Object.keys(lit), 'both ghosts of spatialql say .ts').toEqual(['.ts']);
    expect(lit['.ts']!, 'pixels lit by the text .ts in its atlas cell').toBeGreaterThan(150);

    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const { card } = ghostTagPlacement();
    const at = (await project(page, first.layout.x + card.x, ghostBaseHeight(first.visual, 0) + card.y, first.layout.z + card.z))!;
    const near = await countCyan(page, { x: Math.round(at.x) - 22, y: Math.round(at.y) - 14, width: 44, height: 28 });
    expect(near, 'bright cyan pixels on the tag, close up').toBeGreaterThan(80);
  });

  test('with reduced motion nothing moves: the ghost, its tag and the pool are the same a moment later; without it they are not', async ({ browser }) => {
    const look = async (reduced: boolean): Promise<{ same: boolean; flag: boolean }> => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      await page.goto('/?graveyard=demo.spatialql');
      await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
      await page.waitForTimeout(1700);
      await page.mouse.move(640, 20);
      const flag = await page.evaluate(() => window.repoInPeace!.isReducedMotion());
      const clip = { x: 340, y: 120, width: 600, height: 480 };
      const a = await page.screenshot({ clip });
      await page.waitForTimeout(2500);
      const b = await page.screenshot({ clip });
      await context.close();
      return { same: a.equals(b), flag };
    };
    const reduced = await look(true);
    expect(reduced.flag).toBe(true);
    expect(reduced.same, 'with reduced motion the picture should not change').toBe(true);
    const normal = await look(false);
    expect(normal.flag).toBe(false);
    expect(normal.same, 'without reduced motion the ghost bobs and sways, so the picture changes').toBe(false);
  });

  test('the hem is cut like a pair of curly braces: the two tips point down, and between them it curls up', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const base = ghostBaseHeight(first.visual, 0);
    const r = ghostRadiusAt(0.05);
    const s45 = Math.sin(Math.PI / 4);
    const tipR = r + tipCurl(Math.PI / 4, 0.03); // the tips curl outward, so they are a little further out than the body
    // From the front the tips are at 45 degrees to either side of the middle, and the middle of the front is where two braces meet.
    const tipRight = (await project(page, first.layout.x + tipR * s45, base, first.layout.z + tipR * s45))!;
    const tipLeft = (await project(page, first.layout.x - tipR * s45, base, first.layout.z + tipR * s45))!;
    const middle = (await project(page, first.layout.x, base, first.layout.z + r))!;
    const lowestIn = async (at: { x: number; y: number }): Promise<number> => {
      const y = await cyanLowestY(page, { x: Math.round(at.x) - 3, y: Math.round(at.y) - 90, width: 6, height: 130 });
      expect(y, `no bright cyan at x ${at.x.toFixed(0)}`).not.toBeNull();
      return y!;
    };
    const [right, left, between] = [await lowestIn(tipRight), await lowestIn(tipLeft), await lowestIn(middle)];
    expect(right - between, `the right tip (y ${right}) should reach lower on the screen than the middle of the hem (y ${between})`).toBeGreaterThan(8);
    expect(left - between, `the left tip (y ${left}) should reach lower than the middle (y ${between})`).toBeGreaterThan(8);
  });

  test('the two outer tips of the hem curl outward, like the ends of { and }', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), first.ghost.path);
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.repoInPeace!.setAnimationTime(0));
    await page.mouse.move(640, 20);
    await page.waitForTimeout(300);
    const base = ghostBaseHeight(first.visual, 0);
    const r = ghostRadiusAt(0.05);
    const s45 = Math.sin(Math.PI / 4);
    const centre = (await project(page, first.layout.x, base, first.layout.z))!;
    // The rows just above the lowest point: only the tips reach down here, the rest of the hem is higher.
    const top = (await project(page, first.layout.x, base + 0.14, first.layout.z + r * s45))!;
    const bottom = (await project(page, first.layout.x, base + 0.01, first.layout.z + r * s45))!;
    const extent = await brightCyanExtentX(page, { x: Math.round(centre.x) - 120, y: Math.round(top.y), width: 240, height: Math.max(3, Math.round(bottom.y - top.y)) });
    expect(extent, 'no bright cyan in the rows of the tips').not.toBeNull();
    const unitsToPixels = Math.abs((await project(page, first.layout.x + 1, base, first.layout.z))!.x - centre.x);
    const halfWidth = (extent!.right - extent!.left) / 2;
    // The rows hold the tips with their own thickness, so the half width is a few pixels more than the position of the tip's middle.
    // Measured on this scene: about 22 px without the curl and 25 px with it, where the curled tip's middle is at 23 px.
    const curled = (r + tipCurl(Math.PI / 4, 0.03)) * s45 * unitsToPixels;
    expect(halfWidth, `the tips (half width ${halfWidth.toFixed(1)} px) should reach out to the curled position (${curled.toFixed(1)} px) and past it`).toBeGreaterThan(curled + 0.5);
  });
});
