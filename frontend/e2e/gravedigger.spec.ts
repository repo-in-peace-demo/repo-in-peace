import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { buildSceneModel } from '../src/model/scene-model';
import { expect, test, type Page } from './fixtures';

/**
 * The gravedigger who performs a Bury (model/gravedigger.ts, scene/Gravedigger.tsx), with the dev server's fake pull requests and a
 * held request: he appears, digs while the request runs, and on success the stone sinks, the mound and stake appear and he goes; on
 * an error he goes and the stone stays. Never under reduced motion, never for Resurrect, and the camera never moves.
 */

const OUT = 'test-results/screenshots/';
const oikos = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const spatialql = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const model = buildSceneModel(oikos);
const unused = oikos.files.filter((f) => f.unused);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });
type Digger = { path: string; phase: string; opacity: number; x: number; z: number };
const diggers = (page: Page): Promise<Digger[]> => page.evaluate(() => window.repoInPeace!.getGravediggers());
const pose = (page: Page) => page.evaluate(() => window.repoInPeace!.getPose());
/** The camera hasn't moved: the same pose to a millionth (the rig recomputes it each frame, so the last bits can differ). */
function expectSamePose(a: Awaited<ReturnType<typeof pose>>, b: Awaited<ReturnType<typeof pose>>): void {
  for (const k of ['position', 'target'] as const) for (const c of ['x', 'y', 'z'] as const) expect(a[k][c]).toBeCloseTo(b[k][c], 6);
}

async function openScene(page: Page, name = 'demo.oikosledger'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

/** The camera close in front of a stone and a little to its side, looking at it, so the grave sits left of the detail panel. */
async function closeUp(page: Page, path: string): Promise<void> {
  const s = model.stones[model.lookup.get(path)!.index]!.layout;
  await page.evaluate((p) => window.repoInPeace!.setPose({ position: { x: p.x + 1.2, y: 2.6, z: p.z + 5.2 }, target: { x: p.x + 1.0, y: 0.9, z: p.z } }), { x: s.x, z: s.z });
  await page.waitForTimeout(300);
}

/** The function answers after `ms`: passed on to the fake flow, or refused with `error`. */
async function holdPost(page: Page, ms: number, error?: string): Promise<void> {
  await page.route('**/api/pr', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    if (error === undefined) await route.fallback().catch(() => {});
    else await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error }) }).catch(() => {});
  });
}

async function confirmBury(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
}

/** Every phase seen, in order without repeats, by sampling every 50 ms until he has gone. */
async function watchPhases(page: Page, timeoutMs = 15_000): Promise<string[]> {
  const seen: string[] = [];
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const phase = (await diggers(page))[0]?.phase ?? 'none';
    if (seen.at(-1) !== phase) seen.push(phase);
    if (phase === 'gone') break;
    await page.waitForTimeout(50);
  }
  return seen;
}

test('a held Bury: he appears beside the grave and digs while waiting; on success the stone sinks, mound and stake appear, and he goes', async ({ page }) => {
  const stone = unused[1]!;
  await openScene(page);
  await closeUp(page, stone.path);
  const before = await pose(page);
  await holdPost(page, 2500);
  // The baseline with the stone selected and the confirmation open, so only he can add draw calls.
  await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), stone.path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  await page.waitForTimeout(300);
  const calls0 = (await page.evaluate(() => window.repoInPeace!.getRenderInfo())).calls;
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();

  await expect.poll(async () => (await diggers(page))[0]?.phase, { timeout: 2000 }).toBe('dig');
  const [digger] = await diggers(page);
  expect(digger!.path).toBe(stone.path);
  // Beside his grave: within the cell and the aisle round it, and not on the stone.
  const s = model.stones[model.lookup.get(stone.path)!.index]!.layout;
  expect(digger!.x).toBeGreaterThan(s.cell.x - 0.75);
  expect(digger!.x).toBeLessThan(s.cell.x + s.cell.w + 0.75);
  expect(Math.abs(digger!.x - s.x) > 0.7 || Math.abs(digger!.z - s.z) > 0.25).toBe(true);
  // While the request runs: the progress words in the panel, the stone still standing, and a handful of draw calls more.
  await expect(panel(page).locator('.detail-progress')).toBeVisible();
  expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toBeNull();
  const calls1 = (await page.evaluate(() => window.repoInPeace!.getRenderInfo())).calls;
  expect(calls1 - calls0).toBeGreaterThan(0);
  expect(calls1 - calls0).toBeLessThanOrEqual(6);

  const phases = await watchPhases(page);
  expect(phases).toEqual(['dig', 'watch', 'pat', 'stake', 'exit', 'gone']);
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toEqual({ kind: 'buried', sink: 1, mound: 1, stake: 1 });
  // He's gone, and so are his draw calls; the camera never moved.
  await page.waitForTimeout(200);
  expectSamePose(await pose(page), before);
});

test('a refused Bury: he digs, stops, shakes his head and goes; the stone stays and the panel shows the error', async ({ page }) => {
  const stone = unused[2]!;
  await openScene(page);
  await closeUp(page, stone.path);
  const before = await pose(page);
  const message = 'This demo has 50 open Repo In Peace pull requests, the most it allows.';
  await holdPost(page, 1500, message);
  await confirmBury(page, stone.path);
  const phases = await watchPhases(page);
  expect(phases.filter((p) => p !== 'none' && p !== 'enter')).toEqual(['dig', 'shrug', 'exit', 'gone']);
  await expect(panel(page).locator('.detail-error')).toHaveText(message);
  expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toBeNull();
  expectSamePose(await pose(page), before);
});

test('a Bury that returns at once still takes about 3 s or more before he has gone', async ({ page }) => {
  const stone = unused[3]!;
  await openScene(page);
  const t0 = Date.now();
  await confirmBury(page, stone.path);
  const phases = await watchPhases(page);
  expect(phases).toContain('dig');
  expect(phases.at(-1)).toBe('gone');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(3000);
});

test('under reduced motion there is no gravedigger and the change is instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stone = unused[4]!;
  await openScene(page);
  await holdPost(page, 1000);
  await confirmBury(page, stone.path);
  for (let i = 0; i < 6; i++) {
    expect(await diggers(page)).toEqual([]);
    await page.waitForTimeout(200);
  }
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  await expect.poll(() => page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toEqual({ kind: 'buried', sink: 1, mound: 1, stake: 1 });
  expect(await diggers(page)).toEqual([]);
});

test('Resurrect has no gravedigger', async ({ page }) => {
  await openScene(page, 'demo.spatialql');
  const ghost = spatialql.ghosts[0]!;
  await page.evaluate((p) => window.repoInPeace!.select({ kind: 'ghost', path: p }), ghost.path);
  await panel(page).getByRole('button', { name: 'Resurrect' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  expect(await diggers(page)).toEqual([]);
});

test('screenshots: mid-dig and at the stake', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const stone = unused[5]!;
  await openScene(page);
  await closeUp(page, stone.path);
  await holdPost(page, 3000);
  await confirmBury(page, stone.path);
  await page.mouse.move(640, 8);
  // Mid-dig: during the lift of a dig, the second one.
  await expect.poll(async () => (await diggers(page))[0]?.phase, { timeout: 2000 }).toBe('dig');
  await page.waitForTimeout(0.9 * 1000 + 450);
  await page.screenshot({ path: `${OUT}gravedigger-dig.png` });
  await expect.poll(async () => (await diggers(page))[0]?.phase, { timeout: 8000, intervals: [30] }).toBe('stake');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}gravedigger-stake.png` });
});
