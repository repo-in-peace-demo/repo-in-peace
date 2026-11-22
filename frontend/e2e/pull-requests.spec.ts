import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { expect, test, type Page } from './fixtures';

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
  await expect(panel(page).getByRole('alert')).toHaveText('This demo has 50 open Repo In Peace pull requests, the most it allows.');
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
