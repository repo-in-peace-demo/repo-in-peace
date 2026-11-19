import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, type CameraPose } from '../src/model/camera-pose';
import { buildSceneModel } from '../src/model/scene-model';
import { SIGN_MAX_VISIBLE, visibleSigns } from '../src/model/signs';
import { sub } from '../src/model/vec3';

/**
 * Smoke test of the folder signs in the real app: the elements on the page are exactly the signs that `visibleSigns`
 * gives for the camera's pose, in the same order and with the same opacity; the pool of elements never changes; and
 * nothing is worked out while the camera is still.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);
const VIEWPORT = { width: 1280, height: 720 };
// A stone of the small folder `src/data` in its front row and nearest the middle, so that flying to it puts the folder's
// own sign (at the middle of the front fence) in view.
const dataPlot = model.layout.plots.find((p) => p.path === 'src/data')!;
const deepFile = model.stones
  .filter((s) => s.layout.folder === 'src/data')
  .sort((a, b) => b.layout.z - a.layout.z || Math.abs(a.layout.x - dataPlot.sign.x) - Math.abs(b.layout.x - dataPlot.sign.x))[0]!.file.path;

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());

/** What the page shows: the visible sign elements, in the order of the page, with their text and opacity. */
const shown = (page: Page): Promise<Array<{ text: string; opacity: number }>> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.signs .sign'))
      .filter((element) => element.style.display === 'block')
      .map((element) => ({ text: element.textContent ?? '', opacity: Number.parseFloat(element.style.opacity) })),
  );

/** What the page should show for a camera pose, from the same pure function the app uses. */
function expectedFor(p: CameraPose): Array<{ text: string; opacity: number }> {
  return visibleSigns(model.signSources, { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, aspect: VIEWPORT.width / VIEWPORT.height }).map((s) => ({
    text: s.label,
    opacity: s.opacity,
  }));
}

/** Waits until the camera is still, then checks the page against the pose. */
async function expectPageMatchesCamera(page: Page): Promise<Array<{ text: string; opacity: number }>> {
  await page.waitForTimeout(1600);
  const p = await pose(page);
  const expected = expectedFor(p);
  await expect
    .poll(async () => (await shown(page)).map((s) => s.text), { message: 'the signs on the page should be the signs for the camera, nearest first' })
    .toEqual(expected.map((s) => s.text));
  const actual = await shown(page);
  actual.forEach((s, i) => expect(Math.abs(s.opacity - expected[i]!.opacity), `opacity of "${s.text}"`).toBeLessThanOrEqual(0.02));
  return actual;
}

const updates = (page: Page): Promise<number> => page.evaluate(() => Number(document.querySelector<HTMLElement>('.signs')!.dataset.updates ?? '0'));

test.describe('folder signs, in the real app', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/?graveyard=demo.spatialql');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
  });

  test('from the starting view the root sign says the repository name, and the page matches the camera', async ({ page }) => {
    const actual = await expectPageMatchesCamera(page);
    expect(actual.map((s) => s.text), 'the root sign should be readable from the starting view').toContain(graveyard.meta.name);
    expect(actual.length).toBeLessThanOrEqual(SIGN_MAX_VISIBLE);
  });

  test('a sign fades as the camera moves away from it, and the page shows the opacity the pure function gives', async ({ page }) => {
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyS'); // back away from the graveyard
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('Shift');
    const actual = await expectPageMatchesCamera(page);
    expect(actual.length, 'some sign should still show').toBeGreaterThan(0);
    expect(Math.min(...actual.map((s) => s.opacity)), 'a sign should be partly faded here, or this check proves nothing').toBeLessThan(0.95);
  });

  test('flying into a small folder shows its sign, and flying back out takes it away again', async ({ page }) => {
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), deepFile);
    const close = await expectPageMatchesCamera(page);
    expect(close.map((s) => s.text), 'the sign of the folder you are in should show').toContain('data');

    await page.evaluate(() => window.repoInPeace!.resetView());
    const far = await expectPageMatchesCamera(page);
    expect(far.map((s) => s.text), 'a small folder\'s sign should be gone from the overview').not.toContain('data');
  });

  test('the pool is 30 elements that are never created or removed, however the camera moves', async ({ page }) => {
    const count = () => page.locator('.signs .sign').count();
    expect(await count()).toBe(SIGN_MAX_VISIBLE);
    await page.evaluate(() => document.querySelectorAll('.signs .sign').forEach((element, i) => ((element as HTMLElement & { mark?: number }).mark = i)));

    await page.evaluate((p) => window.repoInPeace!.flyTo(p), deepFile);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.repoInPeace!.resetView());
    await page.waitForTimeout(1600);

    expect(await count()).toBe(SIGN_MAX_VISIBLE);
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll('.signs .sign')).map((element) => (element as HTMLElement & { mark?: number }).mark));
    expect(marks).toEqual(Array.from({ length: SIGN_MAX_VISIBLE }, (_, i) => i)); // the same elements, in the same order
  });

  test('nothing is worked out while the camera is still, and it is worked out again when it moves', async ({ page }) => {
    await page.waitForTimeout(1500);
    const idleBefore = await updates(page);
    expect(idleBefore, 'the signs should have been worked out at least once').toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(await updates(page), 'the signs were worked out again with the camera still').toBe(idleBefore);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);
    const afterMove = await updates(page);
    expect(afterMove).toBeGreaterThan(idleBefore);

    await page.waitForTimeout(1500);
    expect(await updates(page), 'the signs were worked out again after the camera stopped').toBe(afterMove);
  });

  test('a sign lets clicks through to the scene', async ({ page }) => {
    await page.waitForTimeout(800);
    const pointerEvents = await page.evaluate(() => getComputedStyle(document.querySelector('.signs .sign')!).pointerEvents);
    expect(pointerEvents).toBe('none'); // inherited from the layer
  });
});
