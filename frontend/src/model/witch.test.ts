import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FRAMING_TREE_AZIMUTHS_DEG, clearingCeilingDeg } from './horizon';
import {
  CANOPY_TOP_DEG,
  MOON_ANGULAR_RADIUS_DEG,
  MOON_AT,
  PASS_S,
  SKY_TOP_DEG,
  WITCH_HALF_SIZE_DEG,
  arcAt,
  firstPassStart,
  skyDistanceDeg,
} from './witch';
import { WITCH_DUE_S, WITCH_EVERY_MIN_S, passStarts, witchAt } from './sky-director';

describe('the witch\'s path', () => {
  it('crosses the moon\'s disc on every pass', () => {
    const closest = Math.min(...Array.from({ length: 701 }, (_, i) => skyDistanceDeg(arcAt(i / 700), MOON_AT)));
    expect(closest).toBeLessThan(MOON_ANGULAR_RADIUS_DEG * 0.5);
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (u) => {
      // and with the bob, still within the disc at the middle of the pass
      return u < 0.45 || u > 0.55 || skyDistanceDeg(arcAt(u), MOON_AT) < MOON_ANGULAR_RADIUS_DEG;
    }));
  });

  it('stays in the sky: above every treetop and below the top of the frame, wherever she is and with the bob', () => {
    // Her path is fixed on the sky, so it is the same for every window shape; the window only decides how much sky shows around
    // the moon, and the moon is in every supported frame (framing tests).
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (u, bob) => {
        const p = arcAt(u);
        const el = p.elevationDeg + 0.12 * bob;
        const bottom = el - WITCH_HALF_SIZE_DEG * 0.6; // her lowest part (the bristles hang a little below the stick)
        const ceiling = Math.min(clearingCeilingDeg(p.azimuthDeg), CANOPY_TOP_DEG);
        return bottom > ceiling + 0.4 && el + WITCH_HALF_SIZE_DEG < SKY_TOP_DEG;
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps clear of the tall framing trees at the sides', () => {
    for (const az of FRAMING_TREE_AZIMUTHS_DEG) {
      expect(Math.min(Math.abs(arcAt(0).azimuthDeg - az), Math.abs(arcAt(1).azimuthDeg - az))).toBeGreaterThan(WITCH_HALF_SIZE_DEG + 2);
    }
  });
});

describe('the witch\'s timing', () => {
  // Scheduled by the sky director with the other sky events (sky-director.test.ts): 45 s apart at least, and due 50 s after her last
  // pass, so the next one starts within the longest other event and the longest quiet gap after that.
  it('first passes as the opening move settles, then every 45 to 69 seconds, the same in every run', () => {
    const first = firstPassStart(3.6);
    const starts = passStarts(first, 2000);
    expect(starts[0]).toBe(first);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(WITCH_EVERY_MIN_S);
      expect(gap).toBeLessThan(WITCH_DUE_S + 5 + 14);
    }
    expect(new Set(starts.slice(1).map((s, i) => Math.round(s - starts[i]!))).size).toBeGreaterThan(3); // a little variation
    expect(passStarts(first, 2000)).toEqual(starts);
  });

  it('is in the sky only during a pass, about 7 seconds, and never under reduced motion', () => {
    const first = firstPassStart(0);
    expect(witchAt(first - 0.01, first, false)).toBeNull();
    expect(witchAt(first + 3.5, first, false)?.progress).toBeCloseTo(0.5, 9);
    expect(witchAt(first + PASS_S + 1, first, false)).toBeNull();
    fc.assert(fc.property(fc.double({ min: 0, max: 10_000, noNaN: true }), (t) => witchAt(t, first, true) === null));
  });
});

import { FADE_S, passOpacity } from './witch';
describe('her fade', () => {
  it('fades in over the first 1.5 s and out over the last 1.5 s, fully there between', () => {
    expect(passOpacity(0)).toBe(0);
    expect(passOpacity(FADE_S)).toBe(1);
    expect(passOpacity(PASS_S / 2)).toBe(1);
    expect(passOpacity(PASS_S - FADE_S)).toBe(1);
    expect(passOpacity(PASS_S)).toBe(0);
  });

  it('changes smoothly frame to frame through a whole pass and across its ends: no jump to zero', () => {
    const first = firstPassStart(0);
    const frame = 1 / 60;
    let previous = 0; // before the pass she is not drawn: opacity 0
    let steepest = 0;
    for (let t = first - 1; t <= first + PASS_S + 1; t += frame) {
      const o = witchAt(t, first, false)?.opacity ?? 0;
      steepest = Math.max(steepest, Math.abs(o - previous));
      previous = o;
    }
    // A smoothstep over 1.5 s changes at most 1.5 / 1.5 s per second: 1/60 of that per frame, with a little margin.
    expect(steepest).toBeLessThan((1.5 / FADE_S) * frame * 1.05);
    fc.assert(fc.property(fc.double({ min: 0, max: PASS_S, noNaN: true }), (e) => passOpacity(e) >= 0 && passOpacity(e) <= 1));
  });
});
