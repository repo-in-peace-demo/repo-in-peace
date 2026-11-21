import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { calendarDay, ghostSummary, hotDetail, stateSentence, stoneSummary } from '../src/model/grave-facts';
import { buildRows, filterRows, sortRows } from '../src/model/list-rows';
import { makeSyntheticGraveyard } from '../src/model/synthetic';

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

test.describe('the list', () => {
  const list = (page: Page) => page.getByRole('complementary', { name: 'Graves' });
  const rowsBox = (page: Page) => page.getByRole('listbox', { name: 'Files and ghosts' });
  async function openList(page: Page): Promise<void> {
    const toggle = list(page).getByRole('button', { name: /List · / });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(rowsBox(page)).toBeVisible();
  }

  test('lists every grave, most dead first, and counts what the filters let through', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await openList(page);
    await expect(list(page)).toContainText('129 of 129');
    const expected = sortRows(buildRows(oikos), 'decay').slice(0, 8).map((r) => r.name);
    const names = await rowsBox(page).locator('.list-name').allTextContents();
    expect(names.slice(0, 8)).toEqual(expected);
    await list(page).getByRole('button', { name: 'unused', exact: true }).click();
    await expect(list(page)).toContainText('12 of 129');
    await list(page).getByRole('button', { name: 'ancient', exact: true }).click();
    const both = filterRows(buildRows(oikos), new Set(['ancient']), new Set(['unused'])).length;
    await expect(list(page)).toContainText(`${both} of 129`);
    await list(page).getByRole('button', { name: 'unused', exact: true }).click();
    await list(page).getByRole('button', { name: 'ancient', exact: true }).click();
    await list(page).getByRole('button', { name: 'hot', exact: true }).click();
    await expect(list(page)).toContainText('7 of 129');
  });

  test('on spatialql the two ghosts come after every stone; a second press on a sort reverses it', async ({ page }) => {
    await openScene(page, 'demo.spatialql');
    await openList(page);
    await rowsBox(page).focus();
    await page.keyboard.press('End');
    await expect(rowsBox(page)).toHaveAttribute('aria-activedescendant', /^row-ghost-/);
    const decay = list(page).getByRole('button', { name: /^decay/ });
    await decay.click(); // reversed: ghosts first
    await rowsBox(page).focus();
    await page.keyboard.press('Home');
    await expect(rowsBox(page)).toHaveAttribute('aria-activedescendant', /^row-ghost-/);
  });

  test('P4: a scene click, a row click and a selection from code each leave the store and exactly one selected row in step', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await openList(page);
    const selectedRows = () => rowsBox(page).locator('[role=option][aria-selected=true]');
    // From the scene.
    const at = await pointAt(page, 'app/components/voice/index.ts');
    await page.mouse.click(at.x, at.y);
    const fromScene = await page.evaluate(() => window.repoInPeace!.getSelection());
    expect(fromScene?.path).toBe('app/components/voice/index.ts');
    await expect(selectedRows()).toHaveCount(1);
    await expect(selectedRows().locator('.list-name')).toHaveText('index.ts');
    // From a row: it selects and flies.
    const third = rowsBox(page).locator('[role=option]').nth(2);
    const name = await third.locator('.list-name').textContent();
    await third.click();
    await expect(selectedRows()).toHaveCount(1);
    await expect(selectedRows().locator('.list-name')).toHaveText(name!);
    const fromRow = await page.evaluate(() => window.repoInPeace!.getSelection());
    expect(fromRow?.path.endsWith(name!)).toBe(true);
    // From code, for a grave far down the list: it is scrolled into view.
    const last = sortRows(buildRows(oikos), 'decay').at(-1)!;
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), last.path);
    await expect(selectedRows()).toHaveCount(1);
    await expect(selectedRows()).toBeInViewport();
    // Filtered out: no row, and the list says so.
    await list(page).getByRole('button', { name: 'ghosts', exact: true }).click();
    await expect(selectedRows()).toHaveCount(0);
    await expect(list(page)).toContainText('hidden by the filters');
  });

  test('2,000 files (and their ghosts): fewer than 60 row elements in the page from top to bottom, and the arrow keys never move the camera', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?synthetic=2000');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await openList(page);
    // 2,000 files and, by default, 2% as many ghosts: the same made-up graveyard the app builds (seed 1, the mixed shape).
    const total = buildRows(makeSyntheticGraveyard({ files: 2000, seed: 1, shape: 'mixed' })).length;
    await expect(list(page)).toContainText(`${total.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`);
    const counts: number[] = [];
    for (let step = 0; step <= 10; step++) {
      await rowsBox(page).evaluate((el, f) => (el.scrollTop = f * el.scrollHeight), step / 10);
      await page.waitForTimeout(60);
      counts.push(await rowsBox(page).locator('[role=option]').count());
    }
    expect(Math.max(...counts), counts.join(',')).toBeLessThan(60);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    const before = await page.evaluate(() => window.repoInPeace!.getPose());
    await rowsBox(page).focus();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'PageDown']) await page.keyboard.press(key);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => window.repoInPeace!.getPose());
    expect(after).toEqual(before);
  });
});
