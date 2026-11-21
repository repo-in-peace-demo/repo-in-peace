import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fadeSignsOf, flyView } from '../../test/fly-view';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { buildSceneModel } from './scene-model';
import { SIGN_FADE_SECONDS, cornersOf, plaqueBox, screenRectOf, signsInTheWay, stepFade } from './sign-fade';
import { signBox } from './sign-placement';

describe('the fade of a sign', () => {
  it('takes SIGN_FADE_SECONDS from shown to gone and back, never past its target, and jumps there with no time limit', () => {
    expect(stepFade(1, 0, SIGN_FADE_SECONDS)).toBe(0);
    expect(stepFade(0, 1, SIGN_FADE_SECONDS / 2)).toBeCloseTo(0.5, 9);
    expect(stepFade(0.3, 0, Number.POSITIVE_INFINITY)).toBe(0);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 1), fc.double({ min: 0, max: 2, noNaN: true }), (a, target, dt) => {
        const next = stepFade(a, target, dt);
        return next >= Math.min(a, target) - 1e-12 && next <= Math.max(a, target) + 1e-12;
      }),
    );
  });
});

describe('signs in the way of the grave in focus', () => {
  it("after flying to app/components/charts/index.ts, its own folder's sign (in front of it) fades", () => {
    const m = buildSceneModel(loadRealGraveyard('demo.oikosledger'));
    const path = 'app/components/charts/index.ts';
    const box = m.pickTargets.find((t) => t.path === path)!;
    const hidden = signsInTheWay(box, fadeSignsOf(m), flyView(m, path).project);
    expect(hidden.has('app/components/charts')).toBe(true);
  });

  it.each(REAL_GRAVEYARDS)('%s: after flyTo for every stone and ghost, no sign left showing is nearer than it with its board or label over it on screen', (name) => {
    const m = buildSceneModel(loadRealGraveyard(name));
    const signs = fadeSignsOf(m);
    let faded = 0;
    for (const target of m.pickTargets) {
      const { project } = flyView(m, target.path);
      const hidden = signsInTheWay(target, signs, project);
      faded += hidden.size;
      const face = screenRectOf(cornersOf(target), project)!;
      expect(face, `${target.path} is in view after the flight`).not.toBeNull();
      for (const sign of signs) {
        if (hidden.has(sign.path)) continue;
        const board = screenRectOf(cornersOf(plaqueBox(sign.x, sign.z)), project);
        if (board === null || board.depth >= face.depth) continue;
        const at = project(sign.anchor)!;
        const label = signBox(sign.label, at.x, at.y);
        const covers = (r: { x0: number; x1: number; y0: number; y1: number }) => r.x0 < face.x1 && face.x0 < r.x1 && r.y0 < face.y1 && face.y0 < r.y1;
        expect(covers(board) || covers(label), `${target.path}: the sign of ${sign.path} covers it`).toBe(false);
      }
    }
    // On oikos something was in the way somewhere (or the check proves nothing there): many small plots' signs stand in front of their
    // first rows. spatialql has three signs, on the outer fences, and none is ever in the way.
    if (name === 'demo.oikosledger') expect(faded).toBeGreaterThan(0);
  });

  it('never fades a sign behind the grave, nor any sign when the grave is behind the camera', () => {
    const m = buildSceneModel(loadRealGraveyard('demo.spatialql'));
    const target = m.pickTargets[0]!;
    const { project } = flyView(m, target.path);
    const face = screenRectOf(cornersOf(target), project)!;
    for (const path of signsInTheWay(target, fadeSignsOf(m), project)) {
      const s = fadeSignsOf(m).find((x) => x.path === path)!;
      expect(screenRectOf(cornersOf(plaqueBox(s.x, s.z)), project)!.depth).toBeLessThan(face.depth);
    }
    expect(signsInTheWay(target, fadeSignsOf(m), () => null).size).toBe(0);
  });
});
