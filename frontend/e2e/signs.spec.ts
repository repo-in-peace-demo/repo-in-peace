import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { DEFAULT_FOV_Y, type CameraPose } from '../src/model/camera-pose';
import { buildSceneModel, type SceneModel } from '../src/model/scene-model';
import { labelBlocked, signBlocked, stoneOccluders } from '../src/model/sign-occlusion';
import { SIGN_FADED } from '../src/model/sign-fade';
import { placeSignsClear } from '../src/model/sign-placement';
import { SIGN_MAX_VISIBLE, visibleSigns } from '../src/model/signs';
import { sceneCameraLimits } from '../src/model/camera-bounds';
import { clampPose } from '../src/model/fly-controls';
import { sub, vec3 } from '../src/model/vec3';

/**
 * Smoke test of the folder signs in the real app: the elements on the page are exactly the signs that `visibleSigns`
 * gives for the camera's pose, in the same order and with the same opacity; the pool of elements never changes; and
 * nothing is worked out while the camera is still.
 */

const FILE = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
const graveyard = JSON.parse(readFileSync(FILE, 'utf8')) as Graveyard;
const model = buildSceneModel(graveyard);
const VIEWPORT = { width: 1280, height: 720 };
// The fade checks run on oikos_ledger: since task 25 packed spatialql into 23 by 50 with three plots, every one of its signs stays
// fully readable from anywhere the camera limits allow (its smallest, `data`, fades to 0.98 at most), so nothing there can fade.
const oikos = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard);
const libPlot = oikos.layout.plots.find((p) => oikos.signSources.find((s) => s.path === p.path)?.label === 'lib')!;
const libFile = oikos.stones
  .filter((s) => s.layout.folder === libPlot.path || s.layout.folder.startsWith(`${libPlot.path}/`))
  .sort((a, b) => b.layout.z - a.layout.z || Math.abs(a.layout.x - libPlot.sign.x) - Math.abs(b.layout.x - libPlot.sign.x))[0]!.file.path;

/** How clearly the sign with this label shows for the camera now, by the pure function, before overlapping signs are dropped (0 when out of range). */
async function opacityInRange(page: Page, m: SceneModel, label: string): Promise<number> {
  const p = await pose(page);
  return visibleSigns(m.signSources, { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, aspect: VIEWPORT.width / VIEWPORT.height }).find((s) => s.label === label)?.opacity ?? 0;
}

async function openOikos(page: Page): Promise<void> {
  await page.goto('/?graveyard=demo.oikosledger');
  await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
}
// A stone of the small folder `src/data` in its front row and nearest the middle, so that flying to it puts the folder's
// own sign (at the middle of the front fence) in view.
const dataPlot = model.layout.plots.find((p) => p.path === 'src/data')!;
const deepFile = model.stones
  .filter((s) => s.layout.folder === 'src/data')
  .sort((a, b) => b.layout.z - a.layout.z || Math.abs(a.layout.x - dataPlot.sign.x) - Math.abs(b.layout.x - dataPlot.sign.x))[0]!.file.path;

const pose = (page: Page): Promise<CameraPose> => page.evaluate(() => window.repoInPeace!.getPose());

/** What the page shows: the visible sign elements, in the order of the page, with their text and opacity. */
const shown = (page: Page): Promise<Array<{ text: string; opacity: number }>> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.signs .sign'))
      .filter((element) => element.style.display === 'block')
      .map((element) => ({ text: element.textContent ?? '', opacity: Number.parseFloat(element.style.opacity) })),
  );

/**
 * What the page should show for a camera pose, from the same pure functions the app uses: the signs in range, less those behind a
 * stone, then (as the app does) only the nearest of any whose texts overlap on screen. The anchors are projected by the page's own camera.
 */
async function expectedFor(page: Page, p: CameraPose, m: SceneModel = model): Promise<Array<{ text: string; opacity: number }>> {
  const visible = visibleSigns(m.signSources, { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, aspect: VIEWPORT.width / VIEWPORT.height });
  const sources = new Map(m.signSources.map((s) => [s.path, s] as const));
  const where = await page.evaluate(
    (anchors) => Object.fromEntries(anchors.map((a) => [a.path, window.repoInPeace!.projectPoint(a.x, a.y, a.z)])),
    visible.map((v) => ({ path: v.path, x: sources.get(v.path)!.x, y: sources.get(v.path)!.y, z: sources.get(v.path)!.z })),
  );
  const boxes = stoneOccluders(m.pickTargets);
  const labelView = { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, viewportHeight: VIEWPORT.height };
  const seen = visible.filter((v) => !labelBlocked(labelView, sources.get(v.path)!, v.label, boxes));
  // A sign fading out of the way of the grave in focus (after a flight) takes its label with it; the page reports the fades.
  const fades = await page.evaluate(() => window.repoInPeace!.getSignFade());
  const fadeOf = (path: string): number => fades[path] ?? 1;
  const kept = seen.filter((v) => fadeOf(v.path) > SIGN_FADED).map((v) => ({ ...v, opacity: v.opacity * fadeOf(v.path) }));
  return placeSignsClear(kept, (path) => where[path] ?? null).map((s) => ({ text: s.label, opacity: s.opacity }));
}

/** Waits until the camera is still, then checks the page against the pose. */
async function expectPageMatchesCamera(page: Page, m: SceneModel = model): Promise<Array<{ text: string; opacity: number }>> {
  await page.waitForTimeout(1600);
  const p = await pose(page);
  const expected = await expectedFor(page, p, m);
  await expect
    .poll(async () => (await shown(page)).map((s) => s.text), { message: 'the signs on the page should be the signs for the camera, nearest first' })
    .toEqual(expected.map((s) => s.text));
  const actual = await shown(page);
  actual.forEach((s, i) => expect(Math.abs(s.opacity - expected[i]!.opacity), `opacity of "${s.text}"`).toBeLessThanOrEqual(0.02));
  return actual;
}

const updates = (page: Page): Promise<number> => page.evaluate(() => Number(document.querySelector<HTMLElement>('.signs')!.dataset.updates ?? '0'));

test.describe('folder signs, in the real app', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/?graveyard=demo.spatialql');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
  });

  test('from the starting view the root sign says the repository name, and the page matches the camera', async ({ page }) => {
    const actual = await expectPageMatchesCamera(page);
    expect(actual.map((s) => s.text), 'the root sign should be readable from the starting view').toContain(graveyard.meta.name);
    expect(actual.length).toBeLessThanOrEqual(SIGN_MAX_VISIBLE);
  });

  test('a sign fades as the camera moves away from it, and the page shows the opacity the pure function gives (oikos_ledger)', async ({ page }) => {
    await openOikos(page);
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyS'); // back away from the graveyard
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('Shift');
    const actual = await expectPageMatchesCamera(page, oikos);
    expect(actual.length, 'some sign should still show').toBeGreaterThan(0);
    // Faint signs are far ones, which a nearer sign often covers on the page, so the faded one is looked for in range.
    const p = await pose(page);
    const inRange = visibleSigns(oikos.signSources, { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, aspect: VIEWPORT.width / VIEWPORT.height });
    expect(Math.min(...inRange.map((s) => s.opacity)), 'a sign should be partly faded here, or this check proves nothing').toBeLessThan(0.95);
  });

  test('flying into a folder shows its sign, and zooming out from the overview fades it (oikos_ledger, lib)', async ({ page }) => {
    await openOikos(page);
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), libFile);
    const close = await expectPageMatchesCamera(page, oikos);
    expect(close.map((s) => s.text), 'the sign of the folder you are in should show').toContain('lib');
    const closeOpacity = close.find((s) => s.text === 'lib')!.opacity;

    await page.evaluate(() => window.repoInPeace!.resetView());
    await expectPageMatchesCamera(page, oikos);
    // From here on the opacity is read in range (a nearer sign may cover `lib` on the page, which the match above already checks).
    const overviewOpacity = await opacityInRange(page, oikos, 'lib');
    expect(overviewOpacity, 'the sign should be no clearer from the overview than up close').toBeLessThanOrEqual(closeOpacity + 0.02);

    // Zooming out from the overview, as far as the limits allow: the sign fades (0.88 to about 0.6 by the pure function), or goes.
    await page.mouse.move(640, 360);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 600);
    await page.mouse.move(640, 20); // off the stones, so no hover label
    await expectPageMatchesCamera(page, oikos);
    const awayOpacity = await opacityInRange(page, oikos, 'lib');
    expect(overviewOpacity, 'the sign should show in the overview, or there is nothing to fade').toBeGreaterThan(0.1);
    expect(awayOpacity, `the sign should fade as the camera zooms out (overview ${overviewOpacity.toFixed(2)}, further out ${awayOpacity.toFixed(2)})`).toBeLessThan(overviewOpacity - 0.1);
  });

  test('the pool is 30 elements that are never created or removed, however the camera moves', async ({ page }) => {
    const count = () => page.locator('.signs .sign').count();
    expect(await count()).toBe(SIGN_MAX_VISIBLE);
    await page.evaluate(() => document.querySelectorAll('.signs .sign').forEach((element, i) => ((element as HTMLElement & { mark?: number }).mark = i)));

    await page.evaluate((p) => window.repoInPeace!.flyTo(p), deepFile);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.repoInPeace!.resetView());
    await page.waitForTimeout(1600);

    expect(await count()).toBe(SIGN_MAX_VISIBLE);
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll('.signs .sign')).map((element) => (element as HTMLElement & { mark?: number }).mark));
    expect(marks).toEqual(Array.from({ length: SIGN_MAX_VISIBLE }, (_, i) => i)); // the same elements, in the same order
  });

  test('nothing is worked out while the camera is still, and it is worked out again when it moves', async ({ page }) => {
    await page.waitForTimeout(1500);
    const idleBefore = await updates(page);
    expect(idleBefore, 'the signs should have been worked out at least once').toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(await updates(page), 'the signs were worked out again with the camera still').toBe(idleBefore);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);
    const afterMove = await updates(page);
    expect(afterMove).toBeGreaterThan(idleBefore);

    await page.waitForTimeout(1500);
    expect(await updates(page), 'the signs were worked out again after the camera stopped').toBe(afterMove);
  });

  test('a sign lets clicks through to the scene', async ({ page }) => {
    await page.waitForTimeout(800);
    const pointerEvents = await page.evaluate(() => getComputedStyle(document.querySelector('.signs .sign')!).pointerEvents);
    expect(pointerEvents).toBe('none'); // inherited from the layer
  });
});

test.describe('folder signs up close on oikos_ledger', () => {
  test('no two signs overlap on the page, wherever the camera flies to (e.g. accounts/compare and [upload_id])', async ({ page }) => {
    const oikos = buildSceneModel(JSON.parse(readFileSync(fileURLToPath(new URL('../public/graveyards/demo.oikosledger.graveyard.json', import.meta.url)), 'utf8')) as Graveyard);
    await page.setViewportSize(VIEWPORT);
    await page.goto('/?graveyard=demo.oikosledger');
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(800);
    // The front stone of every fifth plot, so the flights land in many different folders.
    const stops = oikos.layout.plots.filter((_, i) => i % 5 === 0).map((plot) => oikos.stones.filter((s) => s.layout.folder === plot.path).sort((a, b) => b.layout.z - a.layout.z)[0]).filter((s) => s !== undefined);
    expect(stops.length).toBeGreaterThan(3);
    for (const stone of stops) {
      await page.evaluate((path) => window.repoInPeace!.flyTo(path), stone!.file.path);
      await page.waitForTimeout(1800);
      const boxes = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.signs .sign'))
          .filter((e) => e.style.display === 'block')
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { text: e.textContent ?? '', x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
          }),
      );
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
          expect(overlap, `near ${stone!.file.path}: the signs "${a.text}" and "${b.text}" overlap`).toBe(false);
        }
      }
    }
  });
});

test.describe('folder signs behind stones', () => {
  test('a sign hidden behind a stone has no label, and the label comes back when the camera rises to see over it (oikos_ledger)', async ({ page }) => {
    const limits = sceneCameraLimits(oikos.layout.bounds, VIEWPORT.width / VIEWPORT.height);
    const boxes = stoneOccluders(oikos.pickTargets);
    // A sign with a tall stone in front of it, and a camera pose (inside the limits) on the line from the sign over that stone's face.
    let found: { label: string; pose: CameraPose } | null = null;
    for (const src of oikos.signSources) {
      for (const s of oikos.stones) {
        const dz = s.layout.z - src.z;
        if (found || dz < 0.5 || dz > 8 || Math.abs(s.layout.x - src.x) > 0.5) continue;
        const anchor = vec3(src.x, src.y, src.z);
        const d = sub(vec3(s.layout.x, s.layout.height * 0.6, s.layout.z), anchor);
        const p = clampPose({ position: vec3(anchor.x + 2 * d.x, anchor.y + 2 * d.y, anchor.z + 2 * d.z), target: anchor }, limits);
        const inRange = visibleSigns(oikos.signSources, { position: p.position, forward: sub(p.target, p.position), fovY: DEFAULT_FOV_Y, aspect: VIEWPORT.width / VIEWPORT.height }).some((v) => v.path === src.path);
        if (inRange && signBlocked(p.position, anchor, boxes)) found = { label: src.label, pose: p };
      }
    }
    expect(found, 'oikos_ledger should have a sign with a stone in front of it').not.toBeNull();
    const { label, pose: behind } = found!;

    await page.setViewportSize(VIEWPORT);
    await openOikos(page);
    await page.evaluate((p) => window.repoInPeace!.setPose(p), behind);
    await page.mouse.move(640, 8);
    const hidden = await expectPageMatchesCamera(page, oikos);
    expect(hidden.map((s) => s.text), `"${label}" is behind a stone here and should have no label`).not.toContain(label);

    // Higher up, looking down at the same sign over the stone: the label shows again (the pure function agrees first).
    const above = clampPose({ position: vec3(behind.position.x, behind.position.y + 8, behind.position.z), target: behind.target }, limits);
    const aboveView = { position: above.position, forward: sub(above.target, above.position), fovY: DEFAULT_FOV_Y, viewportHeight: VIEWPORT.height };
    expect(labelBlocked(aboveView, behind.target, label, boxes), 'from higher up the stone should no longer be in the way').toBe(false);
    await page.evaluate((p) => window.repoInPeace!.setPose(p), above);
    const seen = await expectPageMatchesCamera(page, oikos);
    expect(seen.map((s) => s.text), `"${label}" should be labelled again once it can be seen`).toContain(label);
  });
});
