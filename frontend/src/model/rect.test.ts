import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS, contains, overlaps, type Rect } from './rect';

const r = (x: number, z: number, w: number, d: number): Rect => ({ x, z, w, d });

describe('overlaps', () => {
  it('is true for rectangles that share ground', () => {
    expect(overlaps(r(0, 0, 4, 4), r(3, 3, 4, 4))).toBe(true);
    expect(overlaps(r(0, 0, 4, 4), r(1, 1, 1, 1))).toBe(true); // one inside the other
    expect(overlaps(r(0, 0, 4, 4), r(0, 0, 4, 4))).toBe(true); // identical
  });

  it('is false for rectangles that are apart', () => {
    expect(overlaps(r(0, 0, 4, 4), r(5, 0, 4, 4))).toBe(false);
    expect(overlaps(r(0, 0, 4, 4), r(0, 5, 4, 4))).toBe(false);
    expect(overlaps(r(0, 0, 4, 4), r(5, 5, 4, 4))).toBe(false);
  });

  it('is false for rectangles that only touch along an edge or at a corner', () => {
    expect(overlaps(r(0, 0, 4, 4), r(4, 0, 4, 4))).toBe(false);
    expect(overlaps(r(0, 0, 4, 4), r(0, 4, 4, 4))).toBe(false);
    expect(overlaps(r(0, 0, 4, 4), r(4, 4, 4, 4))).toBe(false);
  });

  it('is false for an overlap smaller than the tolerance, and true just above it', () => {
    expect(overlaps(r(0, 0, 4, 4), r(4 - EPS / 2, 0, 4, 4))).toBe(false);
    expect(overlaps(r(0, 0, 4, 4), r(4 - 1e-6, 0, 4, 4))).toBe(true);
  });

  it('is false for a rectangle with no area', () => {
    expect(overlaps(r(1, 1, 0, 0), r(0, 0, 4, 4))).toBe(false);
  });

  const rect = fc.record({
    x: fc.integer({ min: -50, max: 50 }),
    z: fc.integer({ min: -50, max: 50 }),
    w: fc.integer({ min: 1, max: 30 }),
    d: fc.integer({ min: 1, max: 30 }),
  });

  it('is symmetric', () => {
    fc.assert(fc.property(rect, rect, (a, b) => overlaps(a, b) === overlaps(b, a)));
  });

  it('is true for a rectangle and itself, and false for it and a copy moved right by its own width', () => {
    fc.assert(
      fc.property(rect, (a) => overlaps(a, a) && !overlaps(a, { ...a, x: a.x + a.w })),
    );
  });
});

describe('contains', () => {
  it('is true for a rectangle inside another, and for itself', () => {
    expect(contains(r(0, 0, 10, 10), r(2, 2, 3, 3))).toBe(true);
    expect(contains(r(0, 0, 10, 10), r(0, 0, 10, 10))).toBe(true);
  });

  it('is true for a rectangle that touches the edge from inside', () => {
    expect(contains(r(0, 0, 10, 10), r(7, 7, 3, 3))).toBe(true);
  });

  it('is false for a rectangle that sticks out on any side', () => {
    expect(contains(r(0, 0, 10, 10), r(-1, 2, 3, 3))).toBe(false);
    expect(contains(r(0, 0, 10, 10), r(2, -1, 3, 3))).toBe(false);
    expect(contains(r(0, 0, 10, 10), r(8, 2, 3, 3))).toBe(false);
    expect(contains(r(0, 0, 10, 10), r(2, 8, 3, 3))).toBe(false);
  });

  it('is false when the inner rectangle is bigger', () => {
    expect(contains(r(0, 0, 4, 4), r(0, 0, 5, 5))).toBe(false);
  });

  it('is transitive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (a, b, c) => {
          const outer = r(0, 0, 100, 100);
          const middle = r(a, a, 100 - a - b, 100 - a - b);
          const inner = r(a + c, a + c, Math.max(0, 100 - a - b - 2 * c), Math.max(0, 100 - a - b - 2 * c));
          return !(contains(outer, middle) && contains(middle, inner)) || contains(outer, inner);
        },
      ),
    );
  });
});
