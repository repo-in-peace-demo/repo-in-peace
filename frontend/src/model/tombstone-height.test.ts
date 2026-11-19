import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LOC_AT_MAX_HEIGHT, MAX_STONE_H, MIN_STONE_H } from './layout-constants';
import { stoneHeight } from './tombstone-height';

describe('the height constants', () => {
  it('make a range: the largest stone is taller than the smallest, and the cap is above one line', () => {
    expect(MIN_STONE_H).toBeGreaterThan(0);
    expect(MAX_STONE_H).toBeGreaterThan(MIN_STONE_H);
    expect(LOC_AT_MAX_HEIGHT).toBeGreaterThan(1);
  });

  it('clamp the largest real file in the test data (6,451 lines)', () => {
    expect(LOC_AT_MAX_HEIGHT).toBeLessThan(6451);
  });
});

describe('stoneHeight examples', () => {
  it.each([0, 1])('gives the minimum for %i lines', (lines) => {
    expect(stoneHeight(lines)).toBe(MIN_STONE_H);
  });

  it.each([5000, 6451, 100_000, 1e12])('gives the maximum for %i lines', (lines) => {
    expect(stoneHeight(lines)).toBe(MAX_STONE_H);
  });

  it('gives the maximum for infinite lines, and never goes past it', () => {
    expect(stoneHeight(Number.POSITIVE_INFINITY)).toBe(MAX_STONE_H);
  });

  it('grows with the lines in between: 1, 10, 100, 1,000, 4,999, 5,000', () => {
    const heights = [1, 10, 100, 1000, 4999, 5000].map(stoneHeight);
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    expect(heights[4]!).toBeLessThan(MAX_STONE_H);
    expect(heights[5]!).toBe(MAX_STONE_H);
  });

  it('puts a 100-line file a little over halfway up the scale', () => {
    const t = Math.log(100) / Math.log(5000);
    expect(stoneHeight(100)).toBeCloseTo(MIN_STONE_H + (MAX_STONE_H - MIN_STONE_H) * t, 10);
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(0.6);
  });

  it('is a logarithmic scale: doubling the lines adds the same height anywhere below the cap', () => {
    const step = stoneHeight(20) - stoneHeight(10);
    for (const lines of [3, 10, 50, 300, 2000]) {
      expect(stoneHeight(lines * 2) - stoneHeight(lines)).toBeCloseTo(step, 9);
    }
  });
});

describe('P7: stone height', () => {
  const lines = fc.integer({ min: 0, max: 50_000 });

  it('never decreases as lines of code increase', () => {
    fc.assert(
      fc.property(lines, lines, (a, b) => {
        const [fewer, more] = a <= b ? [a, b] : [b, a];
        return stoneHeight(fewer) <= stoneHeight(more);
      }),
    );
  });

  it('stays within the minimum and the maximum, and is a finite number', () => {
    fc.assert(
      fc.property(lines, (n) => {
        const h = stoneHeight(n);
        return Number.isFinite(h) && h >= MIN_STONE_H && h <= MAX_STONE_H;
      }),
    );
  });

  it('is the minimum for 0 and 1 lines and the maximum from 5,000 lines up', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 }), fc.integer({ min: LOC_AT_MAX_HEIGHT, max: 10_000_000 }), (small, big) => {
        return stoneHeight(small) === MIN_STONE_H && stoneHeight(big) === MAX_STONE_H;
      }),
    );
  });

  it('is strictly taller for more lines below the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: LOC_AT_MAX_HEIGHT - 2 }), (n) => stoneHeight(n + 1) > stoneHeight(n)),
    );
  });

  it('depends on the lines alone: the same count always gives the same height', () => {
    fc.assert(fc.property(lines, (n) => stoneHeight(n) === stoneHeight(n)));
  });
});
