import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { calendarDay, ghostSummary, hotDetail, stateSentence, stoneSummary, usageDetail } from '../src/model/grave-facts';
import { buildRows, filterRows, sortRows } from '../src/model/list-rows';
import { makeSyntheticGraveyard } from '../src/model/synthetic';
import { buildSceneModel } from '../src/model/scene-model';
import type { CameraPose } from '../src/model/camera-pose';
import { SIGN_FADE_SECONDS, plaqueBox } from '../src/model/sign-fade';
import { flyView } from '../test/fly-view';

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
  test('a stone shows its state, when it last changed, lines and only its flags, on one line', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const voice = oikos.files.find((f) => f.path === 'app/components/voice/index.ts')!;
    await pointAt(page, voice.path);
    const label = page.locator('.hover-label');
    await expect(label).toContainText('index.ts');
    const summary = label.locator('.hover-summary');
    await expect(summary).toHaveText(stoneSummary(voice, oikos.meta));
    await expect(summary).toHaveText(/^Fresh · last changed .* · Unused$/);
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
    await expect(panel(page)).toContainText(usageDetail(voice, oikos.meta));
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
    await list(page).getByRole('button', { name: 'Unused', exact: true }).click();
    await expect(list(page)).toContainText('12 of 129');
    await list(page).getByRole('button', { name: 'Ancient', exact: true }).click();
    const both = filterRows(buildRows(oikos), new Set(['ancient']), new Set(['unused'])).length;
    await expect(list(page)).toContainText(`${both} of 129`);
    await list(page).getByRole('button', { name: 'Unused', exact: true }).click();
    await list(page).getByRole('button', { name: 'Ancient', exact: true }).click();
    await list(page).getByRole('button', { name: 'Hot', exact: true }).click();
    await expect(list(page)).toContainText('7 of 129');
  });

  test('the button rows are labelled: Sort before the orders, Show before the filters', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await openList(page);
    const sortRow = list(page).getByRole('group', { name: 'Sort' });
    const showRow = list(page).getByRole('group', { name: 'Show' });
    await expect(sortRow.getByRole('button')).toHaveText([/^decay/, /^age/, /^name/, /^size/]);
    await expect(showRow.getByRole('button')).toHaveText(['Fresh', 'Stale', 'Ancient', 'Ghosts', 'Unused', 'Hot']);
    // The labels come first in their rows, and the first buttons of both rows line up.
    const [sortLabel, showLabel] = [await sortRow.getByText('Sort', { exact: true }).boundingBox(), await showRow.getByText('Show', { exact: true }).boundingBox()];
    const [firstSort, firstShow] = [await sortRow.getByRole('button').first().boundingBox(), await showRow.getByRole('button').first().boundingBox()];
    expect(sortLabel!.x).toBeLessThan(firstSort!.x);
    expect(showLabel!.x).toBeLessThan(firstShow!.x);
    expect(Math.abs(firstSort!.x - firstShow!.x)).toBeLessThan(1);
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
    await list(page).getByRole('button', { name: 'Ghosts', exact: true }).click();
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

test.describe('search', () => {
  const box = (page: Page) => page.getByRole('combobox', { name: 'Search graves by file name or path' });
  const results = (page: Page) => page.getByRole('listbox', { name: 'Results' }).getByRole('option');

  test('/ and Cmd+K (Ctrl+K) focus the box; / typed into a field stays a /', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.mouse.move(640, 8);
    await page.keyboard.press('/');
    await expect(box(page)).toBeFocused();
    await page.keyboard.type('a/b');
    await expect(box(page)).toHaveValue('a/b');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(box(page)).not.toBeFocused();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK');
    await expect(box(page)).toBeFocused();
  });

  test('exact file-name matches come first, and Enter selects the top result and flies to it', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.keyboard.press('/');
    await page.keyboard.type('index.ts');
    const names = await results(page).locator('.search-name').allTextContents();
    const exact = oikos.files.filter((f) => f.path.endsWith('/index.ts') || f.path === 'index.ts').length;
    expect(exact).toBeGreaterThan(1);
    expect(names.slice(0, exact).every((n) => n === 'index.ts')).toBe(true);
    const before = await page.evaluate(() => window.repoInPeace!.getPose());
    await page.keyboard.press('Enter');
    const selected = await page.evaluate(() => window.repoInPeace!.getSelection());
    expect(selected?.path.endsWith('index.ts')).toBe(true);
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => window.repoInPeace!.getPose());
    expect(Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z), 'it flew').toBeGreaterThan(1);
    // The list (P4) shows the same one selected row.
    await page.getByRole('button', { name: /List · / }).click();
    await expect(page.getByRole('listbox', { name: 'Files and ghosts' }).locator('[role=option][aria-selected=true]')).toHaveCount(1);
  });

  test('typing w a s d in the box never moves the camera, and Escape twice keeps the selection', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    const before = await page.evaluate(() => window.repoInPeace!.getPose());
    await box(page).click();
    await page.keyboard.type('wasdqe');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    expect(await page.evaluate(() => window.repoInPeace!.getPose())).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(box(page)).toHaveValue('');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.repoInPeace!.getSelection())).toEqual({ kind: 'file', path: 'app/components/voice/index.ts' });
  });
});

test.describe('layout and access', () => {
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test('at 1280 × 720, with the list and the detail panel open, no panel enters the middle third of the window', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.getByRole('button', { name: /List · / }).click();
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    await expect(page.getByRole('complementary', { name: 'Selected grave' })).toBeVisible();
    await page.waitForTimeout(900);
    const middle: Box = { x: 1280 / 3, y: 720 / 3, width: 1280 / 3, height: 720 / 3 };
    for (const selector of ['.stats', '.legend', '.search', '.list', '.detail', '.controls']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${selector} is on the page`).not.toBeNull();
      expect(overlaps(box!, middle), `${selector} ${JSON.stringify(box)} enters the middle third`).toBe(false);
    }
  });

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 900, height: 700 }]) {
    test(`at ${size.width} × ${size.height}, with every panel open: no two panels ever overlap, whichever side the details open on, and closing them restores the panels`, async ({ page }) => {
      await openScene(page, 'demo.oikosledger', size);
      // Every panel open: the stats panel, the legend and the list (they start collapsed below 1600 px).
      for (const toggle of [page.locator('.stats .panel-toggle'), page.locator('.legend .panel-toggle'), page.locator('.list .panel-toggle')]) {
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      }
      await page.mouse.move(size.width / 2, 5);
      const visible = async (): Promise<Array<{ name: string; box: Box }>> => {
        const out: Array<{ name: string; box: Box }> = [];
        for (const name of ['.stats', '.legend', '.search', '.list', '.detail', '.controls-buttons']) {
          const el = page.locator(name).first();
          if ((await el.count()) === 0 || !(await el.isVisible())) continue;
          out.push({ name, box: (await el.boundingBox())! });
        }
        return out;
      };
      const noOverlaps = async (what: string): Promise<void> => {
        const boxes = await visible();
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const [a, b] = [boxes[i]!, boxes[j]!];
            expect(overlaps(a.box, b.box), `${what}: ${a.name} ${JSON.stringify(a.box)} and ${b.name} ${JSON.stringify(b.box)} overlap`).toBe(false);
          }
        }
      };
      await noOverlaps('every panel open, nothing selected');

      // An item on the left half of the window: the details open on the right, and the legend folds to its header bar.
      const points = await page.evaluate((paths) => paths.map((p) => ({ p, at: window.repoInPeace!.getScreenPoint(p) })), oikos.files.map((f) => f.path));
      const inView = points.filter((x) => x.at && x.at.x > 0 && x.at.x < size.width && x.at.y > 0 && x.at.y < size.height) as Array<{ p: string; at: { x: number; y: number } }>;
      const leftItem = inView.reduce((a, b) => (b.at.x < a.at.x ? b : a));
      const rightItem = inView.reduce((a, b) => (b.at.x > a.at.x ? b : a));
      for (const [label, item, side, folded] of [
        ['left', leftItem, 'right', ['.legend']],
        ['right', rightItem, 'left', ['.stats', '.list']],
      ] as const) {
        await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), item.p);
        await expect(page.locator('.detail')).toHaveClass(new RegExp(`detail-${side}`));
        for (const panel of folded) await expect(page.locator(`${panel} .panel-toggle`)).toHaveAttribute('aria-expanded', 'false');
        await page.waitForTimeout(900); // a nudge, if any, has landed
        await noOverlaps(`an item on the ${label}, the details on the ${side}`);
        // Closing the details brings back what was open.
        await page.locator('.detail').getByRole('button', { name: 'Close' }).click();
        for (const panel of folded) await expect(page.locator(`${panel} .panel-toggle`)).toHaveAttribute('aria-expanded', 'true');
        await noOverlaps(`the details closed after the ${label} item`);
      }
    });
  }

  test('the legend\'s header, folded under the details, brings the legend back and closes the details', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.locator('.legend .panel-toggle').click();
    const at = await pointAt(page, 'app/components/voice/index.ts');
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('.detail')).toHaveClass(/detail-right/);
    await expect(page.locator('.legend .panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.legend .panel-toggle').click();
    await expect(page.locator('.detail')).toHaveCount(0);
    await expect(page.locator('.legend .panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('Bury and Resurrect look disabled: dimmed, dashed, a not-allowed cursor', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    const bury = page.locator('.detail').getByRole('button', { name: 'Bury' });
    const style = await bury.evaluate((el) => {
      const s = getComputedStyle(el);
      return { opacity: Number(s.opacity), cursor: s.cursor, border: s.borderTopStyle };
    });
    expect(style.opacity).toBeLessThan(0.6);
    expect(style.cursor).toBe('not-allowed');
    expect(style.border).toBe('dashed');
  });

  test('Tab reaches every control, each with a name and a visible focus ring', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.getByRole('button', { name: /List · / }).click();
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    await page.mouse.move(640, 8);
    const seen: string[] = [];
    const problems: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const labelled = el.getAttribute('aria-labelledby');
        const name = (el.getAttribute('aria-label') ?? (labelled ? document.getElementById(labelled)?.textContent : null) ?? el.textContent ?? el.getAttribute('title') ?? '').trim();
        const style = getComputedStyle(el);
        const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
        return { key: `${el.tagName}#${el.id}.${el.className}|${name}`, name, ring, tag: el.tagName };
      });
      if (info === null) continue;
      if (seen.includes(info.key)) break; // round the page once
      seen.push(info.key);
      if (info.name === '') problems.push(`${info.key}: no name`);
      if (!info.ring) problems.push(`${info.key}: no visible focus`);
    }
    expect(seen.length, seen.join('\n')).toBeGreaterThan(10);
    for (const want of ['Search graves by file name or path', 'Files and ghosts', 'Close', 'Bury', 'Reset view']) {
      expect(seen.some((k) => k.includes(want)), `Tab reaches "${want}"`).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  test('opening and closing the panels never moves the camera', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    const before = await page.evaluate(() => window.repoInPeace!.getPose());
    for (const name of [/List · /, /^Legend/, /oikos_ledger/]) {
      const toggle = page.getByRole('button', { name }).first();
      await toggle.click();
      await toggle.click();
    }
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.repoInPeace!.getPose())).toEqual(before);
  });
});

test.describe('signs in front of the grave in focus', () => {
  test.setTimeout(600_000); // every stone and ghost of both files

  for (const name of ['demo.oikosledger', 'demo.spatialql']) {
    test(`${name}: after flyTo for every stone and ghost, no sign board left showing is in front of it and over its face on screen`, async ({ page }) => {
      const data = name === 'demo.oikosledger' ? oikos : spatialql;
      const model = buildSceneModel(data);
      await openScene(page, name);
      await page.mouse.move(640, 5);
      const problems: string[] = [];
      let faded = 0;
      for (const target of model.pickTargets) {
        // flyTo sets the focus; the pose is then put in place at once (the same end pose), so the check does not wait for each flight.
        const end = flyView(model, target.path).pose;
        await page.evaluate(([p, pose]) => {
          window.repoInPeace!.flyTo(p as string);
          window.repoInPeace!.setPose(pose as CameraPose);
        }, [target.path, end] as const);
        await page.waitForTimeout(SIGN_FADE_SECONDS * 1000 + 200);
        const result = await page.evaluate(
          ({ box, plaques }) => {
            const api = window.repoInPeace!;
            const pose = api.getPose();
            const forward = (() => {
              const d = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
              const n = Math.hypot(d.x, d.y, d.z);
              return { x: d.x / n, y: d.y / n, z: d.z / n };
            })();
            const depthOf = (p: { x: number; y: number; z: number }) => (p.x - pose.position.x) * forward.x + (p.y - pose.position.y) * forward.y + (p.z - pose.position.z) * forward.z;
            const rect = (min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }) => {
              let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
              for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
                const s = api.projectPoint(x, y, z);
                if (s === null) return null;
                [x0, x1, y0, y1] = [Math.min(x0, s.x), Math.max(x1, s.x), Math.min(y0, s.y), Math.max(y1, s.y)];
              }
              return { x0, x1, y0, y1, depth: depthOf({ x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }) };
            };
            const face = rect(box.min, box.max);
            const fades = api.getSignFade();
            const covering: string[] = [];
            if (face !== null) {
              for (const p of plaques) {
                const r = rect(p.min, p.max);
                if (r === null || r.depth >= face.depth) continue;
                const over = r.x0 < face.x1 && face.x0 < r.x1 && r.y0 < face.y1 && face.y0 < r.y1;
                if (over && (fades[p.path] ?? 1) > 0.05) covering.push(p.path);
              }
            }
            return { covering, faded: Object.keys(fades).length, inView: face !== null };
          },
          { box: { min: target.min, max: target.max }, plaques: model.signSources.map((s) => ({ path: s.path, ...plaqueBox(s.x, s.z) })) },
        );
        faded += result.faded;
        if (!result.inView) problems.push(`${target.path}: not in view after the flight`);
        for (const p of result.covering) problems.push(`${target.path}: the sign of ${p} is in front of it and over its face`);
      }
      expect(problems).toEqual([]);
      if (name === 'demo.oikosledger') expect(faded, 'some sign faded on the way').toBeGreaterThan(0);
    });
  }

  test('the charts sign fades in front of charts/index.ts after a flight, and comes back when the focus moves on', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.evaluate(() => window.repoInPeace!.flyTo('app/components/charts/index.ts'));
    await expect.poll(async () => (await page.evaluate(() => window.repoInPeace!.getSignFade()))['app/components/charts'] ?? 1, { timeout: 4000 }).toBeLessThan(0.05);
    await page.evaluate(() => window.repoInPeace!.resetView());
    await expect.poll(async () => Object.keys(await page.evaluate(() => window.repoInPeace!.getSignFade())).length, { timeout: 4000 }).toBe(0);
  });
});
