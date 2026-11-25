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

/** The digging screen's beat is off for the other checks (`./fixtures`); these look at it, so they turn it back on. */
const withDigHold = (page: Page) =>
  page.addInitScript(() => {
    window.__repoInPeaceNoDigHold = false;
  });
const digging = (page: Page) => page.getByRole('main', { name: 'Opening the graveyard' });

test('?boot shows the boot screen (the bare address is the landing page, landing.spec.ts); a key shows it all, and Enter opens the first demo, through the digging screen with its real counts', async ({ page }) => {
  await withDigHold(page);
  await page.goto('/?boot');
  await expect(boot(page)).toContainText('RIP/OS');
  await expect(boot(page)).not.toContainText(/sgi|irix|fsn/i);
  await page.keyboard.press('KeyX'); // skips the typing, chooses nothing
  const first = page.getByRole('button', { name: /oikos_ledger — 129 files/ });
  await expect(first).toBeFocused({ timeout: 2000 });
  await expect(page.getByRole('button', { name: /spatialql — 120 files, 2 ghosts/ })).toBeVisible();
  expect(new URL(page.url()).search).toBe('?boot');
  const chosen = Date.now();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?graveyard=demo\.oikosledger$/);
  // No delayed network: the beat alone keeps the screen up long enough to read its lines as they type.
  await expect(digging(page)).toContainText('exhuming 129 graves');
  await expect(digging(page)).toContainText('12 lie Unused', { timeout: 1500 });
  await expect(digging(page)).toContainText('raising the fences', { timeout: 1500 });
  await sceneUp(page);
  expect(Date.now() - chosen, 'the digging screen held its beat').toBeGreaterThanOrEqual(1700);
});

test('any key or click skips the digging screen at once', async ({ page }) => {
  await withDigHold(page);
  for (const skip of ['key', 'click'] as const) {
    await page.goto('/?boot');
    await page.keyboard.press('KeyX');
    await page.getByRole('button', { name: /spatialql/ }).waitFor();
    const chosen = Date.now();
    await page.getByRole('button', { name: /spatialql/ }).click();
    await expect(digging(page)).toBeVisible();
    await page.waitForTimeout(300);
    if (skip === 'key') await page.keyboard.press('Space');
    else await page.mouse.click(640, 400);
    // The skip decides when the digging screen leaves (the model is built by then); drawing the scene after it (shaders, the first
    // frames) is not part of the beat and is slow under load, so the time is taken when the digging screen goes.
    await expect(digging(page)).toHaveCount(0, { timeout: 5000 });
    expect(Date.now() - chosen, `a ${skip} skipped the rest of the beat`).toBeLessThan(1500);
    await sceneUp(page);
  }
});

test('under reduced motion the digging lines are there at once, and the screen holds for a shorter beat', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__repoInPeaceNoOpening = true;
  });
  await page.goto('/?boot');
  await page.getByRole('button', { name: /oikos_ledger/ }).waitFor();
  const chosen = Date.now();
  await page.getByRole('button', { name: /oikos_ledger/ }).click();
  await expect(page.getByRole('main', { name: 'Opening the graveyard' })).toContainText('raising the fences', { timeout: 300 });
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  const took = Date.now() - chosen;
  expect(took).toBeGreaterThanOrEqual(550);
  expect(took).toBeLessThan(1700);
  await context.close();
});

test('under reduced motion the boot text is there at once, with the choices', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/?boot');
  await expect(page.getByRole('button', { name: /oikos_ledger/ })).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('main', { name: 'Repo In Peace' })).toContainText('Choose a graveyard');
  await context.close();
});

test('a file from disk opens without changing the address; an old version is refused on the boot screen', async ({ page }) => {
  await page.goto('/?boot');
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
  expect(new URL(page.url()).search).toBe('?boot');
});

test('Back from a scene returns to the boot screen, and a ?graveyard= link skips it', async ({ page }) => {
  await page.goto('/?boot');
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
  // The page's own address holds the name; what must not happen is a request for a data file (none at all for a refused name).
  expect(requested.filter((u) => new URL(u).pathname.includes('/graveyards/') && u.endsWith('.graveyard.json')), 'data files requested').toEqual([]);
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

  await page.goto('/?boot');
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

test('the marker is on the first demo at first, moves with Up and Down and with the pointer, and is always where the focus is', async ({ page }) => {
  await page.goto('/?boot');
  await skipTyping(page);
  const choices = page.locator('[data-choice]');
  await expect(choices).toHaveCount(3); // two demos and the file choice
  const marked = page.locator('.terminal-choice-active');
  const agree = async (index: number): Promise<void> => {
    await expect(marked).toHaveCount(1);
    await expect(choices.nth(index)).toHaveClass(/terminal-choice-active/);
    await expect(choices.nth(index)).toBeFocused();
  };
  await agree(0);
  await page.keyboard.press('ArrowDown');
  await agree(1);
  await page.keyboard.press('ArrowDown');
  await agree(2);
  await page.keyboard.press('ArrowDown'); // round to the top
  await agree(0);
  await page.keyboard.press('ArrowUp');
  await agree(2);
  await choices.nth(1).hover();
  await agree(1);
  await page.keyboard.press('Shift+Tab');
  await agree(0);
  await page.keyboard.press('Enter'); // the marked one opens
  await expect(page).toHaveURL(/\?graveyard=demo\.oikosledger$/);
});

test('under Open a graveyard file, a hint links to the README section on analysing your own repo', async ({ page }) => {
  await page.goto('/?boot');
  await skipTyping(page);
  const link = page.getByRole('link', { name: 'Analyse your own repo' });
  await expect(link).toHaveAttribute('href', 'https://github.com/sl2902/repo-in-peace#analyse-your-own-repo');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(boot(page)).toContainText('No file yet? Outside a full clone of your repo (with its dependencies installed), run npx repo-in-peace path/to/your-repo --out your-repo.graveyard.json, then open the file here. Analyse your own repo.');
});
