import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildSceneModel } from './scene-model';
import { makeSyntheticGraveyard } from './synthetic';
import {
  CELL_HALF,
  HASH_GLYPH,
  P_GLYPH,
  R_GLYPH,
  SPACE_GLYPH,
  marksExtent,
  MOUND_START_S,
  FORM_AT_S,
  MOUTH_S,
  RISE_END_S,
  RISE_H,
  RISE_S,
  ghostWait,
  SINK_S,
  buryFrame,
  markerGlyphs,
  overridePickTarget,
  overridesOf,
  pickTargetsWith,
  prLegendLines,
  riseFrame,
  risenHeight,
  stakeSpot,
} from './pr-scene';

const model = buildSceneModel(makeSyntheticGraveyard({ files: 60, seed: 4, ghosts: 3 }));
const unused = model.stones.filter((s) => s.file.unused);
const pr = (action: string, number: number, openedAt = 0) => ({ action, number, openedAt });

describe('overridesOf', () => {
  it('takes a Bury on a stone and a Resurrect on a ghost, and nothing else', () => {
    const stone = unused[0]!.file.path;
    const ghost = model.ghosts[0]!.ghost.path;
    const prs = new Map([
      [`file:${stone}`, pr('bury', 3)],
      [`ghost:${ghost}`, pr('resurrect', 4)],
      [`ghost:${stone}`, pr('resurrect', 5)], // not a ghost
      ['file:nowhere.ts', pr('bury', 6)],
      [`file:${model.stones[1]!.file.path}`, pr('resurrect', 7)], // wrong action for a stone
    ]);
    expect(overridesOf(model, prs).map((o) => [o.kind, o.path, o.number])).toEqual(
      [['buried', stone, 3], ['risen', ghost, 4]].sort((a, b) => (String(a[1]) < String(b[1]) ? -1 : 1)),
    );
  });
});

describe('the animation frames', () => {
  it('end at once under reduced motion', () => {
    fc.assert(fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (now) => {
      expect(buryFrame(0, now, true)).toEqual({ sink: 1, mound: 1, stake: 1 });
      expect(riseFrame(0, now, true)).toEqual({ mouth: 0, rise: 0, stretch: 1, fade: 0, solid: 1 });
      expect(ghostWait(0, now, true)).toBe(0);
    }));
  });

  it('only move forward in time, stay in 0..1, and start and end where the design says', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 3000, noNaN: true }), fc.double({ min: 0, max: 3000, noNaN: true }), (a, b) => {
        const [t1, t2] = a <= b ? [a, b] : [b, a];
        const [f1, f2] = [buryFrame(0, t1, false), buryFrame(0, t2, false)];
        const [r1, r2] = [riseFrame(0, t1, false), riseFrame(0, t2, false)];
        for (const v of [f1.sink, f1.mound, r1.mouth, r1.fade, r1.solid]) expect(v >= 0 && v <= 1).toBe(true);
        expect(f2.sink).toBeGreaterThanOrEqual(f1.sink);
        expect(f2.mound).toBeGreaterThanOrEqual(f1.mound);
        expect(r2.mouth).toBeGreaterThanOrEqual(r1.mouth);
        expect(r2.rise).toBeGreaterThanOrEqual(r1.rise);
        expect(r2.stretch).toBeGreaterThanOrEqual(r1.stretch);
        expect(r2.fade).toBeLessThanOrEqual(r1.fade);
        expect(r2.solid).toBeGreaterThanOrEqual(r1.solid);
      }),
    );
    expect(buryFrame(1000, 1000, false)).toEqual({ sink: 0, mound: 0, stake: 0 });
    expect(buryFrame(0, SINK_S * 1000, false)).toEqual({ sink: 1, mound: 1, stake: 1 });
    expect(buryFrame(0, MOUND_START_S * 1000 - 1, false).mound).toBe(0);
    expect(buryFrame(5000, 0, false)).toEqual({ sink: 0, mound: 0, stake: 0 }); // a clock before the start is the start
    // With a gravedigger the stake waits for him: none with the full mound, then it rises over its own time.
    const later = { at: 2.4, duration: 0.3 };
    expect(buryFrame(0, SINK_S * 1000, false, later)).toEqual({ sink: 1, mound: 1, stake: 0 });
    expect(buryFrame(0, 2550, false, later).stake).toBeCloseTo(0.5);
    expect(buryFrame(0, 3000, false, later).stake).toBe(1);
    expect(buryFrame(0, 0, true, later)).toEqual({ sink: 1, mound: 1, stake: 1 });
  });
});

describe('picking an overridden grave', () => {
  it('stays on the grave\'s slot, from the ground up, and replaces only that grave\'s box', () => {
    const prs = new Map([...unused.slice(0, 3).map((s) => [`file:${s.file.path}`, pr('bury', 1)] as const), [`ghost:${model.ghosts[1]!.ghost.path}`, pr('resurrect', 2)] as const]);
    const overrides = overridesOf(model, prs);
    const targets = pickTargetsWith(model, overrides);
    expect(targets).toHaveLength(model.pickTargets.length);
    for (const o of overrides) {
      const box = overridePickTarget(o, model);
      const at = o.kind === 'buried' ? model.stones[o.index]!.layout : model.ghosts[o.index]!.layout;
      expect(box.min.x < at.x && at.x < box.max.x && box.min.z < at.z && at.z < box.max.z).toBe(true);
      expect(box.min.y).toBe(0);
      const stake = stakeSpot(o, model);
      expect(stake.x > box.min.x && stake.x < box.max.x && stake.z > box.min.z && stake.z < box.max.z).toBe(true);
      expect(targets.filter((t) => t.path === o.path && t.kind === box.kind)).toEqual([box]);
    }
    const changed = targets.filter((t, i) => t !== model.pickTargets[i]);
    expect(changed).toHaveLength(overrides.length);
    expect(pickTargetsWith(model, [])).toBe(model.pickTargets);
  });

  it('gives the new stone the graveyard\'s shortest height', () => {
    expect(risenHeight(model)).toBe(Math.min(...model.stones.map((s) => s.layout.height)));
    expect(risenHeight({ stones: [] })).toBeGreaterThan(0);
  });
});

describe('the stake and the legend', () => {
  it('writes "PR #" and up to four digits', () => {
    const PR = [P_GLYPH, R_GLYPH, SPACE_GLYPH, HASH_GLYPH];
    expect(markerGlyphs(12)).toEqual([...PR, 1, 2]);
    expect(markerGlyphs(1)).toEqual([...PR, 1]);
    expect(markerGlyphs(123456)).toEqual([...PR, 3, 4, 5, 6]);
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (n) => markerGlyphs(n).slice(4).join('') === String(n)));
  });

  it('keeps the grave, the stake and its plaque inside the stone\'s layout cell', () => {
    for (const kind of ['buried', 'risen'] as const) {
      const e = marksExtent(kind);
      expect(e.minX, kind).toBeGreaterThanOrEqual(-CELL_HALF.x);
      expect(e.maxX, kind).toBeLessThanOrEqual(CELL_HALF.x);
      expect(e.minZ, kind).toBeGreaterThanOrEqual(-CELL_HALF.z);
      expect(e.maxZ, kind).toBeLessThanOrEqual(CELL_HALF.z);
    }
  });

  it('lays the grave lengthwise, front to back, with the stake at its head', () => {
    const o = overridesOf(model, new Map([[`file:${unused[0]!.file.path}`, pr('bury', 1)]]))[0]!;
    const at = model.stones[o.index]!.layout;
    const box = overridePickTarget(o, model);
    expect(box.max.z - box.min.z).toBeGreaterThan(box.max.x - box.min.x);
    expect(stakeSpot(o, model)).toEqual({ x: at.x, z: expect.any(Number) });
    expect(stakeSpot(o, model).z).toBeLessThan(at.z);
  });

  it('explains what is shown, each kind only when it is', () => {
    const buried = overridesOf(model, new Map([[`file:${unused[0]!.file.path}`, pr('bury', 1)]]));
    const risen = overridesOf(model, new Map([[`ghost:${model.ghosts[0]!.ghost.path}`, pr('resurrect', 1)]]));
    expect(prLegendLines([])).toEqual([]);
    expect(prLegendLines(buried).map((l) => l.id)).toEqual(['pr-buried']);
    expect(prLegendLines(risen)).toEqual([{ id: 'pr-risen', title: 'Clean stone with a stake', text: "A pull request to restore this file is open. Its height doesn't show its size." }]);
    expect(prLegendLines([...buried, ...risen]).map((l) => l.id)).toEqual(['pr-buried', 'pr-risen']);
  });
});

describe('Resurrect: the scream and the rise', () => {
  it('P: whatever the moment, it ends above where it started, fully faded, with the stone in place; and stays so', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), fc.double({ min: 0, max: 60_000, noNaN: true }), (start, after) => {
        const end = riseFrame(start, start + RISE_END_S * 1000 + after, false);
        expect(end.rise).toBeCloseTo(RISE_H);
        expect(end.rise).toBeGreaterThan(0);
        expect(end.fade).toBe(0);
        expect(end.solid).toBe(1);
        expect(end.mouth).toBe(1);
      }),
    );
  });

  it('P: the mouth is open before it rises; it rises faster and faster; the stone starts forming only once it is halfway up', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: RISE_END_S * 1000, noNaN: true }), (t) => {
        const f = riseFrame(0, t, false);
        if (f.rise > 0) expect(f.mouth).toBe(1);
        if (f.solid > 0) expect(f.rise).toBeGreaterThanOrEqual(RISE_H / 2 - 1e-9);
        if (f.rise < RISE_H / 2 - 1e-6) expect(f.solid).toBe(0);
        // Accelerating: during the rise, the rise in the next 0.1 s is never less than in the last.
        const step = 100;
        if (t >= step && t + step <= (MOUTH_S + RISE_S) * 1000) expect(riseFrame(0, t + step, false).rise - f.rise).toBeGreaterThanOrEqual(f.rise - riseFrame(0, t - step, false).rise - 1e-9);
      }),
    );
  });

  it('starts as the ghost was, stretches upward and fades out over the 1.8 s rise', () => {
    expect(riseFrame(0, 0, false)).toEqual({ mouth: 0, rise: 0, stretch: 1, fade: 1, solid: 0 });
    expect(riseFrame(0, MOUTH_S * 1000, false)).toMatchObject({ mouth: 1, rise: 0, fade: 1 });
    expect(riseFrame(0, (MOUTH_S + RISE_S) * 1000, false).stretch).toBeGreaterThan(1.2);
    expect(riseFrame(0, FORM_AT_S * 1000, false).rise).toBeCloseTo(RISE_H / 2);
    expect(RISE_S).toBeGreaterThanOrEqual(1.5);
    expect(RISE_S).toBeLessThanOrEqual(2);
    expect(RISE_H).toBeGreaterThanOrEqual(3);
    expect(RISE_H).toBeLessThanOrEqual(4);
  });

  it('while the request runs the ghost shivers, growing to full in 0.3 s', () => {
    expect(ghostWait(1000, 1000, false)).toBe(0);
    expect(ghostWait(1000, 1300, false)).toBe(1);
    expect(ghostWait(1000, 99_999, false)).toBe(1);
    expect(ghostWait(1000, 1150, false)).toBeCloseTo(0.5);
  });
});
