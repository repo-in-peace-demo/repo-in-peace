import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FOV_Y } from './camera-pose';
import { OPENING_DURATION_MS, openingShot, safeEstablishingShot } from './framing';
import { HANDOVER_MS, HANDOVER_SETTLE_S, handoverShare, openingAt, playsOpening, settleShare } from './opening-move';
import { distance } from './vec3';

const bounds = { x: 0, z: 0, w: 62, d: 87 };
const from = openingShot(bounds, DEFAULT_FOV_Y, 1.6);
const to = safeEstablishingShot(bounds, DEFAULT_FOV_Y, 1.6);

describe('the opening move', () => {
  it('starts at the opening shot and arrives exactly at the establishing shot after 3 to 4 seconds', () => {
    expect(OPENING_DURATION_MS).toBeGreaterThanOrEqual(3000);
    expect(OPENING_DURATION_MS).toBeLessThanOrEqual(4000);
    expect(openingAt(from, to, 0)).toEqual({ shot: from, done: false });
    expect(openingAt(from, to, OPENING_DURATION_MS)).toEqual({ shot: to, done: true });
    expect(openingAt(from, to, OPENING_DURATION_MS * 5).shot).toBe(to);
  });

  it('for any time: it only comes nearer the establishing shot as time goes on, and is finite', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 10_000, noNaN: true }), fc.double({ min: 0, max: 2000, noNaN: true }), (t, later) => {
        const a = openingAt(from, to, t).shot;
        const b = openingAt(from, to, t + later).shot;
        const finite = [a.pose.position.x, a.pose.position.y, a.pose.position.z, a.viewShift].every(Number.isFinite);
        return finite && distance(b.pose.position, to.pose.position) <= distance(a.pose.position, to.pose.position) + 1e-9;
      }),
    );
  });

  it('hands over smoothly: 0 at the input, 1 after HANDOVER_MS, never falling', () => {
    expect(handoverShare(0)).toBe(0);
    expect(handoverShare(HANDOVER_MS)).toBe(1);
    fc.assert(fc.property(fc.double({ min: -100, max: 1000, noNaN: true }), fc.double({ min: 0, max: 500, noNaN: true }), (t, d) => handoverShare(t + d) >= handoverShare(t) && handoverShare(t) >= 0 && handoverShare(t) <= 1));
  });

  it('settles into the limits at the same pace whatever the frame rate, and nearly all the way by the end of the hand-over', () => {
    const left = (fps: number) => {
      let rest = 1;
      for (let t = 0; t < HANDOVER_MS / 1000; t += 1 / fps) rest *= 1 - settleShare(1 / fps);
      return rest;
    };
    expect(left(30)).toBeCloseTo(left(144), 2);
    expect(left(60)).toBeLessThan(0.01);
    // No big first step: one frame at 60 fps goes under 7% of the way.
    expect(settleShare(1 / 60)).toBeLessThan(0.07);
    expect(settleShare(0)).toBe(0);
    expect(HANDOVER_SETTLE_S).toBeGreaterThan(0);
  });

  it('does not play under reduced motion, or when turned off for a test', () => {
    expect(playsOpening(false, false)).toBe(true);
    expect(playsOpening(true, false)).toBe(false);
    expect(playsOpening(false, true)).toBe(false);
  });
});
