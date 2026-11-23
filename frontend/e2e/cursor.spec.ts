import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures';

/** The scene's skeleton-hand cursor (model/scene-cursor.ts, index.css): three states on the canvas only, with standard fallbacks. */
const OUT = fileURLToPath(new URL('../test-results/screenshots/', import.meta.url));
const canvas = (page: Page) => page.locator('.scene canvas');
const cursorOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).cursor);

test('points over the scene, glows over a stone, grabs while dragging; panels keep standard cursors', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.mouse.move(640, 200); // sky
  await expect(canvas(page)).toHaveAttribute('data-cursor', 'point');
  expect(await cursorOf(page, '.scene canvas')).toMatch(/hand-32\.svg.*hand-64\.svg.*default|hand-32\.svg.*default/);

  await page.evaluate(() => window.repoInPeace!.flyTo('app/components/voice/index.ts'));
  await page.waitForTimeout(1800);
  const at = (await page.evaluate(() => window.repoInPeace!.getScreenPoint('app/components/voice/index.ts')))!;
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(canvas(page)).toHaveAttribute('data-cursor', 'over');
  expect(await cursorOf(page, '.scene canvas')).toMatch(/hand-over-32\.svg.*pointer/);

  await page.mouse.down();
  await page.mouse.move(at.x + 80, at.y + 10, { steps: 6 });
  await expect(canvas(page)).toHaveAttribute('data-cursor', 'grab');
  expect(await cursorOf(page, '.scene canvas')).toMatch(/hand-grab-32\.svg.*grabbing/);
  await page.mouse.up();
  await expect(canvas(page)).not.toHaveAttribute('data-cursor', 'grab');

  expect(await cursorOf(page, '.legend .panel-toggle')).toBe('pointer');
  expect(await cursorOf(page, '.search-input')).not.toMatch(/hand/);
});

test('the six cursor pictures load', async ({ page }) => {
  for (const name of ['hand', 'hand-over', 'hand-grab']) {
    for (const size of [32, 64]) {
      const r = await page.request.get(`/cursors/${name}-${size}.svg`);
      expect(r.status(), `${name}-${size}`).toBe(200);
      expect(await r.text()).toContain(`width="${size}"`);
    }
  }
});

test('the Controls panel shows the three hands; the legend does not', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Show or hide the controls' }).click();
  await expect(page.locator('.controls-cursors img')).toHaveCount(3);
  await page.locator('.legend .panel-toggle').click();
  await expect(page.locator('.legend img, .legend [src*="cursors"]')).toHaveCount(0);
});

test('screenshot: the cursors, large, on the night sky and on the moon', async ({ page }) => {
  test.skip(!process.env['SCREENSHOTS'], 'screenshots only with SCREENSHOTS=1');
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 720, height: 260 });
  await page.goto('/'); // an HTML page on this origin, so the pictures' paths resolve
  const cell = (bg: string) =>
    ['hand-32', 'hand-over-32', 'hand-grab-32', 'hand-64', 'hand-over-64', 'hand-grab-64']
      .map((n) => `<div style="background:${bg};padding:12px;display:inline-block"><img src="/cursors/${n}.svg" style="image-rendering:pixelated"></div>`)
      .join('');
  await page.setContent(`<body style="margin:0;background:#111"><div>${cell('#0b1020')}</div><div>${cell('#c4d2e6')}</div></body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}cursors.png` });
});

test('screenshot: the cursors at actual size over a mossy and a fresh stone, at 1x and 2x', async ({ browser }) => {
  test.skip(!process.env['SCREENSHOTS'], 'screenshots only with SCREENSHOTS=1');
  mkdirSync(OUT, { recursive: true });
  const g = JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as { files: Array<{ path: string; decayState: string; unused: boolean }> };
  const mossy = g.files.find((f) => f.decayState === 'ancient' && !f.unused)!.path;
  const fresh = g.files.find((f) => f.decayState === 'fresh' && !f.unused)!.path;
  for (const scale of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__repoInPeaceNoOpening = true;
      window.__repoInPeaceNoDigHold = true;
    });
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    const crops: string[] = [];
    for (const path of [mossy, fresh]) {
      await page.evaluate((p) => window.repoInPeace!.flyTo(p), path);
      await page.waitForTimeout(1900);
      const at = (await page.evaluate((p) => window.repoInPeace!.getScreenPoint(p), path))!;
      await page.mouse.move(5, 715); // the real cursor out of the way
      const shot = await page.screenshot({ clip: { x: at.x - 60, y: at.y - 60, width: 120, height: 120 } });
      crops.push(shot.toString('base64'));
    }
    // The crops at their real size (120 CSS px), each with the three hands on the stone's face, as the browser would draw them.
    const size = scale === 1 ? 32 : 64;
    const cell = (crop: string) =>
      ['hand', 'hand-over', 'hand-grab']
        .map((n) => `<div style="position:relative;width:120px;height:120px;display:inline-block;margin:4px;background:url(data:image/png;base64,${crop}) 0 0/120px 120px"><img src="/cursors/${n}-${size}.svg" style="position:absolute;left:52px;top:44px;width:32px;height:32px"></div>`)
        .join('');
    await page.setContent(`<body style="margin:0;background:#111"><div>${crops.map(cell).join('')}</div></body>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}cursors-on-stones-${scale}x.png`, clip: { x: 0, y: 0, width: 780, height: 136 } });
    await context.close();
  }
});
