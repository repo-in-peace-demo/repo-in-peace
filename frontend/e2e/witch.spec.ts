import { test as plain } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, skyDirection } from '../src/model/atmosphere';
import { OPENING_DURATION_MS } from '../src/model/framing';
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
      const moon = (await moonOnScreen(page))!;
      expect(moon.x > 0 && moon.x < size.width && moon.y > 0 && moon.y < size.height, 'the moon is in the frame').toBe(true);
      // Sampled through the first pass, with the animation clock held at each moment (so a slow start under load can't make the test
      // miss the pass): in the frame's sky (above the moon's line minus a little), and once close to the moon.
      let closest = Infinity;
      let seen = 0;
      for (let i = 1; i < 24; i++) {
        const elapsed = (PASS_S * i) / 24;
        await page.evaluate((t) => window.repoInPeace!.setAnimationTime(t), START_DELAY_S + elapsed);
        // Wait for a frame drawn at that moment: the state is the last drawn frame's.
        await expect.poll(() => page.evaluate(() => window.repoInPeace!.getWitch()?.elapsed ?? -1), { timeout: 5000 }).toBeCloseTo(elapsed, 3);
        const at = await witchOnScreen(page);
        if (at) {
          seen++;
          closest = Math.min(closest, Math.hypot(at.x - moon.x, at.y - moon.y));
          expect(at.y, 'in the upper part of the frame, the sky').toBeLessThan(size.height * 0.45);
        }
      }
      await page.evaluate(() => window.repoInPeace!.resumeAnimation());
      expect(seen).toBeGreaterThan(20);
      expect(closest, 'she passes over the moon').toBeLessThan(size.height * 0.03);
    });
  }
}

/** Holds the animation clock at `t` seconds and returns the witch as the next drawn frame has her (two animation frames later). */
async function witchAt(page: Page, t: number) {
  await page.evaluate((x) => window.repoInPeace!.setAnimationTime(x), t);
  return page.evaluate(
    () =>
      new Promise<ReturnType<NonNullable<typeof window.repoInPeace>['getWitch']>>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done(window.repoInPeace!.getWitch()))),
      ),
  );
}

test('she fades in and out smoothly: no jump to zero between moments, and gone only once faded', async ({ page }) => {
  await open(page, 'demo.oikosledger', { width: 1280, height: 720 });
  // Her first pass and a little either side, every 0.1 s on the animation clock, held at each moment (so a slow start under load
  // can't make the test miss it): her opacity follows the fade, never changes by more than the fade allows, and she is there only
  // during the pass.
  const STEP = 0.1;
  const samples: Array<{ t: number; o: number; e: number | null }> = [];
  for (let t = START_DELAY_S - 0.5; t <= START_DELAY_S + PASS_S + 0.5; t += STEP) {
    const w = await witchAt(page, t);
    samples.push({ t, o: w?.opacity ?? 0, e: w?.elapsed ?? null });
  }
  await page.evaluate(() => window.repoInPeace!.resumeAnimation());
  expect(Math.max(...samples.map((s) => s.o)), 'she was there').toBeGreaterThan(0.99);
  for (const s of samples) {
    const inPass = s.t >= START_DELAY_S && s.t <= START_DELAY_S + PASS_S;
    expect(s.e !== null, `there at ${s.t.toFixed(1)} s only during the pass`).toBe(inPass);
    if (s.e !== null) expect(s.o, `opacity at ${s.e.toFixed(2)} s into the pass`).toBeCloseTo(passOpacity(s.e), 6);
  }
  // Smooth: the fade (a smoothstep over FADE_S) changes by at most 1.5 × STEP / FADE_S between moments STEP apart.
  for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i]!.o - samples[i - 1]!.o)).toBeLessThanOrEqual((1.5 * STEP) / FADE_S + 1e-6);
  // She arrives and leaves faded out: low opacity at the first and last moments of the pass.
  const seen = samples.filter((s) => s.e !== null);
  expect(seen[0]!.o, 'came in fading').toBeLessThan(0.1);
  expect(seen[seen.length - 1]!.o, 'left fading').toBeLessThan(0.1);
});

test('under reduced motion she never appears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'demo.oikosledger', { width: 1280, height: 720 });
  for (let i = 0; i < 12; i++) {
    expect(await page.evaluate(() => window.repoInPeace!.getWitch())).toBeNull();
    await page.waitForTimeout(500);
  }
});

plain('with the opening move, her first pass starts only as it settles, and there is one pass before the next', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    window.__repoInPeaceNoDigHold = true;
  });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  // Read at moments on the animation clock, not by waiting: the opening move is 3.6 s, and she starts START_DELAY_S after it.
  const first = OPENING_DURATION_MS / 1000 + START_DELAY_S;
  for (const t of [0.5, 2, 3.5, first - 0.1]) expect(await witchAt(page, t), `not yet at ${t} s`).toBeNull();
  expect(await witchAt(page, first + 0.5), 'flying just after the opening move').not.toBeNull();
  expect(await witchAt(page, first + PASS_S + 1), 'one pass, then gone until the next').toBeNull();
  await page.evaluate(() => window.repoInPeace!.resumeAnimation());
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
