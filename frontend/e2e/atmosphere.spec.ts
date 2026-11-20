import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { fogDensity } from '../src/model/atmosphere';
import { boundsRadius } from '../src/model/fly-controls';
import { buildSceneModel } from '../src/model/scene-model';

/**
 * Smoke test of the night: a sky with stars and a moon that reads nothing from the data, fog that melts the far ground into the
 * sky, and no shader errors. The camera is brought down to look along the ground, where the sky is in view.
 */

const VIEWPORT = { width: 1200, height: 750 };

async function open(page: Page, name: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/?graveyard=${name}`);
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

/** Tilts the camera toward the horizon and backs away, so the sky fills the upper part of the view. */
async function lookAlongTheGround(page: Page): Promise<void> {
  await page.evaluate(() => window.repoInPeace!.setAnimationTime(0)); // the same moment for every picture: the stars twinkle
  await page.mouse.move(600, 380);
  for (let i = 0; i < 3; i++) {
    await page.mouse.down();
    await page.mouse.move(600, 40, { steps: 15 });
    await page.mouse.up();
    await page.mouse.move(600, 380);
  }
  for (let k = 0; k < 4; k++) await page.mouse.wheel(0, 300);
  await page.mouse.move(640, 700);
  await page.waitForTimeout(1800);
}

type Clip = { x: number; y: number; width: number; height: number };

/** In-page pixel counting over a screenshot of `clip`. `what` picks the test; returns the count (and for 'rows', the average colour of the clip). */
async function pixels(page: Page, clip: Clip, what: 'stars' | 'moon' | 'average'): Promise<{ count: number; r: number; g: number; b: number }> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(
    async ({ data, kind }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
        sum[0]! += r;
        sum[1]! += g;
        sum[2]! += b;
        if (kind === 'stars' && r > 120 && g > 120 && b > 130) count++;
        if (kind === 'moon' && r > 225 && g > 225 && b > 225) count++;
      }
      const n = rgba.length / 4;
      return { count, r: sum[0]! / n, g: sum[1]! / n, b: sum[2]! / n };
    },
    { data: png, kind: what },
  );
}

test.describe('the night, in the real app', () => {
  const problems: string[] = [];
  test.beforeEach(({ page }) => {
    problems.length = 0;
    page.on('console', (m) => {
      if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.WebGL|shader|GLSL|program/i.test(m.text()))) problems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  });

  test('the sky has stars, a moon and a gradient, and the shaders compile', async ({ page }) => {
    await open(page, 'demo.spatialql');
    // The sky alone: the forest on the ridge reaches into the lower sky (its own checks are in model/horizon.test.ts).
    await page.evaluate(() => window.repoInPeace!.setHorizonVisible(false));
    await lookAlongTheGround(page);
    const sky: Clip = { x: 540, y: 5, width: 300, height: 300 }; // away from the moon and its glow
    const stars = await pixels(page, sky, 'stars');
    expect(stars.count, 'bright star pixels in the sky').toBeGreaterThan(4);
    const moon = await pixels(page, { x: 0, y: 0, width: 600, height: 120 }, 'moon');
    expect(moon.count, 'pixels of the moon: it is a big bright disc').toBeGreaterThan(300);
    // The sky is dark: the average of the sky region is far below the middle grey, and bluer than red.
    const average = await pixels(page, { x: 330, y: 150, width: 500, height: 150 }, 'average');
    expect(average.r + average.g + average.b, 'the sky should be dark').toBeLessThan(160);
    expect(average.b, 'and blue').toBeGreaterThan(average.r);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('the sky does not depend on the data: the same sky above the horizon in two different graveyards', async ({ page }) => {
    /**
     * Where the horizon is on the page, in pixels from the top. Any point level with the camera is on the horizon line, so one 500
     * units ahead: inside the camera's far plane (at least 1000), which `projectPoint` would treat as behind the camera.
     */
    const horizonY = (): Promise<number> =>
      page.evaluate(() => {
        const api = window.repoInPeace!;
        const { position: p, target: t } = api.getPose();
        const along = Math.hypot(t.x - p.x, t.z - p.z);
        const far = 500 / along;
        const at = api.projectPoint(p.x + (t.x - p.x) * far, p.y, p.z + (t.z - p.z) * far);
        if (at === null) throw new Error('the point on the horizon did not project');
        return at.y;
      });
    const skyOf = async (name: string, clipHeight?: number): Promise<{ png: string; horizon: number; clipHeight: number }> => {
      await open(page, name);
      // The forest on the ridge reaches into the lower sky, and it is placed for each graveyard's size; the sky itself is not.
      await page.evaluate(() => window.repoInPeace!.setHorizonVisible(false));
      await lookAlongTheGround(page);
      const horizon = await horizonY();
      // Only the sky: from near the top to well above the horizon. Below it is the ground, whose fog depends on the graveyard's size.
      const height = clipHeight ?? Math.min(280, Math.floor(horizon - 20 - 5));
      expect(height, `the horizon (y ${horizon.toFixed(0)}) should leave a band of sky to compare`).toBeGreaterThan(120);
      return { png: (await page.screenshot({ clip: { x: 300, y: 5, width: 540, height } })).toString('base64'), horizon, clipHeight: height };
    };
    const a = await skyOf('demo.spatialql');
    const b = await skyOf('demo.oikosledger', a.clipHeight); // the same clip for both
    expect(Math.abs(a.horizon - b.horizon), 'the camera should look along the ground the same way in both').toBeLessThan(0.5);
    expect(a.png === b.png, 'the stars and the moon must be in the same places for any graveyard').toBe(true);
  });

  test('the fog has the density the model gives for the size of the graveyard, for each graveyard', async ({ page }) => {
    for (const name of ['demo.spatialql', 'demo.oikosledger']) {
      const graveyard = JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
      const expected = fogDensity(boundsRadius(buildSceneModel(graveyard).layout.bounds));
      await open(page, name);
      const info = await page.evaluate(() => window.repoInPeace!.getRenderInfo());
      expect(info.fogDensity, `fog density of ${name}`).toBeCloseTo(expected, 9);
      expect(info.fogDensity).toBeGreaterThan(0);
    }
  });

  test('the fog melts the far ground into the sky: no hard line at the horizon', async ({ page }) => {
    await open(page, 'demo.spatialql');
    // The fog on the bare ground: the trees stand in front of the horizon (their own checks are in model/horizon.test.ts).
    await page.evaluate(() => window.repoInPeace!.setHorizonVisible(false));
    await lookAlongTheGround(page);
    // A strip of the ground and a strip of the sky on either side of the horizon, away from the graveyard (to the right of it).
    const horizon = await findHorizon(page);
    const sky = await pixels(page, { x: 900, y: horizon - 14, width: 40, height: 8 }, 'average');
    const ground = await pixels(page, { x: 900, y: horizon + 8, width: 40, height: 8 }, 'average');
    const gap = Math.abs(sky.r + sky.g + sky.b - (ground.r + ground.g + ground.b));
    expect(gap, `the ground (${[ground.r, ground.g, ground.b].map(Math.round)}) and the sky (${[sky.r, sky.g, sky.b].map(Math.round)}) by the horizon should be nearly the same colour`).toBeLessThan(40);
  });

  test('the scene stays within the draw-call budget of 40, with every effect on', async ({ page }) => {
    await open(page, 'demo.spatialql');
    await page.evaluate(([p]) => window.repoInPeace!.select({ kind: 'ghost', path: p! }), ['src/surface-placement.ts']);
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => window.repoInPeace!.getRenderInfo());
    expect(info.calls, `draw calls in a frame (${JSON.stringify(info)})`).toBeGreaterThan(5);
    expect(info.calls).toBeLessThan(40);
  });
});

/** The screen row of the horizon: the first row, going down in a column away from the graveyard, where the average colour stops being sky. */
async function findHorizon(page: Page): Promise<number> {
  let best = 340;
  let biggest = 0;
  let previous: number | null = null;
  for (let y = 300; y < 460; y += 4) {
    const p = await pixels(page, { x: 900, y, width: 40, height: 4 }, 'average');
    const value = p.r + p.g + p.b;
    if (previous !== null && Math.abs(value - previous) > biggest) {
      biggest = Math.abs(value - previous);
      best = y;
    }
    previous = value;
  }
  return best;
}
