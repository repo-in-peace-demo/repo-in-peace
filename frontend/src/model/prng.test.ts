import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { intBetween, mulberry32, pick } from './prng';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('gives numbers in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const next = mulberry32(seed);
        for (let i = 0; i < 50; i++) {
          const v = next();
          if (!(v >= 0 && v < 1)) return false;
        }
        return true;
      }),
    );
  });

  it('is evenly spread: the mean of many values is near 0.5 and every tenth of the range is used', () => {
    const next = mulberry32(99);
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const v = next();
      sum += v;
      const bucket = Math.floor(v * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
    for (const count of buckets) expect(count).toBeGreaterThan(1700);
  });
});

describe('intBetween', () => {
  it('stays within the bounds, both included, and reaches both', () => {
    const next = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = intBetween(next, 3, 8);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('returns the only possible value when min equals max', () => {
    expect(intBetween(mulberry32(1), 5, 5)).toBe(5);
  });
});

describe('pick', () => {
  it('returns items of the list, and every item over time', () => {
    const next = mulberry32(3);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pick(next, items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('never goes past the end of the list, even for a generator that returns almost 1', () => {
    expect(pick(() => 0.9999999999, ['a', 'b'])).toBe('b');
  });
});
