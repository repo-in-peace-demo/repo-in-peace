import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { expect, test, type Page } from './fixtures';
import { risenHeight } from '../src/model/pr-scene';
import { buildSceneModel } from '../src/model/scene-model';

/**
 * Bury and Resurrect in the real app (bury-and-resurrect spec, task 13). The dev server runs the PR function with fake pull requests
 * (no token; playwright.config.ts sets RIP_FAKE_PRS=1), after the server's real checks. The fake numbers last as long as the dev
 * server, so the checks read them from the page.
 */

const load = (name: string): Graveyard => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
const oikos = load('demo.oikosledger');
const spatialql = load('demo.spatialql');
const unused = oikos.files.filter((f) => f.unused);
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

async function openScene(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
}
const select = (page: Page, kind: 'file' | 'ghost', path: string) => page.evaluate(([k, p]) => window.repoInPeace!.select({ kind: k as 'file' | 'ghost', path: p! }), [kind, path]);

test('Bury: confirmation naming the fork and path, then the fake pull request link; the list and hover show it', async ({ page }) => {
  const stone = unused[0]!;
  await openScene(page, 'demo.oikosledger');
  await select(page, 'file', stone.path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  const confirm = panel(page).getByRole('group', { name: 'Bury: confirm' });
  await expect(confirm).toContainText(`Open a pull request on repo-in-peace-demo/${oikos.meta.name} that deletes ${stone.path}?`);
  await expect(confirm.getByRole('button', { name: 'Open pull request' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Open pull request' }).click();

  const link = panel(page).getByRole('link', { name: /^Pull request #\d+ (opened|was already open)$/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^\/api\/fake-pr\/\d+$/);
  const number = href.split('/').at(-1)!;
  await expect(panel(page)).toContainText('(fake, local development)');
  await expect(panel(page).getByRole('button', { name: 'Bury' })).toHaveCount(0);

  // The fake page says what it is.
  const fakePage = await page.request.get(href);
  expect(await fakePage.text()).toContain(`fake pull request #${number} from local development: RIP ${stone.path}`);

  // The list row carries the marker.
  const list = page.getByRole('complementary', { name: 'Graves' });
  const toggle = list.getByRole('button', { name: /List · / });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  // The selected grave's row is scrolled into view when the list opens.
  await expect(page.locator(`[id="row-file-${encodeURIComponent(stone.path)}"]`)).toContainText(`PR #${number}`);
});

test('the same Bury after a reload says the pull request was already open', async ({ page }) => {
  const stone = unused[1]!;
  await openScene(page, 'demo.oikosledger');
  await select(page, 'file', stone.path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
  const first = await panel(page).getByRole('link', { name: /^Pull request #\d+/ }).getAttribute('href');

  await openScene(page, 'demo.oikosledger'); // a reload: the session is gone, the dev server's fake pull request is not
  await select(page, 'file', stone.path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
  const again = panel(page).getByRole('link', { name: /^Pull request #\d+ was already open$/ });
  await expect(again).toBeVisible();
  expect(await again.getAttribute('href')).toBe(first);
});

test('Resurrect: the confirmation names the commit it restores from; Cancel and Escape leave the selection alone', async ({ page }) => {
  const ghost = spatialql.ghosts[0]!;
  await openScene(page, 'demo.spatialql');
  await select(page, 'ghost', ghost.path);
  const resurrect = panel(page).getByRole('button', { name: 'Resurrect' });

  await resurrect.click();
  await expect(panel(page)).toContainText(`that restores ${ghost.path} as it was at ${ghost.lastExistingSha.slice(0, 7)}?`);
  await panel(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(resurrect).toBeVisible();

  await resurrect.click();
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('group', { name: 'Resurrect: confirm' })).toHaveCount(0);
  await expect(panel(page)).toBeVisible(); // the first Escape cancelled the confirmation, not the selection
  expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toEqual({ kind: 'ghost', path: ghost.path });

  await resurrect.click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
  await expect(panel(page).getByRole('link', { name: /^Pull request #\d+ (opened|was already open)$/ })).toBeVisible();

  // Hover shows the marker too.
  await page.evaluate((p) => window.repoInPeace!.flyTo(p), ghost.path);
  await page.waitForTimeout(1800);
  const at = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), ghost.path))!;
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(page.locator('.hover-summary')).toContainText(/· PR #\d+ open$/);
});

test('a refused request shows the server\'s message and Try again', async ({ page }) => {
  await openScene(page, 'demo.oikosledger');
  await page.route('**/api/pr', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This demo has 50 open Repo In Peace pull requests, the most it allows.' }) })
      : route.fallback(),
  );
  await select(page, 'file', unused[2]!.path);
  await panel(page).getByRole('button', { name: 'Bury' }).click();
  await panel(page).getByRole('button', { name: 'Open pull request' }).click();
  await expect(panel(page).locator('.detail-error')).toHaveText('This demo has 50 open Repo In Peace pull requests, the most it allows.');
  await expect(panel(page).locator('[aria-live="polite"]')).toHaveText('This demo has 50 open Repo In Peace pull requests, the most it allows.');
  await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a graveyard opened from a file keeps the buttons disabled, with the demo-only note', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Repo In Peace' })).toContainText('RIP/OS');
  await page.keyboard.press('KeyX');
  await page.locator('input[type=file]').setInputFiles({ name: 'mine.graveyard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oikos)) });
  await page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
  await select(page, 'file', unused[0]!.path);
  await expect(panel(page).getByRole('button', { name: 'Bury' })).toHaveAttribute('aria-disabled', 'true');
  await expect(panel(page)).toContainText('Pull requests are only available on the demo graveyards.');
});

test('when the PR function can\'t be reached, the buttons stay disabled with the unavailable note', async ({ page }) => {
  await page.route('**/api/pr', (route) => route.abort());
  await openScene(page, 'demo.spatialql');
  await select(page, 'ghost', spatialql.ghosts[1]!.path);
  await expect(panel(page).getByRole('button', { name: 'Resurrect' })).toHaveAttribute('aria-disabled', 'true');
  await expect(panel(page)).toContainText("Pull requests aren't available right now.");
});

test.describe('the scene after a pull request (this session only)', () => {
  const legend = (page: Page) => page.getByRole('region', { name: 'Pull requests (this session)' });
  /** The legend starts folded on a window under 1600 px wide (the tests use 1280): open it, as a user would. */
  async function openLegend(page: Page): Promise<void> {
    const toggle = page.getByRole('region', { name: 'Legend' }).getByRole('button', { name: 'Legend' });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  /** The frame the scene last drew for a grave, once it has drawn one (software rendering can take a moment). */
  async function frameWhenDrawn(page: Page, path: string) {
    await expect.poll(() => page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), path), { timeout: 5000 }).not.toBeNull();
    return page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), path);
  }

  async function openFake(page: Page, kind: 'file' | 'ghost', path: string, verb: 'Bury' | 'Resurrect'): Promise<void> {
    await select(page, kind, path);
    await panel(page).getByRole('button', { name: verb }).click();
    await panel(page).getByRole('button', { name: 'Open pull request' }).click();
    await expect(panel(page).getByRole('link', { name: /^Pull request #\d+/ })).toBeVisible();
  }

  test('a buried stone sinks and a mound rises over about 1.5 s; the legend explains it; a reload restores the stone', async ({ page }) => {
    const stone = unused[3]!;
    await openScene(page, 'demo.oikosledger');
    await openFake(page, 'file', stone.path, 'Bury');
    const early = await frameWhenDrawn(page, stone.path);
    expect(early).toMatchObject({ kind: 'buried' });
    expect((early as { mound: number }).mound).toBeLessThan(1); // still on its way: the mound comes at the end
    // The gravedigger stops digging, the stone sinks, he pats the mound and plants the stake, and goes (e2e/gravedigger.spec.ts).
    await expect.poll(() => page.evaluate(() => window.repoInPeace!.getGravediggers().map((d) => d.phase)), { timeout: 10_000 }).toEqual(['gone']);
    expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toEqual({ kind: 'buried', sink: 1, mound: 1, stake: 1 });
    await page.evaluate(() => window.repoInPeace!.clearSelection()); // the legend shows while the details are closed
    await openLegend(page);
    await expect(legend(page)).toContainText('Fresh grave with a stake');
    await expect(legend(page)).not.toContainText('Clean stone');
    expect(Object.values(await page.evaluate(() => window.repoInPeace!.getPullRequests()))).toEqual([expect.objectContaining({ action: 'bury' })]);

    await openScene(page, 'demo.oikosledger');
    expect(await page.evaluate(() => window.repoInPeace!.getPullRequests())).toEqual({});
    expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), stone.path)).toBeNull();
    await openLegend(page);
    await expect(page.getByRole('region', { name: 'Legend' })).toContainText('Darker ground'); // open, and without the group
    await expect(legend(page)).toHaveCount(0);
  });

  test('a resurrected ghost rises away and a stone forms; it can still be selected there', async ({ page }) => {
    const ghost = spatialql.ghosts[1]!;
    await openScene(page, 'demo.spatialql');
    await openFake(page, 'ghost', ghost.path, 'Resurrect');
    await page.waitForTimeout(2600);
    // It has screamed, risen and faded out, and the stone has formed (e2e/resurrect.spec.ts follows it through).
    expect(await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), ghost.path)).toEqual({ kind: 'risen', mouth: 1, rise: 3.5, stretch: 1.25, fade: 0, solid: 1 });
    await page.evaluate(() => window.repoInPeace!.clearSelection());
    await openLegend(page);
    await expect(legend(page)).toContainText('Clean stone with a stake');

    // Clicking the new stone selects the ghost's grave.
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), ghost.path);
    await page.waitForTimeout(1800);
    const model = buildSceneModel(spatialql);
    const at = model.ghosts.find((g) => g.ghost.path === ghost.path)!.layout;
    await page.evaluate(() => window.repoInPeace!.clearSelection());
    const middle = (await page.evaluate(([x, y, z]) => window.repoInPeace!.projectPoint(x!, y!, z!), [at.x, risenHeight(model) / 2, at.z]))!;
    await page.mouse.click(middle.x, middle.y);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toEqual({ kind: 'ghost', path: ghost.path });
  });

  test('under reduced motion both change at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openScene(page, 'demo.oikosledger');
    const stone = unused[4]!;
    await openFake(page, 'file', stone.path, 'Bury');
    expect(await frameWhenDrawn(page, stone.path)).toEqual({ kind: 'buried', sink: 1, mound: 1, stake: 1 }); // the first frame drawn is the end
  });
});

test.describe('while a pull request is being opened', () => {
  /** The function answers only after `ms`: the request is held, then passed on to the dev server's fake flow. */
  async function delayPost(page: Page, ms: number): Promise<void> {
    await page.route('**/api/pr', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((r) => setTimeout(r, ms));
      await route.fallback().catch(() => {}); // the page may have stopped waiting already
    });
  }
  const progress = (page: Page) => panel(page).locator('.detail-progress');
  const live = (page: Page) => panel(page).locator('[aria-live="polite"]');

  test('the dots animate, the button is disabled, screen readers hear it once, and the result replaces the message', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await delayPost(page, 2500);
    await select(page, 'file', unused[6]!.path);
    await panel(page).getByRole('button', { name: 'Bury' }).click();
    await panel(page).getByRole('button', { name: 'Open pull request' }).click();

    await expect(progress(page)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Bury' })).toBeDisabled();
    await expect(live(page)).toHaveText(`Opening a pull request on repo-in-peace-demo/${oikos.meta.name}.`);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      seen.add((await progress(page).textContent()) ?? '');
      await page.waitForTimeout(150);
    }
    expect([...seen].every((t) => /^Opening pull request(\.|\.\.|…)$/.test(t))).toBe(true);
    expect(seen.size).toBeGreaterThan(1); // the dots moved

    const link = panel(page).getByRole('link', { name: /^Pull request #\d+ (opened|was already open)$/ });
    await expect(link).toBeVisible({ timeout: 6000 });
    await expect(progress(page)).toHaveCount(0);
    await expect(live(page)).toHaveText(/^Pull request #\d+ (opened|was already open)\.$/);
  });

  test('under reduced motion the dots stay a still "…"', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openScene(page, 'demo.oikosledger');
    await delayPost(page, 2000);
    await select(page, 'file', unused[7]!.path);
    await panel(page).getByRole('button', { name: 'Bury' }).click();
    await panel(page).getByRole('button', { name: 'Open pull request' }).click();
    for (let i = 0; i < 5; i++) {
      await expect(progress(page)).toHaveText('Opening pull request…');
      await page.waitForTimeout(200);
    }
  });

  test('a slow answer says "Still working", then the page stops waiting, and Try again gets the pull request', async ({ page }) => {
    await page.addInitScript(() => {
      window.__repoInPeacePrTimeouts = { stillWorkingMs: 600, giveUpMs: 1800 };
    });
    const ghost = spatialql.ghosts[1]!;
    await openScene(page, 'demo.spatialql');
    await delayPost(page, 4000);
    await select(page, 'ghost', ghost.path);
    await panel(page).getByRole('button', { name: 'Resurrect' }).click();
    await panel(page).getByRole('button', { name: 'Open pull request' }).click();
    await expect(progress(page)).toHaveText(/^Still working/, { timeout: 1500 });
    await expect(live(page)).toHaveText('Still working on the pull request on repo-in-peace-demo/spatialql.');
    await expect(panel(page).locator('.detail-error')).toHaveText(/stopped waiting/, { timeout: 3000 });
    await expect(live(page)).toHaveText(/stopped waiting/);

    await page.unroute('**/api/pr');
    await panel(page).getByRole('button', { name: 'Try again' }).click();
    await expect(panel(page).getByRole('link', { name: /^Pull request #\d+ (opened|was already open)$/ })).toBeVisible();
  });
});
