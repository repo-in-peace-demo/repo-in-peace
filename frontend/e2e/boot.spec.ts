import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The boot screen, the digging screen and the way between them and the scene (interface spec, Req 1 to 3, and task 6.5: leaving a
 * scene frees its GPU resources). Uses `./fixtures`, so the scene opens without its opening move and can be measured at once.
 */

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8');
const sceneUp = (page: Page) => page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
const boot = (page: Page) => page.getByRole('main', { name: 'Repo In Peace' });

async function skipTyping(page: Page): Promise<void> {
  await expect(boot(page)).toContainText('RIP/OS');
  await page.keyboard.press('KeyX'); // not Space or Enter: once the choices show, those would choose the focused one
  await expect(page.getByRole('button', { name: /oikos_ledger/ })).toBeVisible({ timeout: 2000 });
}

test('a bare address shows the boot screen; a key shows it all, and Enter opens the first demo, through the digging screen', async ({ page }) => {
  // Slow the data file a little, so the digging screen can be seen with its counts.
  await page.route('**/graveyards/demo.oikosledger.graveyard.json', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto('/');
  await expect(boot(page)).toContainText('RIP/OS');
  await expect(boot(page)).not.toContainText(/sgi|irix|fsn/i);
  await page.keyboard.press('KeyX'); // skips the typing, chooses nothing
  const first = page.getByRole('button', { name: /oikos_ledger — 129 files/ });
  await expect(first).toBeFocused({ timeout: 2000 });
  await expect(page.getByRole('button', { name: /spatialql — 120 files, 2 ghosts/ })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?graveyard=demo\.oikosledger$/);
  await expect(page.getByRole('main', { name: 'Opening the graveyard' })).toContainText('exhuming 129 graves', { timeout: 3000 });
  await sceneUp(page);
});

test('under reduced motion the boot text is there at once, with the choices', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /oikos_ledger/ })).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('main', { name: 'Repo In Peace' })).toContainText('Choose a graveyard');
  await context.close();
});

test('a file from disk opens without changing the address; an old version is refused on the boot screen', async ({ page }) => {
  await page.goto('/');
  await skipTyping(page);
  const v1 = JSON.parse(read('demo.spatialql'));
  v1.meta.schemaVersion = 1;
  await page.locator('input[type=file]').setInputFiles({ name: 'old.graveyard.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('schema version 1');
  await expect(notice).toContainText('reads version 2');
  await expect(boot(page)).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({ name: 'mine.graveyard.json', mimeType: 'application/json', buffer: Buffer.from(read('demo.spatialql')) });
  await sceneUp(page);
  expect(new URL(page.url()).search).toBe('');
});

test('Back from a scene returns to the boot screen, and a ?graveyard= link skips it', async ({ page }) => {
  await page.goto('/');
  await skipTyping(page);
  await page.getByRole('button', { name: /spatialql/ }).click();
  await sceneUp(page);
  await page.goBack();
  await expect(boot(page)).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);

  await page.goto('/?graveyard=demo.oikosledger');
  await sceneUp(page);
  await expect(boot(page)).toHaveCount(0);
});

test('a refused name shows the message and a way back to the boot screen, with no request for it', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto('/?graveyard=..%2Fsecret');
  await expect(page.getByRole('alert')).toContainText('is not allowed');
  expect(requested.some((u) => u.includes('secret'))).toBe(false);
  await page.getByRole('button', { name: 'Back to the graveyards' }).click();
  await expect(boot(page)).toBeVisible();
});

test('switching between the two demos five times frees each scene: the same GPU counts on every visit, one canvas, no lost context on a live scene', async ({ page }) => {
  // Every canvas reports a lost context with the phase the test is in. Leaving a scene loses its context on purpose (R3F's teardown
  // calls forceContextLoss so the browser's cap on live contexts is never reached); a loss while a scene is live is a failure.
  await page.addInitScript(() => {
    const w = window as unknown as { __phase: string; __lost: string[] };
    w.__phase = 'live';
    w.__lost = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (!this.dataset.watched) {
        this.dataset.watched = '1';
        this.addEventListener('webglcontextlost', () => w.__lost.push(w.__phase));
      }
      return original.apply(this, args) as ReturnType<typeof original>;
    } as typeof original;
  });
  const setPhase = (phase: string) => page.evaluate((p) => ((window as unknown as { __phase: string }).__phase = p), phase);
  const counts: Record<string, string[]> = { spatialql: [], oikos_ledger: [] };

  await page.goto('/');
  for (let visit = 0; visit < 5; visit++) {
    for (const repo of ['spatialql', 'oikos_ledger'] as const) {
      await skipTyping(page);
      await page.getByRole('button', { name: new RegExp(repo) }).click();
      await sceneUp(page);
      await page.waitForTimeout(1500); // a few frames, so everything is uploaded
      await setPhase('live');
      expect(await page.locator('canvas').count(), 'one canvas at a time').toBe(1);
      const info = await page.evaluate(() => window.repoInPeace!.getRenderInfo());
      counts[repo]!.push(`${info.geometries} geometries, ${info.textures} textures`);
      await setPhase('leaving');
      await page.getByRole('button', { name: '← Graveyards' }).click();
      await expect(boot(page)).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
    }
  }
  for (const [repo, seen] of Object.entries(counts)) expect(new Set(seen).size, `${repo}: ${seen.join(' | ')}`).toBe(1);
  const lost = await page.evaluate(() => (window as unknown as { __lost: string[] }).__lost);
  expect(lost.filter((phase) => phase === 'live'), 'a lost WebGL context while a scene was showing').toEqual([]);
});
