import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, type CameraPose } from '../src/model/camera-pose';
import { OPENING_DURATION_MS, openingShot, safeEstablishingShot } from '../src/model/framing';
import { buildSceneModel } from '../src/model/scene-model';
import { distance } from '../src/model/vec3';

/**
 * The opening move on first load, in the real app (this spec uses Playwright's own `test`, not `./fixtures`, so the move plays): with
 * no input the camera rises from the opening shot into the establishing shot; any input ends it and leaves the camera where it was
 * (eased into the limits, not carried on); under reduced motion the scene opens on the establishing shot; Reset view goes straight
 * to the establishing shot.
 */

const VIEWPORT = { width: 1280, height: 720 };
const graveyard = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const bounds = buildSceneModel(graveyard).layout.bounds;
const aspect = VIEWPORT.width / VIEWPORT.height;
const from = openingShot(bounds, DEFAULT_FOV_Y, aspect).pose;
const to = safeEstablishingShot(bounds, DEFAULT_FOV_Y, aspect).pose;

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());
const away = (a: CameraPose, b: CameraPose): number => Math.max(distance(a.position, b.position), distance(a.target, b.target));

async function open(page: Page): Promise<number> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  return Date.now();
}

test('with no input the camera rises from the opening shot into the establishing shot, and stops there', async ({ page }) => {
  await open(page);
  const first = await pose(page);
  expect(away(first, to), 'it should not start at the establishing shot').toBeGreaterThan(5);
  // Near the start of the move (the dev handles arrive a little after the first frame; the move is eased, so it is still close).
  expect(distance(first.position, from.position), `it should start near the opening shot ${JSON.stringify(from.position)}`).toBeLessThan(Math.max(4, distance(from.position, to.position) * 0.25));
  expect(first.position.y, 'low, below the establishing camera').toBeLessThan(to.position.y);
  // Moving on its own, toward the establishing shot.
  await page.waitForTimeout(OPENING_DURATION_MS / 2);
  const middle = await pose(page);
  expect(away(middle, to)).toBeLessThan(away(first, to));
  await expect.poll(async () => away(await pose(page), to), { timeout: OPENING_DURATION_MS + 3000 }).toBeLessThan(0.05);
  expect(await page.evaluate(() => window.repoInPeace!.getViewShift())).toBeCloseTo(safeEstablishingShot(bounds, DEFAULT_FOV_Y, aspect).viewShift, 6);
  // And stays.
  const end = await pose(page);
  await page.waitForTimeout(600);
  expect(away(await pose(page), end)).toBeLessThan(1e-6);
});

for (const [label, act] of [
  ['a key', (page: Page) => page.keyboard.press('KeyX')],
  ['a click', (page: Page) => page.mouse.click(640, 120)],
  ['a scroll', (page: Page) => page.mouse.wheel(0, 120)],
] as const) {
  test(`${label} during the opening move ends it: the camera does not carry on to the establishing shot`, async ({ page }) => {
    await open(page);
    await page.mouse.move(640, 120);
    await page.waitForTimeout(900);
    await act(page);
    await page.waitForTimeout(2800); // the hand-over (HANDOVER_MS), and the zoom's damping after a scroll
    const settled = await pose(page);
    await page.waitForTimeout(OPENING_DURATION_MS);
    const later = await pose(page);
    expect(away(later, settled), 'nothing moves the camera after the input').toBeLessThan(0.05);
    expect(away(later, to), 'it stopped short of the establishing shot').toBeGreaterThan(1);
    // Handed over inside the camera's limits: at least 20 degrees above the horizontal from its look-at point.
    const tilt = (Math.atan2(later.position.y - later.target.y, Math.hypot(later.position.x - later.target.x, later.position.z - later.target.z)) * 180) / Math.PI;
    expect(tilt).toBeGreaterThanOrEqual(20 - 0.01);
  });
}

test('Reset view during the opening move goes straight to the establishing shot', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.repoInPeace!.resetView());
  await expect.poll(async () => away(await pose(page), to), { timeout: 2500 }).toBeLessThan(0.05);
});

test('under reduced motion the scene opens on the establishing shot, with no move', async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  expect(away(await pose(page), to)).toBeLessThan(0.05);
  await page.waitForTimeout(1500);
  expect(away(await pose(page), to)).toBeLessThan(0.05);
  await context.close();
});
