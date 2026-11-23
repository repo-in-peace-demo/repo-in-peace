import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { RISE_H } from '../src/model/pr-scene';
import { buildSceneModel } from '../src/model/scene-model';
import { expect, test, type Page } from './fixtures';

/**
 * Resurrect, revised (model/pr-scene.ts): while the request runs the ghost shivers and brightens; once the pull request is open it
 * opens its mouth as if screaming, rises into the sky faster and faster, stretching and fading out, and a stone forms on the ground
 * once it is halfway up. On an error it stops shivering and stays a ghost. Under reduced motion the change is instant.
 */

const OUT = 'test-results/screenshots/';
const spatialql = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const model = buildSceneModel(spatialql);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });
type Rise = { kind: 'risen'; mouth: number; rise: number; stretch: number; fade: number; solid: number };
const frame = (page: Page, path: string) => page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), path) as Promise<Rise | null>;
const wait = (page: Page, path: string) => page.evaluate((p) => window.repoInPeace!.getGhostWait(p), path);

async function openScene(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.spatialql');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function holdPost(page: Page, ms: number, error?: string): Promise<void> {
  await page.route('**/api/pr', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    if (error === undefined) await route.fallback().catch(() => {});
    else await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error }) }).catch(() => {});
  });
}

async function confirmResurrect(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => window.repoInPeace!.select({ kind: 'ghost', path: p }), path);
  await panel(page).getByRole('button', { name: 'Resurrect' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
}

/** The camera close in front of the ghost (it faces +z) and a little above, inside the camera's limits (20° above the horizontal). */
async function lookAtGhost(page: Page, path: string): Promise<void> {
  const g = model.ghosts[model.lookup.get(path)!.index]!.layout;
  await page.evaluate((p) => window.repoInPeace!.setPose({ position: { x: p.x, y: 5.6, z: p.z + 6.2 }, target: { x: p.x, y: 3.2, z: p.z } }), { x: g.x, z: g.z });
  await page.waitForTimeout(300);
}

test('a held Resurrect: it shivers while waiting, then screams, rises and fades, and the stone forms once it is halfway up', async ({ page }) => {
  const ghost = spatialql.ghosts[0]!;
  await openScene(page);
  await holdPost(page, 2000);
  await confirmResurrect(page, ghost.path);
  await expect.poll(() => wait(page, ghost.path), { timeout: 1500 }).toBe(1);
  expect(await frame(page, ghost.path)).toBeNull(); // nothing changes but the shiver until the pull request is open
  await expect(panel(page).locator('.detail-progress')).toBeVisible();

  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible({ timeout: 5000 });
  const samples: Rise[] = [];
  for (let i = 0; i < 60; i++) {
    const f = await frame(page, ghost.path);
    if (f) samples.push(f);
    if (f && f.solid === 1 && f.fade === 0) break;
    await page.waitForTimeout(40);
  }
  expect(await wait(page, ghost.path)).toBe(0);
  // The order, as drawn: mouth open before any rise; the stone only once it is halfway up; it ends risen, faded, with the stone.
  for (const f of samples) {
    if (f.rise > 0) expect(f.mouth).toBe(1);
    if (f.solid > 0) expect(f.rise).toBeGreaterThanOrEqual(RISE_H / 2 - 1e-6);
  }
  expect(samples.some((f) => f.rise > 0 && f.rise < RISE_H && f.fade > 0), 'seen mid-rise').toBe(true);
  expect(samples.at(-1)).toEqual({ kind: 'risen', mouth: 1, rise: RISE_H, stretch: 1.25, fade: 0, solid: 1 });
});

test('a refused Resurrect: the shiver stops, it stays a ghost, and the panel shows the error', async ({ page }) => {
  const ghost = spatialql.ghosts[1]!;
  await openScene(page);
  const message = 'This demo has 50 open Repo In Peace pull requests, the most it allows.';
  await holdPost(page, 1200, message);
  await confirmResurrect(page, ghost.path);
  await expect.poll(() => wait(page, ghost.path), { timeout: 1500 }).toBe(1);
  await expect(panel(page).locator('.detail-error')).toHaveText(message, { timeout: 4000 });
  await expect.poll(() => wait(page, ghost.path)).toBe(0);
  expect(await frame(page, ghost.path)).toBeNull();
});

test('under reduced motion it neither shivers nor screams: the stone is there at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const ghost = spatialql.ghosts[0]!;
  await openScene(page);
  await holdPost(page, 1000);
  await confirmResurrect(page, ghost.path);
  for (let i = 0; i < 4; i++) {
    expect(await wait(page, ghost.path)).toBe(0);
    await page.waitForTimeout(150);
  }
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  await expect.poll(() => frame(page, ghost.path)).toEqual({ kind: 'risen', mouth: 0, rise: 0, stretch: 1, fade: 0, solid: 1 });
});

test('screenshot: mid-rise, mouth open', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const ghost = spatialql.ghosts[0]!;
  await openScene(page);
  await lookAtGhost(page, ghost.path);
  await confirmResurrect(page, ghost.path);
  await page.evaluate(() => window.repoInPeace!.clearSelection()); // the details closed, so the picture is clear
  await page.mouse.move(640, 8);
  await page.waitForFunction((p) => {
    const f = window.repoInPeace!.getOverrideFrame(p) as { rise?: number } | null;
    return f !== null && (f.rise ?? 0) > 1.0;
  }, ghost.path, { timeout: 8000, polling: 'raf' });
  // One picture (the rise runs on the real clock, so a second one would be later), and where the ghost's face is in it: it floats
  // 0.7 up and is 2 tall, the mouth at 1.18 of it (saved beside it, to cut a close-up from the picture).
  const g = model.ghosts[model.lookup.get(ghost.path)!.index]!.layout;
  const [rise, face] = await page.evaluate(([p, x, z]) => {
    const r = (window.repoInPeace!.getOverrideFrame(p as string) as { rise: number }).rise;
    return [r, window.repoInPeace!.projectPoint(x as number, 0.7 + r + 1.2, z as number)] as const;
  }, [ghost.path, g.x, g.z] as const);
  await page.screenshot({ path: `${OUT}resurrect-scream.png` });
  writeFileSync(`${OUT}resurrect-scream.json`, JSON.stringify({ rise, face }));
});
