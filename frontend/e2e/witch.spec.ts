import { test as plain } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, skyDirection } from '../src/model/atmosphere';
import { FADE_S, PASS_S, START_DELAY_S, passOpacity } from '../src/model/witch';
import { expect, test, type Page } from './fixtures';

/**
 * The witch on her broom (model/witch.ts), in the real app: she passes after the opening move, across the moon in the default view,
 * and never under reduced motion. `./fixtures` turns the opening move off, so there she starts START_DELAY_S after the scene opens.
 */
const OUT = fileURLToPath(new URL('../test-results/screenshots/', import.meta.url));
const open = async (page: Page, name: string, size: { width: number; height: number }) => {
  await page.setViewportSize(size);
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
};
const moonOnScreen = (page: Page) => {
  const d = skyDirection(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  return page.evaluate((m) => {
    const pose = window.repoInPeace!.getPose();
    return window.repoInPeace!.projectPoint(pose.position.x + m.x * 600, pose.position.y + m.y * 600, pose.position.z + m.z * 600);
  }, d);
};
const witchOnScreen = (page: Page) =>
  page.evaluate(() => {
    const api = window.repoInPeace!;
    const w = api.getWitch();
    if (!w) return null;
    const az = (w.azimuthDeg * Math.PI) / 180;
    const el = (w.elevationDeg * Math.PI) / 180;
    const pose = api.getPose();
    const d = { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
    return api.projectPoint(pose.position.x + d.x * 600, pose.position.y + d.y * 600, pose.position.z + d.z * 600);
  });

for (const name of ['demo.oikosledger', 'demo.spatialql']) {
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    test(`${name} at ${size.width} × ${size.height}: she flies across the moon in the default view`, async ({ page }) => {
      await open(page, name, size);
      await expect.poll(() => page.evaluate(() => window.repoInPeace!.getWitch()), { timeout: 10_000 }).not.toBeNull();
      const moon = (await moonOnScreen(page))!;
      expect(moon.x > 0 && moon.x < size.width && moon.y > 0 && moon.y < size.height, 'the moon is in the frame').toBe(true);
      // Sampled through the pass: in the frame's sky (above the moon's line minus a little), and once close to the moon.
      let closest = Infinity;
      for (let i = 0; i < 24; i++) {
        const at = await witchOnScreen(page);
        if (at) {
          closest = Math.min(closest, Math.hypot(at.x - moon.x, at.y - moon.y));
          expect(at.y, 'in the upper part of the frame, the sky').toBeLessThan(size.height * 0.45);
        }
        await page.waitForTimeout(250);
      }
      expect(closest, 'she passes over the moon').toBeLessThan(size.height * 0.03);
    });
  }
}

test('she fades in and out smoothly: no jump to zero between frames, and gone only once faded', async ({ page }) => {
  await open(page, 'demo.oikosledger', { width: 1280, height: 720 });
  // Sample every animation frame in the page for the whole first pass and a little after: her opacity and her own pass clock.
  const samples = await page.evaluate(
    (ms) =>
      new Promise<Array<{ o: number; e: number | null }>>((done) => {
        const out: Array<{ o: number; e: number | null }> = [];
        const start = performance.now();
        const step = (): void => {
          const w = window.repoInPeace!.getWitch();
          out.push({ o: w?.opacity ?? 0, e: w?.elapsed ?? null });
          if (performance.now() - start < ms) requestAnimationFrame(step);
          else done(out);
        };
        requestAnimationFrame(step);
      }),
    (PASS_S + 2) * 1000,
  );
  expect(Math.max(...samples.map((s) => s.o)), 'she was there').toBeGreaterThan(0.99);
  // What is drawn is always the smooth fade at her own time into the pass (the model test shows it changes by under 1.1% a frame at
  // 60 fps); measured on her clock, not this sampler's, which slow software frames knock out of step with the scene.
  const off = samples.filter((s) => s.e !== null && Math.abs(s.o - passOpacity(s.e)) > 1e-9);
  expect(off, 'opacity follows the fade').toEqual([]);
  // And she is only gone once fading: the first frame she is drawn in is inside her opening fade and the last inside her closing one
  // (how low the last opacity is depends on the frame rate: about half a second a frame under software rendering here).
  const seen = samples.filter((s) => s.o > 0 && s.e !== null);
  expect(seen[0]!.e!, 'came in fading').toBeLessThan(FADE_S);
  expect(seen[seen.length - 1]!.e!, 'left fading').toBeGreaterThan(PASS_S - FADE_S);
});

test('under reduced motion she never appears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'demo.oikosledger', { width: 1280, height: 720 });
  for (let i = 0; i < 12; i++) {
    expect(await page.evaluate(() => window.repoInPeace!.getWitch())).toBeNull();
    await page.waitForTimeout(500);
  }
});

plain('with the opening move, her first pass starts only as it settles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    window.__repoInPeaceNoDigHold = true;
  });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  const t0 = Date.now();
  await expect.poll(() => page.evaluate(() => window.repoInPeace!.getWitch()), { timeout: 15_000, intervals: [100] }).not.toBeNull();
  expect(Date.now() - t0, 'not before the opening move (3.6 s) has settled').toBeGreaterThan(3000);
  await page.waitForTimeout((PASS_S + 1) * 1000);
  expect(await page.evaluate(() => window.repoInPeace!.getWitch()), 'one pass, then gone until the next').toBeNull();
});

test('screenshot: mid-pass against the moon', async ({ page }) => {
  test.skip(!process.env['SCREENSHOTS'], 'screenshots only with SCREENSHOTS=1');
  mkdirSync(OUT, { recursive: true });
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await open(page, 'demo.oikosledger', size);
    await page.waitForTimeout(800);
    for (const [label, t] of [['', START_DELAY_S + PASS_S / 2], ['-fading-in', START_DELAY_S + 0.9]] as const) {
      await page.evaluate((x) => window.repoInPeace!.setAnimationTime(x), t);
      await page.mouse.move(size.width / 2, 5);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}witch${label}-${size.width}x${size.height}.png` });
    }
  }
});
