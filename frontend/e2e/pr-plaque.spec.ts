import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { blockersOf, plaqueFaceOf, sceneOccluders } from '../src/model/clear-view';
import type { GraveOverride } from '../src/model/pr-scene';
import { buildSceneModel } from '../src/model/scene-model';
import { expect, test, type Page } from './fixtures';

/**
 * The pull request's plaque is never hidden (clear-view rule, extended): after a Bury or a Resurrect, with the grave selected, every
 * stone, fence post or rail and sign board that stands between the camera and the "PR #N" plaque has faded out of the way, from the
 * view flyTo lands on and from a view low in front of the grave. Several graves of both demos.
 */
const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8')) as Graveyard;
const panel = (page: Page) => page.getByRole('complementary', { name: 'Selected grave' });

const cases: Array<{ demo: string; kind: 'file' | 'ghost'; path: string }> = [];
for (const demo of ['demo.oikosledger', 'demo.spatialql']) {
  const g = load(demo);
  for (const f of g.files.filter((x) => x.unused).slice(0, demo === 'demo.oikosledger' ? 4 : 2)) cases.push({ demo, kind: 'file', path: f.path });
  for (const x of g.ghosts) cases.push({ demo, kind: 'ghost', path: x.path });
}

for (const c of cases) {
  test(`${c.demo}: after ${c.kind === 'file' ? 'Bury' : 'Resurrect'} on ${c.path}, nothing showing stands in front of the PR plaque`, async ({ page }) => {
    const graveyard = load(c.demo);
    const model = buildSceneModel(graveyard);
    const occluders = sceneOccluders(model);
    const at = model.lookup.get(c.path)!;
    const override: GraveOverride = { kind: c.kind === 'file' ? 'buried' : 'risen', path: c.path, index: at.index, number: 1, startedAt: 0 };
    const face = plaqueFaceOf(override, model);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?graveyard=${c.demo}`);
    await page.waitForFunction(() => window.repoInPeace !== undefined, undefined, { timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.evaluate((p) => window.repoInPeace!.flyTo(p), c.path);
    await page.waitForTimeout(1800);
    await page.evaluate(([k, p]) => window.repoInPeace!.select({ kind: k as 'file' | 'ghost', path: p! }), [c.kind, c.path]);
    await panel(page).getByRole('button', { name: c.kind === 'file' ? 'Bury' : 'Resurrect' }).click();
    await panel(page).getByRole('button', { name: 'Open pull request' }).click();
    // The stake stands: the mound's with the gravedigger gone, or the new stone's.
    await expect.poll(async () => {
      const f = (await page.evaluate((p) => window.repoInPeace!.getOverrideFrame(p), c.path)) as { kind: string; stake?: number; solid?: number } | null;
      return f === null ? 0 : f.kind === 'buried' ? (f.stake ?? 0) : (f.solid ?? 0);
    }, { timeout: 15_000 }).toBe(1);

    const problems: string[] = [];
    const check = async (view: string): Promise<number> => {
      await page.waitForTimeout(900); // the fade runs over a few frames
      const camera = (await page.evaluate(() => window.repoInPeace!.getPose())).position;
      const blockers = blockersOf(camera, face, occluders);
      if (blockers.length === 0) return 0;
      const fades = await page.evaluate(() => ({ ...window.repoInPeace!.getObstructionFade(), signs: window.repoInPeace!.getSignFade() }));
      for (const b of blockers) {
        const alpha = (b.kind === 'stone' ? fades.stones : b.kind === 'fence' ? fades.fences : fades.signs)[b.id] ?? 1;
        if (alpha > 0.05) problems.push(`${view}: ${b.kind} ${b.id} is in front of the plaque and showing (opacity ${alpha.toFixed(2)})`);
      }
      return blockers.length;
    };
    let inTheWay = await check('after the flight');
    // A view low in front of the grave, the camera's own limits applied: the rows ahead stand in front of the plaque here.
    const spot = c.kind === 'file' ? model.stones[at.index]!.layout : model.ghosts[at.index]!.layout;
    await page.evaluate((s) => window.repoInPeace!.setPose({ position: { x: s.x + 0.8, y: 3.4, z: s.z + 9 }, target: { x: s.x, y: 0.6, z: s.z } }), { x: spot.x, z: spot.z });
    inTheWay += await check('low in front');
    expect(problems).toEqual([]);
    test.info().annotations.push({ type: 'in the way (all faded)', description: String(inTheWay) });
  });
}
