import { expect, test } from '@playwright/test';

/**
 * Development extras (task 26), on the dev server the end-to-end tests run against: the performance overlay with `?stats`, and a
 * made-up graveyard with `?synthetic=<n>`. That none of it is in a production build is checked on the build itself (task 26.3).
 */

test('?stats shows the performance overlay with live numbers; without it there is none', async ({ page }) => {
  await page.goto('/?graveyard=demo.spatialql');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('perf')).toHaveCount(0);

  await page.goto('/?graveyard=demo.spatialql&stats');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  const overlay = page.getByTestId('perf');
  await expect(overlay).toBeVisible();
  await expect.poll(async () => Number.parseFloat((await overlay.innerText()).match(/(\d+) draw calls/)?.[1] ?? '0'), { timeout: 5000 }).toBeGreaterThan(0);
  await expect(overlay).toContainText('fps');
  await expect(overlay).toContainText('p95');
});

test('?synthetic=2000 draws a made-up graveyard of 2,000 files, with the overlay on and under 40 draw calls', async ({ page }) => {
  await page.goto('/?synthetic=2000');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await expect(page.locator('body')).toContainText('synthetic');
  const overlay = page.getByTestId('perf');
  await expect(overlay).toBeVisible();
  const calls = async () => Number.parseFloat((await overlay.innerText()).match(/(\d+) draw calls/)?.[1] ?? '0');
  await expect.poll(calls, { timeout: 5000 }).toBeGreaterThan(0);
  expect(await calls(), 'the draw-call budget').toBeLessThan(40);
});
