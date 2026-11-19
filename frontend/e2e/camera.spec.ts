import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import type { CameraPose } from '../src/model/camera-pose';
import { boundsRadius, cameraLimits, flySpeed } from '../src/model/fly-controls';
import { buildSceneModel } from '../src/model/scene-model';
import { distance } from '../src/model/vec3';

/**
 * Smoke test: the camera limits are wired to every input of the real app. The limit values and the default pose come
 * from the modules the app uses, worked out from the same data file, not copied here.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);
const limits = cameraLimits(model.layout.bounds);
const start = model.start;
const aFile = graveyard.files[0]!.path;

/** Rounding slack for numbers that went through floating-point maths. */
const EPS = 1e-6;
const { area } = limits;
const left = area.x;
const right = area.x + area.w;
const near = area.z;
const far = area.z + area.d;

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());

async function openApp(page: Page): Promise<void> {
  await page.goto('/?graveyard=demo.spatialql');
  try {
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  } catch {
    const shown = await page.locator('body').innerText();
    throw new Error(`The app did not start (is WebGL available? see e2e/README.md). The page says: ${shown.slice(0, 300)}`);
  }
  await page.waitForTimeout(500); // a few frames
  await page.mouse.move(640, 360);
}

/** Holds the keys down for `ms`, then lets go. */
async function hold(page: Page, keys: string[], ms: number): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function drag(page: Page, from: [number, number], to: [number, number], button: 'left' | 'right'): Promise<void> {
  await page.mouse.move(...from);
  await page.mouse.down({ button });
  await page.mouse.move(...to, { steps: 25 });
  await page.mouse.up({ button });
}

const insideSideways = (p: CameraPose): boolean =>
  p.target.x >= left - EPS && p.target.x <= right + EPS && p.target.z >= near - EPS && p.target.z <= far + EPS;
const atAnEdge = (value: number, low: number, high: number, slack = 1): boolean => Math.abs(value - low) <= slack || Math.abs(value - high) <= slack;

test.describe('camera limits, in the real app', () => {
  test('1. holding Q: the camera comes down to the floor and no lower', async ({ page }) => {
    await openApp(page);
    // Start close to the ground, so five seconds are enough to reach the floor.
    await page.evaluate((path) => window.repoInPeace!.flyTo(path), aFile);
    await page.waitForTimeout(1500);
    await hold(page, ['KeyQ'], 5000);
    const p = await pose(page);
    expect(p.position.y).toBeGreaterThanOrEqual(limits.minCameraHeight - EPS);
    expect(p.target.y).toBeGreaterThanOrEqual(-EPS);
    expect(p.position.y, 'it should have reached the floor').toBeLessThanOrEqual(limits.minCameraHeight + 0.5);
  });

  test('2. holding E (with Shift): the camera stays under the ceiling and the look-at point under the tallest stone', async ({ page }) => {
    await openApp(page);
    // Shift makes the climb three times faster, so fifteen seconds are enough to reach the cap on any graveyard size.
    await hold(page, ['Shift', 'KeyE'], 15_000);
    const p = await pose(page);
    expect(p.position.y).toBeLessThanOrEqual(limits.maxCameraHeight + EPS);
    expect(p.target.y).toBeLessThanOrEqual(limits.maxTargetHeight + EPS);
    expect(p.target.y, 'the look-at point should have reached the tallest stone height').toBeGreaterThanOrEqual(limits.maxTargetHeight - 0.01);
  });

  test('3. holding Shift + right arrow: the look-at point stops at the sideways bound', async ({ page }) => {
    await openApp(page);
    await hold(page, ['Shift', 'ArrowRight'], 15_000);
    const p = await pose(page);
    expect(insideSideways(p), JSON.stringify(p.target)).toBe(true);
    expect(p.target.x, 'it should have reached the right-hand bound').toBeGreaterThanOrEqual(right - 1);
  });

  test('4. dragging far off the graveyard (right-drag, and Shift + left-drag) keeps the look-at point inside, and the next key press does not jump', async ({ page }) => {
    await openApp(page);

    for (let i = 0; i < 6; i++) await drag(page, [1100, 360], [180, 360], 'right'); // sideways
    await page.waitForTimeout(1000);
    let p = await pose(page);
    expect(insideSideways(p), `after sideways right-drags: ${JSON.stringify(p.target)}`).toBe(true);
    expect(atAnEdge(p.target.x, left, right), `x ${p.target.x} should be at an edge`).toBe(true);

    for (let i = 0; i < 6; i++) await drag(page, [640, 640], [640, 80], 'right'); // forward and back
    await page.waitForTimeout(1000);
    p = await pose(page);
    expect(insideSideways(p), `after vertical right-drags: ${JSON.stringify(p.target)}`).toBe(true);
    expect(atAnEdge(p.target.z, near, far), `z ${p.target.z} should be at an edge`).toBe(true);

    await page.keyboard.down('Shift');
    for (let i = 0; i < 6; i++) await drag(page, [180, 200], [1100, 560], 'left'); // Shift + left-drag pans too
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);
    p = await pose(page);
    expect(insideSideways(p), `after Shift + left-drags: ${JSON.stringify(p.target)}`).toBe(true);

    // The next arrow key press moves the view by a normal step, not by a jump back from outside the bounds.
    const before = await pose(page);
    await hold(page, ['ArrowRight'], 100);
    const after = await pose(page);
    const allowed = flySpeed(boundsRadius(model.layout.bounds), false) * 0.75; // 0.1 s of key, plus slow frames
    expect(distance(after.target, before.target), 'look-at point jumped').toBeLessThan(allowed);
    expect(distance(after.position, before.position), 'camera jumped').toBeLessThan(allowed * 1.5);
    expect(insideSideways(after)).toBe(true);
  });

  test('5. orbiting to near-horizontal and zooming fully in keep the camera above the floor', async ({ page }) => {
    await openApp(page);
    for (let i = 0; i < 4; i++) await drag(page, [640, 650], [640, 60], 'left'); // drag up: tilt toward the horizon
    for (let i = 0; i < 200; i++) await page.mouse.wheel(0, -400); // far more than the zoom range needs
    await page.waitForTimeout(1500);
    const p = await pose(page);
    expect(p.position.y).toBeGreaterThanOrEqual(limits.minCameraHeight - EPS);
    expect(distance(p.position, p.target), 'it should be zoomed fully in').toBeLessThan(4);
  });

  test('6. Home returns to the default pose within 2 seconds and clears the selection', async ({ page }) => {
    await openApp(page);
    await page.evaluate((path) => window.repoInPeace!.select({ kind: 'file', path }), aFile);
    await hold(page, ['Shift', 'KeyD'], 3000); // fly away from the start
    const away = await pose(page);
    expect(distance(away.target, start.target), 'it should have moved away first').toBeGreaterThan(5);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).not.toBeNull();

    await page.keyboard.press('Home');
    await expect
      .poll(async () => {
        const p = await pose(page);
        return Math.max(distance(p.position, start.position), distance(p.target, start.target));
      }, { timeout: 2000 })
      .toBeLessThan(0.5);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toBeNull();
  });
});
