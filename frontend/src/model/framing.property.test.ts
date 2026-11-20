import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { FRAME_BOTTOM, FRAME_MARGIN_X, HORIZON_FROM_TOP, establishingShot, legacyShot, projectToFrame, safeEstablishingShot } from './framing';
import { layout } from './layout';
import type { Rect } from './rect';
import { vec3 } from './vec3';

/**
 * Correctness properties of the establishing shot for every lens and window the app can have: a vertical field of view from
 * 45 to 75 degrees and a window from 1.0 to 2.4 times as wide as it is tall. For all of them the search finishes quickly (it never
 * reaches its cap) and the whole graveyard is in the frame; and the safe version used by the app never throws.
 */

const APP_FOV = fc.double({ min: 45, max: 75, noNaN: true });
const APP_ASPECT = fc.double({ min: 1, max: 2.4, noNaN: true });

/** Any rectangle a layout could give, from a single stone to a very long, thin graveyard, anywhere on the ground. */
const boundsArb: fc.Arbitrary<Rect> = fc.record({
  x: fc.double({ min: -500, max: 500, noNaN: true }),
  z: fc.double({ min: -500, max: 500, noNaN: true }),
  w: fc.double({ min: 1, max: 3000, noNaN: true }),
  d: fc.double({ min: 1, max: 3000, noNaN: true }),
});

/** A call of the search takes well under a millisecond; this is far above that, so only a runaway search (or a hang) fails, not a slow machine or a pause to collect garbage. */
const QUICK_MS = 100;

function cornersInFrame(bounds: Rect, fovY: number, aspect: number): boolean {
  const { pose, viewShift } = establishingShot(bounds, fovY, aspect);
  const corners = [vec3(bounds.x, 0, bounds.z), vec3(bounds.x + bounds.w, 0, bounds.z), vec3(bounds.x, 0, bounds.z + bounds.d), vec3(bounds.x + bounds.w, 0, bounds.z + bounds.d)];
  return corners.every((c) => {
    const at = projectToFrame(pose, fovY, aspect, viewShift, c);
    return (
      at !== null &&
      at.x >= FRAME_MARGIN_X - 1e-9 &&
      at.x <= 1 - FRAME_MARGIN_X + 1e-9 &&
      at.y <= FRAME_BOTTOM + 1e-9 &&
      at.y > HORIZON_FROM_TOP // on the ground, below the horizon, so inside the top of the frame too
    );
  });
}

function finishesQuickly(bounds: Rect, fovY: number, aspect: number): boolean {
  const start = performance.now();
  establishingShot(bounds, fovY, aspect); // throws if it reaches its cap, which fails the property
  return performance.now() - start < QUICK_MS;
}

describe('establishingShot, for every lens and window the app can have (45-75 degrees, 1.0-2.4 wide)', () => {
  it('finishes quickly, without reaching its search cap, for any graveyard rectangle', () => {
    fc.assert(fc.property(boundsArb, APP_FOV, APP_ASPECT, finishesQuickly), { numRuns: 500 });
  });

  it('has every corner of the graveyard in the frame, for any graveyard rectangle', () => {
    fc.assert(fc.property(boundsArb, APP_FOV, APP_ASPECT, cornersInFrame), { numRuns: 500 });
  });

  it('finishes quickly and has every corner in the frame for the bounds of any laid-out graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, APP_FOV, APP_ASPECT, (g, fovY, aspect) => {
        const { bounds } = layout(g);
        return finishesQuickly(bounds, fovY, aspect) && cornersInFrame(bounds, fovY, aspect);
      }),
      { numRuns: 60 },
    );
  });

  it('at the ends of the ranges too', () => {
    for (const fovY of [45, 75])
      for (const aspect of [1, 2.4])
        for (const bounds of [{ x: 0, z: 0, w: 1, d: 1 }, { x: 0, z: 0, w: 3000, d: 1 }, { x: 0, z: 0, w: 1, d: 3000 }, { x: 0, z: 0, w: 3000, d: 3000 }]) {
          expect(finishesQuickly(bounds, fovY, aspect)).toBe(true);
          expect(cornersInFrame(bounds, fovY, aspect)).toBe(true);
        }
  });
});

describe('safeEstablishingShot', () => {
  it('is the establishing shot, with no warning, for every lens and window the app can have', () => {
    fc.assert(
      fc.property(boundsArb, APP_FOV, APP_ASPECT, (b, fovY, aspect) => {
        const warnings: string[] = [];
        const shot = safeEstablishingShot(b, fovY, aspect, (m) => warnings.push(m));
        return warnings.length === 0 && JSON.stringify(shot) === JSON.stringify(establishingShot(b, fovY, aspect));
      }),
      { numRuns: 200 },
    );
  });

  it('never throws, and gives the legacy shot with one warning, for any lens from 1 to 179 degrees and any window, even a broken one', () => {
    fc.assert(
      fc.property(
        boundsArb,
        fc.double({ min: 1, max: 179, noNaN: true }),
        fc.oneof(fc.double({ min: 0.2, max: 4, noNaN: true }), fc.constantFrom(0, -1, Number.NaN, Number.POSITIVE_INFINITY)),
        (b, fovY, aspect) => {
          const warnings: string[] = [];
          const shot = safeEstablishingShot(b, fovY, aspect, (m) => warnings.push(m));
          const finite = [shot.pose.position.x, shot.pose.position.y, shot.pose.position.z, shot.viewShift].every(Number.isFinite);
          if (warnings.length === 0) return finite;
          return warnings.length === 1 && JSON.stringify(shot) === JSON.stringify(legacyShot(b, fovY)) && finite;
        },
      ),
      { numRuns: 300 },
    );
  });
});
