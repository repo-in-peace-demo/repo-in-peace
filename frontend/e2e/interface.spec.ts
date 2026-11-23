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
import { blockersOf, faceOf, sceneOccluders } from '../src/model/clear-view';
import { EULOGY_MODEL, GHOST_EPITAPH, MARKUP_EULOGY, STONE_EPITAPH, eulogyGraveyard, openEulogyFile } from './eulogy-file';

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

  test('a click on a stone opens it with the stone\'s facts in words, its eulogy and Bury on an unused stone', async ({ page }) => {
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
    // The demo has eulogies: the stone's own, with its model's credit (or "Words failed us" when it was left empty).
    if (voice.eulogy !== '') {
      await expect(panel(page).locator('figure.detail-epitaph blockquote')).toHaveText(voice.eulogy);
      await expect(panel(page).locator('figure.detail-epitaph figcaption')).toHaveText(`written by ${oikos.meta.eulogyModel}`);
    } else {
      await expect(panel(page).locator('.detail-eulogy-empty')).toHaveText('Words failed us for this one.');
    }
    const bury = panel(page).getByRole('button', { name: 'Bury' });
    // The dev server runs the PR function with fake pull requests, so on a demo Bury is offered (bury-and-resurrect spec).
    await expect(bury).toBeVisible();
    await expect(bury).not.toHaveAttribute('aria-disabled', 'true');
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
    await expect(panel(page).getByRole('button', { name: 'Resurrect' })).toBeVisible();
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

  test('exact file-name matches come first; Enter selects the top result, flies to it, clears the box and gives the keys back to the scene', async ({ page }) => {
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
    // Done searching: the box is empty, closed and not focused.
    await expect(box(page)).toHaveValue('');
    await expect(box(page)).not.toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Results' })).toHaveCount(0);
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => window.repoInPeace!.getPose());
    expect(Math.hypot(after.target.x - before.target.x, after.target.z - before.target.z), 'it flew').toBeGreaterThan(1);
    // The keyboard is the scene's again: W flies the camera.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    const flown = await page.evaluate(() => window.repoInPeace!.getPose());
    expect(Math.hypot(flown.position.x - after.position.x, flown.position.z - after.position.z), 'W moves the camera').toBeGreaterThan(0.2);
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

  // Panel rules: every panel starts collapsed; opening one closes any open panel it would overlap; nothing ever overlaps, the Controls
  // panel and the detail panel included; closing the details reopens nothing.
  const PANEL_PARTS = ['.stats', '.legend', '.search', '.list', '.detail', '.controls-help', '.controls-buttons'];
  const TOGGLES = { stats: '.stats .panel-toggle', legend: '.legend .panel-toggle', list: '.list .panel-toggle', controls: '.controls-buttons button[aria-controls="controls-help"]' } as const;
  type PanelName = keyof typeof TOGGLES;
  const isOpen = async (page: Page, name: PanelName) => (await page.locator(TOGGLES[name]).getAttribute('aria-expanded')) === 'true';
  async function openPanel(page: Page, name: PanelName): Promise<void> {
    if (!(await isOpen(page, name))) await page.locator(TOGGLES[name]).click();
    await expect(page.locator(TOGGLES[name])).toHaveAttribute('aria-expanded', 'true');
  }
  /** The first two panels that overlap now, or '' when none do. */
  async function firstOverlap(page: Page): Promise<string> {
    const boxes: Array<{ name: string; box: Box }> = [];
    for (const name of PANEL_PARTS) {
      const el = page.locator(name).first();
      if ((await el.count()) === 0 || !(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (box) boxes.push({ name, box });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        if (overlaps(a.box, b.box)) return `${a.name} ${JSON.stringify(a.box)} and ${b.name} ${JSON.stringify(b.box)} overlap`;
      }
    }
    return '';
  }
  /** Once the panels have settled (the list's check waits two frames, which can be slow with software rendering), nothing overlaps. */
  async function noOverlaps(page: Page, what: string): Promise<void> {
    await expect.poll(() => firstOverlap(page), { message: what, timeout: 5000 }).toBe('');
  }

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 900, height: 700 }]) {
    test(`at ${size.width} × ${size.height}: every panel starts collapsed`, async ({ page }) => {
      await openScene(page, 'demo.oikosledger', size);
      for (const name of Object.keys(TOGGLES) as PanelName[]) expect(await isOpen(page, name), `${name} starts collapsed`).toBe(false);
      await expect(page.locator('.controls-help')).toHaveCount(0);
      await noOverlaps(page, 'on launch');
    });

    test(`at ${size.width} × ${size.height}: opening a panel closes any open panel it overlaps, and no two panels ever overlap, the Controls panel and the details included`, async ({ page }) => {
      await openScene(page, 'demo.oikosledger', size);
      await page.mouse.move(size.width / 2, 5);
      // Open each in turn: after each, it is open, and whatever it overlapped has closed.
      for (const name of ['stats', 'legend', 'list', 'controls', 'stats', 'list'] as PanelName[]) {
        await openPanel(page, name);
        expect(await isOpen(page, name), `${name} stays open after opening`).toBe(true);
        await noOverlaps(page, `after opening ${name}`);
      }
      // The Controls panel and the list share the bottom left: opening the Controls closes the list, at every size.
      await openPanel(page, 'list');
      await openPanel(page, 'controls');
      expect(await isOpen(page, 'list'), 'the list closed as the Controls opened').toBe(false);
      await noOverlaps(page, 'the Controls opened over the list');

      // The details close what they overlap on their side, and closing them reopens nothing.
      const points = await page.evaluate((paths) => paths.map((p) => ({ p, at: window.repoInPeace!.getScreenPoint(p) })), oikos.files.map((f) => f.path));
      const inView = points.filter((x) => x.at && x.at.x > 0 && x.at.x < size.width && x.at.y > 0 && x.at.y < size.height) as Array<{ p: string; at: { x: number; y: number } }>;
      const leftItem = inView.reduce((a, b) => (b.at.x < a.at.x ? b : a));
      const rightItem = inView.reduce((a, b) => (b.at.x > a.at.x ? b : a));
      for (const [label, item, side, there] of [
        ['left', leftItem, 'right', ['legend']],
        ['right', rightItem, 'left', ['stats', 'list', 'controls']],
      ] as const) {
        for (const name of there) await openPanel(page, name);
        await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), item.p);
        await expect(page.locator('.detail')).toHaveClass(new RegExp(`detail-${side}`));
        await page.waitForTimeout(900); // a nudge, if any, has landed
        await noOverlaps(page, `an item on the ${label}, the details on the ${side}`);
        await expect(page.locator('.detail'), 'the details stay open: panels opened before them never close them').toBeVisible();
        const after = await Promise.all(there.map((n) => isOpen(page, n)));
        await page.locator('.detail').getByRole('button', { name: 'Close' }).click();
        await page.waitForTimeout(300);
        expect(await Promise.all(there.map((n) => isOpen(page, n))), 'closing the details reopens nothing').toEqual(after);
        await noOverlaps(page, `the details closed after the ${label} item`);
      }
    });
  }

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 900, height: 700 }]) {
    test(`at ${size.width} × ${size.height}: the details never appear over an open legend or stats panel, even for a moment, on either side`, async ({ page }) => {
      await openScene(page, 'demo.oikosledger', size);
      await page.mouse.move(size.width / 2, 5);
      const points = await page.evaluate((paths) => paths.map((p) => ({ p, at: window.repoInPeace!.getScreenPoint(p) })), oikos.files.map((f) => f.path));
      const inView = points.filter((x) => x.at && x.at.x > 0 && x.at.x < size.width && x.at.y > 0 && x.at.y < size.height) as Array<{ p: string; at: { x: number; y: number } }>;
      const leftItem = inView.reduce((a, b) => (b.at.x < a.at.x ? b : a));
      const rightItem = inView.reduce((a, b) => (b.at.x > a.at.x ? b : a));
      for (const [label, item] of [['on the left (details on the right)', leftItem], ['on the right (details on the left)', rightItem]] as const) {
        // The legend first, then the stats panel (they don't overlap each other), then a grave chosen as the list and search do:
        // selected and flown to, so the details appear while the camera is still moving.
        await openPanel(page, 'legend');
        await openPanel(page, 'stats');
        await page.evaluate((p) => {
          window.repoInPeace!.select({ kind: 'file', path: p });
          window.repoInPeace!.flyTo(p);
        }, item.p);
        await page.locator('.detail').waitFor({ state: 'visible' });
        // The first moment the details are on the page: one look, no waiting for things to settle.
        expect(await firstOverlap(page), `a grave ${label}, the moment the details appear`).toBe('');
        await page.waitForTimeout(400);
        expect(await firstOverlap(page), `a grave ${label}, during the flight`).toBe('');
        await page.locator('.detail').getByRole('button', { name: 'Close' }).click();
        await page.waitForTimeout(1600); // the flight has landed
      }
    });
  }

  test('the list shows its rows from the top when it opens again after the details closed it', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.locator('.list .panel-toggle').click();
    const rowsBox = page.getByRole('listbox', { name: 'Files and ghosts' });
    await expect(rowsBox).toBeVisible();
    const firstName = sortRows(buildRows(oikos), 'decay')[0]!.name;
    const points = await page.evaluate((paths) => paths.map((p) => ({ p, at: window.repoInPeace!.getScreenPoint(p) })), oikos.files.map((f) => f.path));
    const right = (points.filter((x) => x.at && x.at.x < 1280 && x.at.y > 0 && x.at.y < 720) as Array<{ p: string; at: { x: number; y: number } }>).reduce((a, b) => (b.at.x > a.at.x ? b : a));
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'file', path: p }), right.p);
    await expect(page.locator('.detail')).toHaveClass(/detail-left/);
    await expect(rowsBox).toHaveCount(0); // the details, on the left, closed the list
    await expect(page.locator('.detail')).toBeVisible(); // and the list's own (later) check did not close the details
    await page.locator('.detail').getByRole('button', { name: 'Close' }).click();
    await expect(rowsBox).toHaveCount(0); // and closing them doesn't reopen it
    await page.locator('.list .panel-toggle').click();
    await expect(rowsBox).toBeVisible();
    const rows = rowsBox.locator('[role=option]');
    await expect.poll(() => rows.count(), { message: 'rows drawn' }).toBeGreaterThan(5);
    await expect(rows.first().locator('.list-name')).toHaveText(firstName);
  });

  test('at 1280 × 720 opening the list closes the open stats panel and the list has room for 8 rows; at 1920 × 1080 both stay open', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.locator('.stats .panel-toggle').click();
    await expect(page.locator('.stats .panel-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.list .panel-toggle').click();
    await expect(page.locator('.stats .panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    const listbox = page.getByRole('listbox', { name: 'Files and ghosts' });
    await expect.poll(async () => (await listbox.boundingBox())!.height / 30, { message: 'rows the list has room for', timeout: 3000 }).toBeGreaterThanOrEqual(8);

    await openScene(page, 'demo.oikosledger', { width: 1920, height: 1080 });
    await page.locator('.stats .panel-toggle').click();
    await page.locator('.list .panel-toggle').click();
    await page.waitForTimeout(1500); // the list's check waits two frames
    await expect(page.locator('.stats .panel-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.list .panel-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('list rows cut the name and folder with an ellipsis before the tags, never under them', async ({ page }) => {
    await openScene(page, 'demo.oikosledger');
    await page.locator('.list .panel-toggle').click();
    const rows = page.getByRole('listbox', { name: 'Files and ghosts' }).locator('[role=option]');
    await expect.poll(() => rows.count()).toBeGreaterThan(5);
    const problems = await rows.evaluateAll((els) =>
      els.flatMap((row) => {
        const r = (sel: string) => row.querySelector(sel)?.getBoundingClientRect();
        const [name, folder, marks, box] = [r('.list-name'), r('.list-folder'), r('.list-marks'), row.getBoundingClientRect()];
        const out: string[] = [];
        if (name && marks && name.right > marks.left + 0.5) out.push(`name under tags: ${row.textContent}`);
        if (folder && marks && folder.width > 0 && folder.right > marks.left + 0.5) out.push(`folder under tags: ${row.textContent}`);
        if (marks && marks.right > box.right + 0.5) out.push(`tags cut off: ${row.textContent}`);
        return out;
      }),
    );
    expect(problems).toEqual([]);
  });

  test('opening the legend over the details closes the details (the panel rule, the other way round)', async ({ page }) => {
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

  test('Bury and Resurrect look disabled where pull requests are unavailable: dimmed, dashed, a not-allowed cursor', async ({ page }) => {
    // The dev server offers fake pull requests on the demos, so the buttons are live there; with the PR function unreachable they
    // are disabled (bury-and-resurrect Req 1.4), which is the look this checks.
    await page.route('**/api/pr', (route) => route.abort());
    await openScene(page, 'demo.oikosledger');
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    const bury = page.locator('.detail').getByRole('button', { name: 'Bury' });
    await expect(bury).toHaveAttribute('aria-disabled', 'true');
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
    // The details stay hidden (and can't take focus) until they are placed on their side, a frame later.
    await expect(page.getByRole('complementary', { name: 'Selected grave' })).toBeVisible();
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

test.describe('nothing in the way of the grave in focus', () => {
  test.setTimeout(600_000); // every stone and ghost of both files

  for (const name of ['demo.oikosledger', 'demo.spatialql']) {
    test(`${name}: after flyTo for every stone and ghost, nothing left showing is in the way of its face: no stone, fence or sign board, and no sign label over it`, async ({ page }) => {
      const data = name === 'demo.oikosledger' ? oikos : spatialql;
      const model = buildSceneModel(data);
      await openScene(page, name);
      await page.mouse.move(640, 5);
      const problems: string[] = [];
      let faded = 0;
      let stillInTheWay = 0;
      const occluders = sceneOccluders(model);
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
        // Nothing else in the way either: every stone, fence post or rail and sign board that cuts a line from the real camera to the
        // face has faded out of the way.
        const camera = (await page.evaluate(() => window.repoInPeace!.getPose())).position;
        const blockers = blockersOf(camera, faceOf(model, target.path)!, occluders);
        if (blockers.length > 0) {
          const fades = await page.evaluate(() => ({ ...window.repoInPeace!.getObstructionFade(), signs: window.repoInPeace!.getSignFade() }));
          for (const b of blockers) {
            const alpha = (b.kind === 'stone' ? fades.stones : b.kind === 'fence' ? fades.fences : fades.signs)[b.id] ?? 1;
            if (alpha > 0.05) problems.push(`${target.path}: ${b.kind} ${b.id} is in the way and showing (opacity ${alpha.toFixed(2)})`);
          }
          stillInTheWay += blockers.length;
        }
      }
      expect(problems).toEqual([]);
      // flyTo chooses views with nothing in the way: what is left to fade is a few stones of spatialql's crowded rows at most.
      expect(stillInTheWay, 'boxes still in the way after the flights (all faded)').toBeLessThan(model.pickTargets.length * 0.05);
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

test('a click on a search result also clears the box and gives the keys back to the scene', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
  const box = page.getByRole('combobox', { name: 'Search graves by file name or path' });
  await page.keyboard.press('/');
  await page.keyboard.type('voice');
  await page.getByRole('listbox', { name: 'Results' }).getByRole('option').first().click();
  await expect(box).toHaveValue('');
  await expect(box).not.toBeFocused();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.repoInPeace!.getPose());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  const flown = await page.evaluate(() => window.repoInPeace!.getPose());
  expect(Math.hypot(flown.position.x - after.position.x, flown.position.z - after.position.z), 'W moves the camera').toBeGreaterThan(0.2);
});

test.describe('the epitaph', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

  test('a stone and a ghost show their epitaph and its credit; a grave left empty says words failed; markup shows as text', async ({ page }) => {
    const { graveyard, stone, ghost, empty, markup } = eulogyGraveyard();
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEulogyFile(page, graveyard);
    const select = (kind: 'file' | 'ghost', path: string) => page.evaluate(([k, p]) => window.repoInPeace!.select({ kind: k as 'file' | 'ghost', path: p! }), [kind, path]);
    const epitaph = panel(page).locator('figure.detail-epitaph');

    await select('file', stone);
    await expect(epitaph.locator('blockquote')).toHaveText(STONE_EPITAPH);
    await expect(epitaph.locator('figcaption')).toHaveText(`written by ${EULOGY_MODEL}`);
    await expect(panel(page).locator('.detail-eulogy-empty')).toHaveCount(0);

    await select('ghost', ghost);
    await expect(epitaph.locator('blockquote')).toHaveText(GHOST_EPITAPH);
    await expect(epitaph.locator('figcaption')).toHaveText(`written by ${EULOGY_MODEL}`);

    await select('file', empty);
    await expect(epitaph).toHaveCount(0);
    await expect(panel(page).locator('.detail-eulogy-empty')).toHaveText('Words failed us for this one.');

    await select('file', markup);
    await expect(epitaph.locator('blockquote')).toHaveText(MARKUP_EULOGY);
    await expect(epitaph.locator('b')).toHaveCount(0);
  });

  test('a file without eulogies says none were written, and shows no credit', async ({ page }) => {
    const { graveyard } = eulogyGraveyard();
    delete graveyard.meta.eulogyModel;
    for (const f of graveyard.files) f.eulogy = '';
    for (const g of graveyard.ghosts) delete g.eulogy;
    await openEulogyFile(page, graveyard);
    await page.evaluate((p) => window.repoInPeace!.select({ kind: 'ghost', path: p }), graveyard.ghosts[0]!.path);
    await expect(panel(page).locator('.detail-eulogy-empty')).toHaveText('No eulogies were written for this graveyard.');
    await expect(panel(page).locator('figure.detail-epitaph')).toHaveCount(0);
  });
});

test.describe('panels that scroll inside, and the search placeholder', () => {
  /** The data-more mark, and whether the element really has more below (worked out in the page). */
  const fadeState = (page: Page, selector: string) =>
    page.locator(selector).first().evaluate((el) => ({ more: (el as HTMLElement).dataset['more'], really: el.scrollHeight - el.scrollTop - el.clientHeight > 1 }));
  const scrollToEnd = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

  for (const [name, selector, size, open] of [
    ['the Controls panel', '.controls-help', { width: 1280, height: 720 }, (page: Page) => page.getByRole('button', { name: 'Show or hide the controls' }).click()],
    ['the list', '.list-rows', { width: 1280, height: 720 }, (page: Page) => page.locator('.list .panel-toggle').click()],
    ['the legend', '#legend-body', { width: 900, height: 700 }, (page: Page) => page.locator('.legend .panel-toggle').click()],
  ] as const) {
    test(`${name} fades at its bottom edge while there is more below, and not at the end`, async ({ page }) => {
      await openScene(page, 'demo.oikosledger', size);
      await open(page);
      await expect.poll(() => fadeState(page, selector)).toEqual({ more: 'true', really: true });
      // The fade has a 0.15 s transition: wait for it (a rule that never applied would stay at 0 and fail here).
      const fade = () => page.locator(selector).first().evaluate((el) => getComputedStyle(el, '::after').opacity);
      await expect.poll(fade).toBe('1');
      await scrollToEnd(page, selector);
      await expect.poll(() => fadeState(page, selector)).toEqual({ more: 'false', really: false });
      await expect.poll(fade).toBe('0');
    });
  }

  test('a panel with nothing hidden shows no fade (the legend at 1920 × 1080, the details)', async ({ page }) => {
    await openScene(page, 'demo.oikosledger', { width: 1920, height: 1080 });
    await page.locator('.legend .panel-toggle').click();
    await expect.poll(() => fadeState(page, '#legend-body')).toEqual({ more: 'false', really: false });
    await page.evaluate(() => window.repoInPeace!.select({ kind: 'file', path: 'app/components/voice/index.ts' }));
    await expect(page.locator('.detail')).toBeVisible();
    const detail = await fadeState(page, '.detail');
    expect(detail.more).toBe(String(detail.really)); // the mark always says what is true
  });

  test('the search box says "Search (/)" where the full placeholder does not fit, and the full one where it does', async ({ page }) => {
    await openScene(page, 'demo.oikosledger', { width: 900, height: 700 });
    const box = page.getByRole('combobox', { name: 'Search graves by file name or path' });
    await expect(box).toHaveAttribute('placeholder', 'Search (/)');
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(box).toHaveAttribute('placeholder', 'Search graves (/)');
  });
});
