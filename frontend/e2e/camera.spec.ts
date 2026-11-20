import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, startPose, type CameraPose } from '../src/model/camera-pose';
import { sceneCameraLimits } from '../src/model/camera-bounds';
import { boundsRadius, flySpeed } from '../src/model/fly-controls';
import { buildSceneModel } from '../src/model/scene-model';
import { NAME_NEAR } from '../src/model/engraving';
import { distance } from '../src/model/vec3';

/**
 * Smoke test: the camera limits are wired to every input of the real app. The limit values and the default pose come
 * from the modules the app uses, worked out from the same data file, not copied here.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);
// The app's limits for the playwright.config.ts viewport, 1280 by 720: the graveyard's, inside the trees around it.
const limits = sceneCameraLimits(model.layout.bounds, 1280 / 720);
// The default pose is the establishing shot for the window's shape: the viewport of playwright.config.ts, 1280 by 720.
const start = startPose(model.layout.bounds, DEFAULT_FOV_Y, 1280 / 720);
const aFile = graveyard.files[0]!.path;

/** Rounding slack for numbers that went through floating-point maths. */
const EPS = 1e-6;
const { area } = limits;
const left = area.x;
const right = area.x + area.w;
const near = Math.max(area.z, limits.minZ ?? -Infinity); // the back edge: the line in front of the trees behind the back fence
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
/** The camera is stopped by the scene's limits around the trees: at the edge of the circle, or at the line in front of the back trees. */
const cameraAtTreeLimit = (p: CameraPose, slack = 1): boolean => {
  const k = limits.keepInside!;
  return Math.abs(Math.hypot(p.position.x - k.x, p.position.z - k.z) - k.radius) <= slack || Math.abs(p.position.z - limits.minZ!) <= slack;
};

test.describe('camera limits, in the real app', () => {
  test('1. holding Q: the camera comes down as far as the limits let it, to the floor or the tilt limit, and no lower', async ({ page }) => {
    await openApp(page);
    // Start close to the ground, so five seconds are enough to come all the way down.
    await page.evaluate((path) => window.repoInPeace!.flyTo(path), aFile);
    await page.waitForTimeout(1500);
    await hold(page, ['KeyQ'], 5000);
    const p = await pose(page);
    expect(p.position.y).toBeGreaterThanOrEqual(limits.minCameraHeight - EPS);
    expect(p.target.y).toBeGreaterThanOrEqual(-EPS);
    // The lowest the camera may be here: the floor, or MIN_TILT_DEG above the horizontal seen from the look-at point, whichever is higher.
    const along = Math.hypot(p.position.x - p.target.x, p.position.z - p.target.z);
    const tiltFloor = p.target.y + along * Math.tan((limits.minTiltDeg * Math.PI) / 180);
    expect(p.position.y, 'it should not be below the tilt limit').toBeGreaterThanOrEqual(tiltFloor - 1e-3);
    expect(p.position.y, 'it should have come down to the floor or the tilt limit').toBeLessThanOrEqual(Math.max(limits.minCameraHeight, tiltFloor) + 0.5);
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
    expect(atAnEdge(p.target.x, left, right) || cameraAtTreeLimit(p), `x ${p.target.x} should be at an edge, or the camera ${JSON.stringify(p.position)} at the limit inside the trees`).toBe(true);

    for (let i = 0; i < 6; i++) await drag(page, [640, 640], [640, 80], 'right'); // forward and back
    await page.waitForTimeout(1000);
    p = await pose(page);
    expect(insideSideways(p), `after vertical right-drags: ${JSON.stringify(p.target)}`).toBe(true);
    expect(atAnEdge(p.target.z, near, far) || cameraAtTreeLimit(p), `z ${p.target.z} should be at an edge, or the camera ${JSON.stringify(p.position)} at the limit inside the trees`).toBe(true);

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
    // Zooming toward the pointer moves the look-at point with the camera, so the distance between them says nothing about how far in it is:
    // the camera must have come well in from the opening shot, to the floor or the limits.
    expect(distance(p.position, start.position), 'it should have come in from the opening shot').toBeGreaterThan(5);
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

  test('7. orbiting round as far as the mouse goes, both ways, stops within 50 degrees of the opening direction: never round to the sides or back', async ({ page }) => {
    await openApp(page);
    const offFront = (p: CameraPose): number => {
      const k = limits.azimuth!;
      const d = Math.atan2(p.position.x - p.target.x, p.position.z - p.target.z) - Math.atan2(k.x, k.z);
      return Math.abs((Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI);
    };
    expect(limits.azimuth!.maxDeg).toBe(50);
    for (const [label, to] of [['right', 1250], ['left', 30]] as const) {
      for (let i = 0; i < 4; i++) await drag(page, [640, 360], [to, 360], 'left'); // a long orbit, four times over
      await page.waitForTimeout(700);
      const p = await pose(page);
      expect(offFront(p), `orbited to the ${label}: ${JSON.stringify(p)}`).toBeLessThanOrEqual(50 + 0.5);
      expect(offFront(p), `orbited to the ${label}: it should have reached the limit`).toBeGreaterThan(45);
      // And flying from there keeps it inside too.
      await hold(page, ['Shift', 'KeyS'], 1500);
      expect(offFront(await pose(page)), `flown back after orbiting to the ${label}`).toBeLessThanOrEqual(50 + 0.5);
    }
  });

  /** The front-row stone (nearest the opening camera) whose middle is well inside the window at the start. */
  async function frontStoneOnScreen(page: Page): Promise<{ path: string; x: number; y: number; z: number; at: { x: number; y: number } }> {
    const rows = [...model.stones].sort((a, b) => b.layout.z - a.layout.z);
    for (const s of rows) {
      const at = await page.evaluate((path) => window.repoInPeace!.getScreenPoint(path), s.file.path);
      if (at && at.x > 160 && at.x < 1120 && at.y > 120 && at.y < 600) return { path: s.file.path, x: s.layout.x, y: s.layout.height / 2, z: s.layout.z, at };
    }
    throw new Error('no front-row stone is on screen at the start');
  }

  test('8. the wheel zooms toward the pointer: a front-row stone comes within reading distance of its name, and the limits still hold', async ({ page }) => {
    await openApp(page);
    const stone = await frontStoneOnScreen(page);
    const away = async (): Promise<number> => {
      const p = await pose(page);
      return distance(p.position, { x: stone.x, y: stone.y, z: stone.z });
    };
    const before = await away();
    expect(before, 'the stone starts out of reading distance').toBeGreaterThan(NAME_NEAR);
    let at = stone.at;
    for (let i = 0; i < 60 && (await away()) >= NAME_NEAR - 1; i++) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(80);
      at = (await page.evaluate((path) => window.repoInPeace!.getScreenPoint(path), stone.path)) ?? at;
    }
    await page.waitForTimeout(500);
    expect(await away(), 'zooming toward the stone should bring it within the distance its name is readable from').toBeLessThan(NAME_NEAR);
    // Every limit still applies: the pose is where `clampPose` would leave it.
    const p = await pose(page);
    expect(p.position.y).toBeGreaterThanOrEqual(limits.minCameraHeight - EPS);
    expect(insideSideways(p), JSON.stringify(p.target)).toBe(true);
  });

  test('9. a double-click on a stone flies to it, selects it and stops within reading distance', async ({ page }) => {
    await openApp(page);
    const stone = await frontStoneOnScreen(page);
    await page.mouse.dblclick(stone.at.x, stone.at.y);
    await expect
      .poll(async () => {
        const p = await pose(page);
        return distance(p.target, { x: stone.x, y: stone.y, z: stone.z });
      }, { timeout: 4000 })
      .toBeLessThan(3);
    const p = await pose(page);
    expect(distance(p.position, { x: stone.x, y: stone.y, z: stone.z })).toBeLessThan(NAME_NEAR);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toMatchObject({ path: stone.path });
  });

  test('10. a double-click on a stone, then on the sky: back to the default pose, as Reset view, with the selection cleared', async ({ page }) => {
    await openApp(page);
    const stone = await frontStoneOnScreen(page);
    await page.mouse.dblclick(stone.at.x, stone.at.y);
    await page.waitForTimeout(1800);
    const there = await pose(page);
    expect(distance(there.position, start.position), 'the first double-click should have flown to the stone').toBeGreaterThan(5);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toMatchObject({ path: stone.path });

    await page.mouse.dblclick(640, 8); // the sky
    await expect
      .poll(async () => {
        const p = await pose(page);
        return Math.max(distance(p.position, start.position), distance(p.target, start.target));
      }, { timeout: 3000 })
      .toBeLessThan(0.5);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toBeNull();
  });
});
