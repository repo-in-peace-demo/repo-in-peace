import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { ghostBaseHeight } from '../src/model/ghost-motion';
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
        if (rgba[i + 1]! > 70 && rgba[i + 1]! > rgba[i]! + 30 && rgba[i + 2]! > rgba[i]! + 30) lowest = Math.max(lowest, Math.floor(i / 4 / canvas.width));
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
    const body = await countCyan(page, { x: Math.round(bodyAt.x) - 14, y: Math.round(bodyAt.y) - 14, width: 28, height: 28 });
    expect(body, 'cyan pixels in the body of the ghost').toBeGreaterThan(60);

    // The gap: the lowest visible part of the ghost is clearly above the ground, not standing on it. The figure fades out toward its
    // bottom, so look for where the cyan stops, and compare with the screen height of a point half a unit above the ground.
    const halfUnit = (await project(page, x, 0.5, z))!;
    const ground = (await project(page, x, 0.05, z))!;
    const top = (await project(page, x, low + GHOST_HEIGHT, z))!;
    expect(ground.y - halfUnit.y, 'half a unit should be tall enough on the screen to look at').toBeGreaterThan(15);
    const lowest = await cyanLowestY(page, { x: Math.round(bodyAt.x) - 50, y: Math.max(0, Math.round(top.y) - 20), width: 100, height: Math.round(ground.y - top.y) + 40 });
    expect(lowest, 'no cyan ghost found').not.toBeNull();
    expect(lowest!, `the lowest cyan pixel (y ${lowest}) should be above the point half a unit off the ground (y ${halfUnit.y.toFixed(0)}); the ground is at y ${ground.y.toFixed(0)}`).toBeLessThan(halfUnit.y);
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
});
