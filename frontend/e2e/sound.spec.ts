import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { expect, test, type Page } from './fixtures';

/**
 * Sound (sound request): muted on a fresh visit with no audio context at all; the speaker button or M starts it, muting fades it
 * out and suspends it, a hidden tab suspends it; the gravedigger and the resurrection play their sounds in step, and nothing under
 * reduced motion. The page's AudioContext is wrapped before it loads, so the test sees every context made and its state.
 */
declare global {
  interface Window {
    __contexts?: AudioContext[];
  }
}

async function watchAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    window.__contexts = [];
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__contexts!.push(this);
      }
    } as typeof AudioContext;
  });
}
const contexts = (page: Page) => page.evaluate(() => (window.__contexts ?? []).map((c) => c.state));
const sounds = (page: Page) => page.evaluate(() => window.__repoInPeaceSoundLog ?? []);
const speaker = (page: Page) => page.locator('.sound-toggle');

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('a fresh visit is muted and makes no audio context; the speaker starts it, muting suspends it, a hidden tab suspends it', async ({ page }) => {
  await watchAudio(page);
  await page.goto('/');
  await expect(speaker(page)).toHaveAccessibleName('Sound on');
  await page.waitForTimeout(800);
  expect(await contexts(page)).toEqual([]);

  await speaker(page).click();
  await expect(speaker(page)).toHaveAccessibleName('Sound off');
  await expect.poll(() => contexts(page)).toEqual(['running']);

  await setHidden(page, true);
  await expect.poll(() => contexts(page)).toEqual(['suspended']);
  await setHidden(page, false);
  await expect.poll(() => contexts(page)).toEqual(['running']);

  await speaker(page).click();
  await expect(speaker(page)).toHaveAccessibleName('Sound on');
  await expect.poll(() => contexts(page), { timeout: 3000 }).toEqual(['suspended']);
  // A hidden tab while muted stays suspended when it comes back.
  await setHidden(page, true);
  await setHidden(page, false);
  await page.waitForTimeout(300);
  expect(await contexts(page)).toEqual(['suspended']);
});

test('M turns sound on and off; the choice lasts through the boot screen into a scene, with one context; a reload is muted again', async ({ page }) => {
  await watchAudio(page);
  await page.goto('/');
  await expect(speaker(page)).toBeVisible(); // its key listener is set up with it
  await page.keyboard.press('KeyM');
  await expect(speaker(page)).toHaveAccessibleName('Sound off');
  await expect.poll(() => contexts(page)).toEqual(['running']);
  await page.getByRole('button', { name: 'Enter the graveyard' }).click();
  await page.keyboard.press('KeyX');
  await page.getByRole('button', { name: /spatialql/ }).click();
  await page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
  await expect(speaker(page)).toHaveAccessibleName('Sound off'); // next to Reset view and ?
  await page.keyboard.press('KeyM');
  await expect(speaker(page)).toHaveAccessibleName('Sound on');
  expect((await contexts(page)).length).toBe(1);
  await page.reload();
  await expect(speaker(page)).toHaveAccessibleName('Sound on');
  await page.waitForTimeout(500);
  expect(await contexts(page)).toEqual([]);
});

// ---- The scene's sounds ----

const oikos = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const spatialql = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url)), 'utf8')) as Graveyard;
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

async function scene(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(400);
}
async function holdPost(page: Page, ms: number): Promise<void> {
  await page.route('**/api/pr', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, ms));
    await route.fallback().catch(() => {});
  });
}
async function confirm(page: Page, kind: 'file' | 'ghost', path: string, verb: string): Promise<void> {
  await page.evaluate(([k, p]) => window.repoInPeace!.select({ kind: k as 'file' | 'ghost', path: p! }), [kind, path]);
  await panel(page).getByRole('button', { name: verb }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
}

test('Bury: the shovel sounds while he digs, then two pats and the stake; Resurrect: wail, rumble, thunk', async ({ page }) => {
  await scene(page, 'demo.oikosledger');
  await speaker(page).click();
  await page.waitForTimeout(300);
  await holdPost(page, 2500);
  await confirm(page, 'file', oikos.files.filter((f) => f.unused)[1]!.path, 'Bury');
  await expect.poll(async () => (await page.evaluate(() => window.repoInPeace!.getGravediggers()))[0]?.phase, { timeout: 15_000 }).toBe('gone');
  const bury = await sounds(page);
  expect(bury.filter((k) => k === 'thrust').length).toBeGreaterThanOrEqual(2);
  expect(bury.filter((k) => k === 'toss').length).toBeGreaterThanOrEqual(2);
  expect(bury.filter((k) => k === 'pat')).toHaveLength(2);
  expect(bury.filter((k) => k === 'stake')).toHaveLength(1);
  expect(bury.lastIndexOf('thrust')).toBeLessThan(bury.indexOf('pat'));
  expect(bury.indexOf('pat')).toBeLessThan(bury.indexOf('stake'));

  await page.unroute('**/api/pr');
  await scene(page, 'demo.spatialql');
  await speaker(page).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => (window.__repoInPeaceSoundLog = []));
  await confirm(page, 'ghost', spatialql.ghosts[0]!.path, 'Resurrect');
  await expect.poll(() => sounds(page), { timeout: 10_000 }).toEqual(['wail', 'rumble', 'thunk']);
});

test('muted, or under reduced motion, the scene plays none of its sounds', async ({ page }) => {
  await scene(page, 'demo.oikosledger');
  await confirm(page, 'file', oikos.files.filter((f) => f.unused)[2]!.path, 'Bury'); // muted
  await expect.poll(async () => (await page.evaluate(() => window.repoInPeace!.getGravediggers()))[0]?.phase, { timeout: 15_000 }).toBe('gone');
  expect(await sounds(page)).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scene(page, 'demo.spatialql');
  await speaker(page).click();
  await page.waitForTimeout(300);
  await confirm(page, 'ghost', spatialql.ghosts[1]!.path, 'Resurrect');
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  await page.waitForTimeout(2600);
  expect(await sounds(page)).toEqual([]);
});

test('a held Resurrect moans while it waits, then rises into the wail; a refused one fades its moan, with no wail', async ({ page }) => {
  await scene(page, 'demo.spatialql');
  await speaker(page).click();
  await page.waitForTimeout(300);
  await holdPost(page, 2000);
  await page.evaluate(() => (window.__repoInPeaceSoundLog = []));
  await confirm(page, 'ghost', spatialql.ghosts[0]!.path, 'Resurrect');
  await expect.poll(() => sounds(page), { timeout: 2000 }).toEqual(['moan']); // as the shiver starts, and nothing else while waiting
  await page.waitForTimeout(800);
  expect(await sounds(page)).toEqual(['moan']);
  await expect.poll(() => sounds(page), { timeout: 10_000 }).toEqual(['moan', 'moan-rise', 'wail', 'rumble', 'thunk']);

  await page.unroute('**/api/pr');
  await page.route('**/api/pr', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This demo is full.' }) }).catch(() => {});
  });
  await page.evaluate(() => (window.__repoInPeaceSoundLog = []));
  await confirm(page, 'ghost', spatialql.ghosts[1]!.path, 'Resurrect');
  await expect(panel(page).locator('.detail-error')).toHaveText('This demo is full.', { timeout: 5000 });
  await expect.poll(() => sounds(page)).toEqual(['moan', 'moan-fade']);
  await page.waitForTimeout(1500);
  expect(await sounds(page)).toEqual(['moan', 'moan-fade']);
});
