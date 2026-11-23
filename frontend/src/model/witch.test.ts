import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FRAMING_TREE_AZIMUTHS_DEG, clearingCeilingDeg } from './horizon';
import {
  CANOPY_TOP_DEG,
  GAP_MAX_S,
  GAP_MIN_S,
  MOON_ANGULAR_RADIUS_DEG,
  MOON_AT,
  PASS_S,
  SKY_TOP_DEG,
  WITCH_HALF_SIZE_DEG,
  arcAt,
  firstPassStart,
  passStarts,
  skyDistanceDeg,
  witchAt,
} from './witch';

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
  it('first passes as the opening move settles, then every 45 to 60 seconds after a pass, the same in every run', () => {
    const first = firstPassStart(3.6);
    const starts = passStarts(first, 2000);
    expect(starts[0]).toBe(first);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]! - PASS_S;
      expect(gap).toBeGreaterThanOrEqual(GAP_MIN_S);
      expect(gap).toBeLessThanOrEqual(GAP_MAX_S);
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
