import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, type CameraPose } from '../src/model/camera-pose';
import { RING_LIFT } from '../src/model/selection-ring';
import { GHOST_FLOAT_BASE } from '../src/model/visual-constants';
import { pickNearest } from '../src/model/pick';
import { buildSceneModel } from '../src/model/scene-model';
import { distance, normalize, scale, sub, add, vec3, type Vec3 } from '../src/model/vec3';

/**
 * Smoke test of hover, click, drag and Escape in the real app. Where a test needs "the stone under the pointer", it
 * works out what the pointer must be over with `pickNearest` from the layout and the camera's pose, and checks that
 * is the stone it meant, so an occluded stone fails the test with a clear message instead of passing for nothing.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);

const VIEWPORT = { width: 1280, height: 720 };
const EMPTY_GROUND = { x: 640, y: 30 }; // above the graveyard in the starting view, clear of the panels

// The stone nearest the camera in the starting view (largest z, then closest to the middle): nothing is in front of it.
const { x: boundsX, w: boundsW } = model.layout.bounds;
const frontStone = [...model.stones].sort(
  (a, b) => b.layout.z - a.layout.z || Math.abs(a.layout.x - (boundsX + boundsW / 2)) - Math.abs(b.layout.x - (boundsX + boundsW / 2)),
)[0]!.file.path;
const otherStone = [...model.stones].sort((a, b) => a.layout.z - b.layout.z)[0]!.file.path; // far side of the graveyard
const ghostPath = model.ghosts[0]!.ghost.path;

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/');

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());
const selection = (page: Page) => page.evaluate(() => window.repoInPeace!.getSelection());
const select = (page: Page, kind: 'file' | 'ghost', path: string) => page.evaluate(([k, p]) => window.repoInPeace!.select({ kind: k as 'file' | 'ghost', path: p! }), [kind, path]);

async function screenPoint(page: Page, path: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), path);
  expect(point, `${path} should be in front of the camera`).not.toBeNull();
  expect(point!.x > 0 && point!.x < VIEWPORT.width && point!.y > 0 && point!.y < VIEWPORT.height, `${path} should be on screen: ${JSON.stringify(point)}`).toBe(true);
  return point!;
}

/** What the picker should find under a pixel: the same ray as the camera's, tested against the layout's boxes. */
function expectedPick(p: CameraPose, x: number, y: number) {
  const forward = normalize(sub(p.target, p.position));
  const right = normalize(vec3(-forward.z, 0, forward.x)); // forward is never vertical in the views used here
  const up = vec3(right.y * forward.z - right.z * forward.y, right.z * forward.x - right.x * forward.z, right.x * forward.y - right.y * forward.x);
  const tanHalf = Math.tan((DEFAULT_FOV_Y * Math.PI) / 360);
  const ndcX = (x / VIEWPORT.width) * 2 - 1;
  const ndcY = -((y / VIEWPORT.height) * 2 - 1);
  const direction: Vec3 = add(add(forward, scale(right, ndcX * tanHalf * (VIEWPORT.width / VIEWPORT.height))), scale(up, ndcY * tanHalf));
  return pickNearest(model.pickTargets, p.position, direction);
}

const samePose = (a: CameraPose, b: CameraPose): boolean => distance(a.position, b.position) < 1e-3 && distance(a.target, b.target) < 1e-3;

/** Where the middle of the pink selection ring is on the screen, from the pixels in `clip`; `null` if there is none. */
async function ringCentre(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  skipMiddle = 0,
): Promise<{ x: number; y: number; pixels: number } | null> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, left, top, skip }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
        const pixel = i / 4;
        // `skip`: leave out the middle of the window, where the selected object's own rim of light is, so only the ring counts.
        if (Math.abs((pixel % canvas.width) - canvas.width / 2) < skip) continue;
        if (r > 170 && b > 120 && g < r - 60 && g < b - 30) {
          sumX += pixel % canvas.width;
          sumY += Math.floor(pixel / canvas.width);
          count++;
        }
      }
      // The screenshot is in device pixels; the page's units are CSS pixels (the same here: the scale factor is 1).
      return count === 0 ? null : { x: left + sumX / count, y: top + sumY / count, pixels: count };
    },
    { data: png, left: clip.x, top: clip.y, skip: skipMiddle },
  );
}

const project = (page: Page, x: number, y: number, z: number) => page.evaluate(([a, b, c]) => window.repoInPeace!.projectPoint(a!, b!, c!), [x, y, z]);

/** The average colour of the pixels in `clip`, each channel from 0 to 255. */
async function averageColour(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<{ r: number; g: number; b: number }> {
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

async function openApp(page: Page): Promise<void> {
  await page.goto('/?graveyard=demo.spatialql');
  try {
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  } catch {
    throw new Error(`The app did not start (is WebGL available? see e2e/README.md). The page says: ${(await page.locator('body').innerText()).slice(0, 300)}`);
  }
  await page.waitForTimeout(800); // a few frames
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
}

test.describe('hover, click, drag and Escape, in the real app', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await openApp(page);
  });

  test('hovering a stone shows its name and full folder path, and leaving it hides the label', async ({ page }) => {
    const at = await screenPoint(page, frontStone);
    expect(expectedPick(await pose(page), at.x, at.y)?.path, 'the front stone should not be hidden').toBe(frontStone);

    await page.mouse.move(at.x, at.y);
    const label = page.locator('.hover-label');
    await expect(label).toBeVisible();
    await expect(label.locator('.hover-name')).toHaveText(nameOf(frontStone));
    await expect(label.locator('.hover-folder')).toHaveText(folderOf(frontStone));
    await expect(label.locator('.hover-ghost')).toHaveCount(0);

    await page.mouse.move(EMPTY_GROUND.x, EMPTY_GROUND.y);
    await expect(label).toHaveCount(0);
  });

  test('hovering a ghost shows the word "ghost" before its name', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), ghostPath);
    await page.waitForTimeout(1600);
    const at = await screenPoint(page, ghostPath);
    expect(expectedPick(await pose(page), at.x, at.y)?.path, 'the ghost should not be hidden behind a stone').toBe(ghostPath);

    await page.mouse.move(at.x, at.y);
    const label = page.locator('.hover-label');
    await expect(label.locator('.hover-ghost')).toHaveText(/ghost/);
    await expect(label.locator('.hover-name')).toContainText(nameOf(ghostPath));
    await expect(label.locator('.hover-folder')).toHaveText(folderOf(ghostPath));
  });

  test('a click on a stone selects it without moving the camera; a click on empty ground clears it, also without moving the camera', async ({ page }) => {
    const at = await screenPoint(page, frontStone);
    const before = await pose(page);

    await page.mouse.click(at.x, at.y);
    await expect.poll(() => selection(page)).toEqual({ kind: 'file', path: frontStone });

    await page.mouse.click(EMPTY_GROUND.x, EMPTY_GROUND.y);
    await expect.poll(() => selection(page)).toBeNull();

    await page.waitForTimeout(500);
    expect(samePose(before, await pose(page)), 'the camera moved').toBe(true);
  });

  test('Escape clears the selection exactly as an empty-ground click does, without moving the camera', async ({ page }) => {
    await select(page, 'file', frontStone);
    expect(await selection(page)).toEqual({ kind: 'file', path: frontStone });
    const before = await pose(page);

    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    await page.waitForTimeout(500);
    expect(samePose(before, await pose(page)), 'the camera moved').toBe(true);

    // The same from a ghost, and with nothing selected it is harmless.
    await select(page, 'ghost', ghostPath);
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toBeNull();
    await page.keyboard.press('Escape');
    expect(await selection(page)).toBeNull();
  });

  test('a drag never changes the selection: not when it ends over a stone, and not when it starts and ends on one', async ({ page }) => {
    const front = await screenPoint(page, frontStone);
    await select(page, 'file', otherStone);

    // From empty ground to a stone: the old selection stays.
    await drag(page, EMPTY_GROUND, front);
    expect(await selection(page)).toEqual({ kind: 'file', path: otherStone });

    // A drag that starts and ends on a stone does not select it. (The camera orbited, so find the stone again.)
    await page.evaluate(() => window.repoInPeace!.clearSelection());
    await page.evaluate(() => window.repoInPeace!.resetView());
    await page.waitForTimeout(1600);
    const again = await screenPoint(page, frontStone);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x + 80, again.y, { steps: 10 });
    await page.mouse.move(again.x, again.y, { steps: 10 });
    await page.mouse.up();
    expect(await selection(page)).toBeNull();
  });

  test('other mouse buttons do not select or clear', async ({ page }) => {
    const front = await screenPoint(page, frontStone);
    await select(page, 'file', otherStone);
    await page.mouse.click(front.x, front.y, { button: 'right' });
    await page.mouse.click(EMPTY_GROUND.x, EMPTY_GROUND.y, { button: 'right' });
    await page.mouse.click(front.x, front.y, { button: 'middle' });
    expect(await selection(page)).toEqual({ kind: 'file', path: otherStone });
  });

  test('the hover label is hidden while a drag is going on, and comes back with the next move', async ({ page }) => {
    const at = await screenPoint(page, frontStone);
    await page.mouse.move(at.x, at.y);
    const label = page.locator('.hover-label');
    await expect(label).toBeVisible();

    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 10, { steps: 10 });
    await expect(label).toHaveCount(0); // still holding the button: an orbit is going on
    await page.mouse.move(at.x + 120, at.y + 20, { steps: 10 });
    await expect(label).toHaveCount(0);
    await page.mouse.up();
    await expect(label).toHaveCount(0); // the pointer has not moved since

    await page.waitForTimeout(1500); // let the orbit settle, then find the stone again
    const settled = await screenPoint(page, frontStone);
    await page.mouse.move(settled.x - 5, settled.y - 5);
    await page.mouse.move(settled.x, settled.y);
    await expect(label).toBeVisible();
  });

  test('a selection made from outside the scene shows the ring, and clearing it puts the look back exactly', async ({ page }) => {
    const at = await screenPoint(page, frontStone);
    await page.mouse.move(EMPTY_GROUND.x, EMPTY_GROUND.y);
    await page.waitForTimeout(300);
    const clip = { x: Math.round(at.x) - 50, y: Math.round(at.y) - 50, width: 100, height: 100 };

    const plain = await page.screenshot({ clip });
    await select(page, 'file', frontStone);
    await page.waitForTimeout(600);
    const selected = await page.screenshot({ clip });
    expect(selected.equals(plain), 'the ring should show around the stone when it is selected').toBe(false);

    await page.evaluate(() => window.repoInPeace!.clearSelection());
    await page.waitForTimeout(600);
    const cleared = await page.screenshot({ clip });
    expect(cleared.equals(plain), 'clearing the selection should restore the look exactly').toBe(true);
  });

  test('a selected stone is not lightened or tinted: only the ring around its base marks it', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), frontStone);
    await page.waitForTimeout(1600);
    const at = await screenPoint(page, frontStone);
    await page.mouse.move(EMPTY_GROUND.x, EMPTY_GROUND.y);
    await page.waitForTimeout(300);
    const body = { x: Math.round(at.x) - 3, y: Math.round(at.y) - 3, width: 6, height: 6 }; // the middle of the stone's body
    const before = await averageColour(page, body);
    await select(page, 'file', frontStone);
    await page.waitForTimeout(600);
    const after = await averageColour(page, body);
    // The stone's edge glows (a rim of light), but its surface is not lightened or tinted: a lightened stone would be
    // tens of levels brighter in the middle, and this is the middle. A few levels are the rim's glow reaching inwards.
    const change = Math.max(Math.abs(after.r - before.r), Math.abs(after.g - before.g), Math.abs(after.b - before.b));
    expect(change, `the stone body changed colour when selected: ${JSON.stringify(before)} to ${JSON.stringify(after)}`).toBeLessThan(18);
    expect(after.r + after.g + after.b - (before.r + before.g + before.b), 'the stone body got lighter when selected').toBeLessThan(30);

    // And the ring is on the ground at its foot.
    const stone = model.stones.find((s) => s.file.path === frontStone)!.layout;
    const foot = (await project(page, stone.x, RING_LIFT, stone.z))!;
    const ring = await ringCentre(page, { x: Math.max(0, Math.round(foot.x) - 150), y: Math.max(0, Math.round(foot.y) - 150), width: 300, height: 300 }, 45);
    expect(ring, 'no pink ring found around the stone').not.toBeNull();
    expect(Math.hypot(ring!.x - foot.x, ring!.y - foot.y), `ring centre ${JSON.stringify(ring)} vs foot ${JSON.stringify(foot)}`).toBeLessThan(15);
  });

  test('the ring of a selected ghost is around its base at its float height, not on the ground below it', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), ghostPath);
    await page.waitForTimeout(1600);
    await page.mouse.move(EMPTY_GROUND.x, EMPTY_GROUND.y);
    const ghost = model.ghosts.find((g) => g.ghost.path === ghostPath)!.layout;
    const atBase = (await project(page, ghost.x, GHOST_FLOAT_BASE + RING_LIFT, ghost.z))!;
    const onGround = (await project(page, ghost.x, RING_LIFT, ghost.z))!;
    expect(Math.abs(atBase.y - onGround.y), 'the base and the ground point should be apart on screen, or this check proves nothing').toBeGreaterThan(15);

    await select(page, 'ghost', ghostPath);
    await page.waitForTimeout(600);
    const ring = await ringCentre(page, {
      x: Math.max(0, Math.round(atBase.x) - 200),
      y: Math.max(0, Math.round(atBase.y) - 200),
      width: 400,
      height: Math.min(400, VIEWPORT.height - Math.max(0, Math.round(atBase.y) - 200)),
    }, 45);
    expect(ring, 'no pink ring found around the ghost').not.toBeNull();
    const toBase = Math.hypot(ring!.x - atBase.x, ring!.y - atBase.y);
    const toGround = Math.hypot(ring!.x - onGround.x, ring!.y - onGround.y);
    expect(toBase, `ring ${JSON.stringify(ring)}, base ${JSON.stringify(atBase)}, ground ${JSON.stringify(onGround)}`).toBeLessThan(toGround);
    expect(toBase).toBeLessThan(15);
  });
});
