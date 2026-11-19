import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ghostBaseHeight } from './ghost-motion';
import { selectionRingHeight, RING_LIFT } from './selection-ring';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT } from './visual-constants';
import { buildPickTargets } from './pick';
import { ghostVisual } from './visual-params';

const visual = (path: string) => ghostVisual({ path, deletedInSha: 'a'.repeat(40), deletedDate: '2024-01-01T00:00:00.000Z', deletedBy: 'someone', lastExistingSha: 'b'.repeat(40) });

describe('ghostBaseHeight', () => {
  it('keeps a clear gap under the ghost, at every time', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.double({ min: 0, max: 1e5, noNaN: true }), (path, seconds) => {
        return ghostBaseHeight(visual(path), seconds) - GHOST_FLOAT_AMPLITUDE > 0.2;
      }),
    );
  });

  it('stays inside the range the picking box covers, at every time', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.double({ min: 0, max: 1e5, noNaN: true }), (path, seconds) => {
        const [box] = buildPickTargets([], [{ path, x: 0, z: 0 }]);
        const base = ghostBaseHeight(visual(path), seconds);
        return base >= box!.min.y && base + GHOST_HEIGHT <= box!.max.y;
      }),
    );
  });
});

describe('selectionRingHeight', () => {
  it('puts the ring of a stone just above the ground', () => {
    expect(selectionRingHeight(undefined, 0)).toBe(RING_LIFT);
    expect(selectionRingHeight(undefined, 123)).toBe(RING_LIFT);
  });

  it('puts the ring of a ghost at the ghost\'s base, well above the ground, and not on the ground under it', () => {
    const v = visual('src/gone.ts');
    expect(selectionRingHeight(v, 0)).toBeCloseTo(GHOST_FLOAT_BASE + RING_LIFT, 12);
    expect(selectionRingHeight(v, 0)).toBeGreaterThan(selectionRingHeight(undefined, 0) + 0.2);
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
