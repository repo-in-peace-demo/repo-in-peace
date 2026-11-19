import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ghostBaseHeight } from './ghost-motion';
import { selectionRingHeight, RING_LIFT } from './selection-ring';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT } from './visual-constants';
import { buildPickTargets } from './pick';
import { ghostVisual } from './visual-params';

const visual = (path: string) => ghostVisual({ path, deletedInSha: 'a'.repeat(40), deletedDate: '2024-01-01T00:00:00.000Z', deletedBy: 'someone', lastExistingSha: 'b'.repeat(40) });

describe('ghostBaseHeight', () => {
  it('floats the figure up and down by the amplitude around the float base, with the ghost\'s own speed and phase', () => {
    const v = visual('src/gone.ts');
    expect(ghostBaseHeight(v, 0)).toBeCloseTo(GHOST_FLOAT_BASE + v.floatAmplitude * Math.sin(v.phase), 12);
    const quarter = (Math.PI / 2 - v.phase) / v.floatSpeed; // where the bob is at its highest
    expect(ghostBaseHeight(v, quarter)).toBeCloseTo(GHOST_FLOAT_BASE + v.floatAmplitude, 12);
    expect(ghostBaseHeight(v, quarter + Math.PI / v.floatSpeed)).toBeCloseTo(GHOST_FLOAT_BASE - v.floatAmplitude, 12);
  });

  it('repeats every 2π over the speed seconds', () => {
    const v = visual('src/gone.ts');
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (t) => Math.abs(ghostBaseHeight(v, t) - ghostBaseHeight(v, t + (2 * Math.PI) / v.floatSpeed)) < 1e-9),
    );
  });

  it('keeps a clear gap under the ghost at every time: at least the base minus the amplitude, which is well off the ground', () => {
    expect(GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE).toBeGreaterThanOrEqual(0.4); // never closer to the ground than 0.4
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.double({ min: 0, max: 1e5, noNaN: true }), (path, seconds) => {
        return ghostBaseHeight(visual(path), seconds) >= GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE - 1e-12;
      }),
    );
  });

  it('stays inside the range the picking box covers, with the whole figure, at every time', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.double({ min: 0, max: 1e5, noNaN: true }), (path, seconds) => {
        const [box] = buildPickTargets([], [{ path, x: 0, z: 0 }]);
        const base = ghostBaseHeight(visual(path), seconds);
        return base >= box!.min.y - 1e-12 && base + GHOST_HEIGHT <= box!.max.y + 1e-12;
      }),
    );
  });

  it('differs from one ghost to the next, by the phase from the path', () => {
    const phases = new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((p) => visual(p).phase));
    expect(phases.size).toBeGreaterThan(1);
  });
});

describe('selectionRingHeight', () => {
  it('puts the ring of a stone just above the ground', () => {
    expect(selectionRingHeight(undefined, 0)).toBe(RING_LIFT);
    expect(selectionRingHeight(undefined, 123)).toBe(RING_LIFT);
  });

  it('puts the ring of a ghost at the ghost\'s base, well above the ground, and not on the ground under it', () => {
    const v = visual('src/gone.ts');
    expect(selectionRingHeight(v, 0)).toBeCloseTo(ghostBaseHeight(v, 0) + RING_LIFT, 12);
    expect(selectionRingHeight(v, 0)).toBeGreaterThan(selectionRingHeight(undefined, 0) + 0.2);
  });

  it('follows the bobbing ghost: at the top of its bob the ring is higher than at the bottom, by twice the amplitude', () => {
    const v = visual('src/gone.ts');
    const high = (Math.PI / 2 - v.phase) / v.floatSpeed;
    const low = high + Math.PI / v.floatSpeed;
    expect(selectionRingHeight(v, high) - selectionRingHeight(v, low)).toBeCloseTo(2 * v.floatAmplitude, 12);
  });

  it('follows the ghost wherever it is at the time: the ring is always the same distance above the ghost\'s base', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.double({ min: 0, max: 1e5, noNaN: true }), (path, seconds) => {
        const v = visual(path);
        return Math.abs(selectionRingHeight(v, seconds) - (ghostBaseHeight(v, seconds) + RING_LIFT)) < 1e-12;
      }),
    );
  });
});
