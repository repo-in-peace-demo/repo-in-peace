import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, skyDirection } from '../src/model/atmosphere';
import { BATS_S, batAt, batFlight, lightningOf, skyDistanceDeg, skySchedule, type SkyKind } from '../src/model/sky-director';
import { START_DELAY_S } from '../src/model/witch';
import { expect, test, type Page } from './fixtures';

/**
 * The sky director's events in the real app (model/sky-director.ts, scene/SkyEvents.tsx): bats, shooting stars and distant
 * lightning, one at a time after the witch. `./fixtures` turns the opening move off, so the schedule starts START_DELAY_S in, and
 * the tests hold the animation clock at moments read from the same schedule.
 */
const OUT = fileURLToPath(new URL('../test-results/screenshots/', import.meta.url));
const MOON = { azimuthDeg: MOON_AZIMUTH_DEG, elevationDeg: MOON_ELEVATION_DEG };
const events = skySchedule(START_DELAY_S, 900);
const firstOf = (kind: SkyKind) => events.find((e) => e.kind === kind)!;

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.mouse.move(640, 5);
}
const at = async (page: Page, t: number): Promise<void> => {
  await page.evaluate((x) => window.repoInPeace!.setAnimationTime(x), t);
  await page.waitForTimeout(250);
};
const skyEvent = (page: Page) => page.evaluate(() => window.repoInPeace!.getSkyEvent());

/** The moment in a bat flight when a bat is nearest the moon's middle. */
function batsOverMoon(index: number, start: number): number {
  const bats = batFlight(index);
  let best = { t: start + BATS_S / 2, d: Infinity };
  for (let s = 0; s <= BATS_S; s += 0.02) {
    for (const bat of bats) {
      const b = batAt(bat, s);
      if (b && b.opacity > 0.9) {
        const d = skyDistanceDeg(b.at, MOON);
        if (d < best.d) best = { t: start + s, d };
      }
    }
  }
  return best.t;
}

test('each kind appears when the schedule says, alone, with one draw call more at most', async ({ page }) => {
  await open(page);
  await at(page, events[0]!.start + events[0]!.duration + 3); // a quiet gap
  expect(await skyEvent(page)).toBeNull();
  expect(await page.evaluate(() => window.repoInPeace!.getWitch())).toBeNull();
  const quiet = (await page.evaluate(() => window.repoInPeace!.getRenderInfo())).calls;
  for (const kind of ['bats', 'star', 'lightning'] as const) {
    const e = firstOf(kind);
    await at(page, e.start + e.duration / 2);
    expect(await skyEvent(page)).toMatchObject({ kind, index: e.index });
    expect(await page.evaluate(() => window.repoInPeace!.getWitch()), 'never with the witch').toBeNull();
    const calls = (await page.evaluate(() => window.repoInPeace!.getRenderInfo())).calls;
    expect(calls - quiet).toBeLessThanOrEqual(1);
  }
});

test('under reduced motion none of them appear (nor the witch)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  for (const e of events.slice(0, 8)) {
    await at(page, e.start + e.duration / 2);
    expect(await skyEvent(page)).toBeNull();
    expect(await page.evaluate(() => window.repoInPeace!.getWitch())).toBeNull();
  }
  const calls = new Set<number>();
  for (const e of events.slice(0, 6)) {
    await at(page, e.start + e.duration / 2);
    calls.add((await page.evaluate(() => window.repoInPeace!.getRenderInfo())).calls);
  }
  expect(calls.size, 'no extra draw call at any event').toBe(1);
});

test('screenshots: bats crossing the moon, a shooting star, a lightning flicker (1280 × 720)', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await open(page);
  const bats = firstOf('bats');
  await at(page, batsOverMoon(bats.index, bats.start));
  await page.screenshot({ path: `${OUT}sky-bats-1280x720.png` });

  const star = firstOf('star');
  await at(page, star.start + star.duration * 0.45);
  await page.screenshot({ path: `${OUT}sky-shooting-star-1280x720.png` });

  // A lightning event with a fork, at the peak of its first flash.
  const lightning = events.find((e) => e.kind === 'lightning' && lightningOf(e.index).fork !== null)!;
  const flash = lightningOf(lightning.index).flashes[0]!;
  await at(page, lightning.start + flash.start + flash.duration * 0.25);
  await page.screenshot({ path: `${OUT}sky-lightning-1280x720.png` });
  await page.evaluate(() => window.repoInPeace!.resumeAnimation());
  // Where the moon is, for reading the pictures.
  const d = skyDirection(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);
  expect(await page.evaluate((m) => {
    const pose = window.repoInPeace!.getPose();
    return window.repoInPeace!.projectPoint(pose.position.x + m.x * 600, pose.position.y + m.y * 600, pose.position.z + m.z * 600);
  }, d)).not.toBeNull();
});
