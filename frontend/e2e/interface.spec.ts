import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { calendarDay, ghostSummary, hotDetail, stateSentence, stoneSummary } from '../src/model/grave-facts';

/**
 * The interface around the scene, in the real app (interface spec, tasks 7 to 11): the hover line, the detail panel, the list,
 * search and the layout. Uses `./fixtures`, so the scene opens on its overview without the opening move.
 */

const load = (name: string): Graveyard => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
const oikos = load('demo.oikosledger');
const spatialql = load('demo.spatialql');

async function openScene(page: Page, name: string, size = { width: 1280, height: 720 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

/** Flies to a stone or ghost and puts the pointer on it. */
async function pointAt(page: Page, path: string): Promise<{ x: number; y: number }> {
  await page.evaluate((p) => window.repoInPeace!.flyTo(p), path);
  await page.waitForTimeout(1800);
  const at = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), path))!;
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  return at;
}

test.describe('the hover line', () => {
  test('a stone shows its state, last commit, lines and only its flags, on one line', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const voice = oikos.files.find((f) => f.path === 'app/components/voice/index.ts')!;
    await pointAt(page, voice.path);
    const label = page.locator('.hover-label');
    await expect(label).toContainText('index.ts');
    const summary = label.locator('.hover-summary');
    await expect(summary).toHaveText(stoneSummary(voice, oikos.meta));
    await expect(summary).toHaveText(/^Fresh · last commit .* · unused$/);
    const box = await summary.boundingBox();
    expect(box!.height, 'one line').toBeLessThan(24);
  });

  test('a ghost shows "Ghost · deleted … · .ts"', async ({ page }) => {
    await openScene(page, 'demo.spatialql');
    const ghost = spatialql.ghosts[0]!;
    await pointAt(page, ghost.path);
    await expect(page.locator('.hover-summary')).toHaveText(ghostSummary(ghost, spatialql.meta));
  });

  test('the label is hidden while dragging', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const at = await pointAt(page, 'app/components/voice/index.ts');
    await expect(page.locator('.hover-label')).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 10, { steps: 6 });
    await expect(page.locator('.hover-label')).toHaveCount(0);
    await page.mouse.up();
  });
});

test.describe('the detail panel', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

  test('a click on a stone opens it with the stone\'s facts in words, the eulogy placeholder and Bury on an unused stone', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const voice = oikos.files.find((f) => f.path === 'app/components/voice/index.ts')!;
    const at = await pointAt(page, voice.path);
    await page.mouse.click(at.x, at.y);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText(stateSentence(voice, oikos.meta));
    await expect(panel(page)).toContainText(`${calendarDay(voice.lastCommitDate, oikos.meta.snapshotDate)} by ${voice.lastCommitAuthor}`);
    await expect(panel(page)).toContainText(hotDetail(voice, oikos.meta));
    await expect(panel(page)).toContainText('yes: Knip lists it as unused');
    await expect(panel(page)).toContainText(voice.decayScore.toFixed(2));
    await expect(panel(page)).toContainText('[No eulogy yet.');
    const bury = panel(page).getByRole('button', { name: 'Bury' });
    await expect(bury).toHaveAttribute('aria-disabled', 'true');
    await expect(panel(page)).toContainText('Arrives with the PR function.');
  });

  test('an ancient stone that is still used is not offered Bury; a ghost is offered Resurrect, with its deletion', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const ancientUsed = oikos.files.find((f) => f.decayState === 'ancient' && !f.unused)!;
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), ancientUsed.path);
    await expect(panel(page)).toContainText(stateSentence(ancientUsed, oikos.meta));
    await expect(panel(page).getByRole('button', { name: 'Bury' })).toHaveCount(0);

    await openScene(page, 'demo.spatialql');
    const ghost = spatialql.ghosts[0]!;
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'ghost', path: p }), ghost.path);
    await expect(panel(page)).toContainText(`${calendarDay(ghost.deletedDate, spatialql.meta.snapshotDate)} by ${ghost.deletedBy}`);
    await expect(panel(page)).toContainText(ghost.deletedInSha.slice(0, 7));
    await expect(panel(page)).toContainText('.ts');
    await expect(panel(page).getByRole('button', { name: 'Resurrect' })).toHaveAttribute('aria-disabled', 'true');
    await expect(panel(page).getByRole('button', { name: 'Bury' })).toHaveCount(0);
  });

  test('× and Escape close it by clearing the selection; a double-click opens it too', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const at = await pointAt(page, 'app/components/voice/index.ts');
    await page.mouse.dblclick(at.x, at.y);
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toBeNull();
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    await expect(panel(page)).toBeVisible();
    await page.mouse.move(640, 8);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('it opens on the side away from the selected item and never covers it, for an item on the left and one on the right', async ({ page }) => {
    for (const width of [1280, 900]) {
      await openScene(page, 'demo.oikosledger', { width, height: 720 });
      const points = await page.evaluate((paths) => paths.map((p) => ({ p, at: window.repoInPeace!.getScreenPoint(p) })), oikos.files.map((f) => f.path));
      const shown = points.filter((x) => x.at && x.at.x > 40 && x.at.x < width - 40 && x.at.y > 120 && x.at.y < 680) as Array<{ p: string; at: { x: number; y: number } }>;
      const leftmost = shown.reduce((a, b) => (b.at.x < a.at.x ? b : a));
      const rightmost = shown.reduce((a, b) => (b.at.x > a.at.x ? b : a));
      for (const [label, item, side] of [['left', leftmost, 'right'], ['right', rightmost, 'left']] as const) {
        await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), item.p);
        await expect(panel(page)).toHaveClass(new RegExp(`detail-${side}`));
        await page.waitForTimeout(900); // a nudge, if any, has landed
        const rect = (await panel(page).boundingBox())!;
        const now = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), item.p))!;
        const inside = now.x >= rect.x && now.x <= rect.x + rect.width && now.y >= rect.y && now.y <= rect.y + rect.height;
        expect(inside, `${width} px: the panel covers the ${label} item ${item.p} at ${JSON.stringify(now)}`).toBe(false);
        await page.evaluate(() => window.repoInPeace!.clearSelection());
      }
    }
  });
});
