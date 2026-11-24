import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { stoneSummary } from '../src/model/grave-facts';
import { expect, test, type Page } from './fixtures';

/**
 * The Usage row and the hover's "imported by N" (importers spec, P5). Most checks open a copy of the oikos demo with importers set by
 * hand (seven of them, one type-only), through "Open a graveyard file…", so the counts are known; the last reads the real demo.
 */

function withImporters(): { graveyard: Graveyard; hub: string; importers: string[]; dead: string; deadImporter: string } {
  const file = fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url));
  const graveyard = JSON.parse(readFileSync(file, 'utf8')) as Graveyard;
  const paths = graveyard.files.map((f) => f.path); // sorted by code point in the data
  const hub = graveyard.files.find((f) => !f.unused && !/\.(test|spec)\./.test(f.path) && f.path.startsWith('app/lib/'))!.path;
  const importers = paths.filter((p) => p !== hub && p.startsWith('app/components/')).slice(0, 7);
  const dead = 'app/components/voice/index.ts';
  const deadImporter = graveyard.files.find((f) => f.unused && f.path !== dead && !importers.includes(f.path))!.path;
  for (const f of graveyard.files) f.importedBy = [];
  graveyard.files.find((f) => f.path === hub)!.importedBy = importers.map((path, i) => (i === 1 ? { path, typeOnly: true } : { path }));
  graveyard.files.find((f) => f.path === dead)!.importedBy = [{ path: deadImporter }];
  return { graveyard, hub, importers, dead, deadImporter };
}

const data = withImporters();
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

async function openCopy(page: Page, size = { width: 1280, height: 720 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto('/?boot');
  await page.keyboard.press('KeyX'); // skips the typing
  await page.locator('input[type=file]').setInputFiles({ name: 'oikos-importers.graveyard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data.graveyard)) });
  await page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
}

async function selectAndWait(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.repoInPeace!.select({ kind: 'file', path: p });
    window.repoInPeace!.flyTo(p);
  }, path);
  await page.waitForTimeout(1800);
}

async function pointAt(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => window.repoInPeace!.flyTo(p), path);
  await page.waitForTimeout(1800);
  const at = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), path))!;
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
}

test.describe('the Usage row', () => {
  test('shows the count and the first 5 importers; "+2 more" shows the rest in place; "type only" on a type-only import', async ({ page }) => {
    await openCopy(page);
    await selectAndWait(page, data.hub);
    const usage = panel(page).locator('dt:text-is("Usage") + dd');
    await expect(usage.locator('.usage-text')).toHaveText('Imported by 7 files');
    const links = usage.locator('.usage-link');
    await expect(links).toHaveText(data.importers.slice(0, 5).map((p) => p.slice(p.lastIndexOf('/') + 1)));
    await expect(usage.locator('li').nth(1)).toContainText('· type only');
    await expect(usage.locator('li').nth(0)).not.toContainText('type only');
    await usage.getByRole('button', { name: '+2 more' }).click();
    await expect(links).toHaveCount(7);
    await expect(usage.getByRole('button', { name: /more$/ })).toHaveCount(0);
    // Another grave starts collapsed again.
    await selectAndWait(page, data.dead);
    await selectAndWait(page, data.hub);
    await expect(panel(page).locator('dt:text-is("Usage") + dd .usage-link')).toHaveCount(5);
  });

  test('clicking an importer selects it and flies the camera to it', async ({ page }) => {
    await openCopy(page);
    await selectAndWait(page, data.hub);
    const before = await page.evaluate(() => window.repoInPeace!.getPose());
    const target = data.importers[3]!;
    await panel(page).getByRole('button', { name: target.slice(target.lastIndexOf('/') + 1), exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.repoInPeace!.getSelection())).toEqual({ kind: 'file', path: target });
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => window.repoInPeace!.getPose());
    expect(after).not.toEqual(before);
    const at = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), target))!;
    const size = page.viewportSize()!;
    expect(at.x > 0 && at.x < size.width && at.y > 0 && at.y < size.height, `${target} on screen after the flight`).toBe(true);
    await expect(panel(page).locator('.detail-heading h2')).toHaveText(target.slice(target.lastIndexOf('/') + 1));
  });

  test('an unused file imported only by another unused file says so', async ({ page }) => {
    await openCopy(page);
    await selectAndWait(page, data.dead);
    const usage = panel(page).locator('dt:text-is("Usage") + dd');
    await expect(usage.locator('.usage-text')).toHaveText('Unused: only imported by other unused files');
    await expect(usage.locator('.usage-link')).toHaveText([data.deadImporter.slice(data.deadImporter.lastIndexOf('/') + 1)]);
  });
});

test.describe('the hover', () => {
  const hubFile = () => data.graveyard.files.find((f) => f.path === data.hub)!;

  test('adds "imported by 7" when the line fits, on one line', async ({ page }) => {
    await openCopy(page);
    await pointAt(page, data.hub);
    const summary = page.locator('.hover-summary');
    await expect(summary).toHaveText(`${stoneSummary(hubFile(), data.graveyard.meta)} · imported by 7`);
    expect((await summary.boundingBox())!.height, 'one line').toBeLessThan(24);
  });

  test('leaves it out when the line would not fit', async ({ page }) => {
    await openCopy(page, { width: 300, height: 640 });
    await pointAt(page, data.hub);
    await expect(page.locator('.hover-summary')).toHaveText(stoneSummary(hubFile(), data.graveyard.meta));
  });

  test('says nothing more for a stone with no importers', async ({ page }) => {
    await openCopy(page);
    const plain = data.graveyard.files.find((f) => f.path.startsWith('app/') && f.importedBy!.length === 0 && !f.unused)!;
    await pointAt(page, plain.path);
    await expect(page.locator('.hover-summary')).toHaveText(stoneSummary(plain, data.graveyard.meta));
  });
});

test.describe('the real oikos demo', () => {
  test('the dead chain: DashboardClient is unused, and the two files only it imports say so, with a link to it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
    const usage = panel(page).locator('dt:text-is("Usage") + dd');
    for (const path of ['app/components/bank_accounts/BankAccountsSection.tsx', 'app/components/transactions/TransactionList.tsx']) {
      await selectAndWait(page, path);
      await expect(usage.locator('.usage-text')).toHaveText('Unused: only imported by other unused files');
      await expect(usage.locator('.usage-link')).toHaveText(['DashboardClient.tsx']);
    }
    await usage.getByRole('button', { name: 'DashboardClient.tsx' }).click();
    await expect.poll(() => page.evaluate(() => window.repoInPeace!.getSelection())).toEqual({ kind: 'file', path: 'app/components/dashboard/DashboardClient.tsx' });
    await expect(usage.locator('.usage-text')).toHaveText('Unused: nothing in the project imports it (Knip)');
  });
});
