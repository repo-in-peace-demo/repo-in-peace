import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { placeSigns } from './sign-placement';
import { SIGN_MAX_VISIBLE, type VisibleSign } from './signs';

const sign = (path: string, opacity = 1): VisibleSign => ({ path, label: `label ${path}`, opacity });
const at = (x: number, y: number) => () => ({ x, y });

describe('placeSigns', () => {
  it('places nothing when no sign is visible', () => {
    expect(placeSigns([], at(1, 2))).toEqual([]);
  });

  it('gives the signs slots 0, 1, 2 in the order given, with their text, place and opacity', () => {
    const where: Record<string, { x: number; y: number }> = { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } };
    const placed = placeSigns([sign('a', 1), sign('b', 0.4)], (p) => where[p]!);
    expect(placed).toEqual([
      { slot: 0, label: 'label a', x: 10, y: 20, opacity: 1 },
      { slot: 1, label: 'label b', x: 30, y: 40, opacity: 0.4 },
    ]);
  });

  it('skips a sign that cannot be projected, and leaves no gap in the slots', () => {
    const placed = placeSigns([sign('a'), sign('behind'), sign('c')], (p) => (p === 'behind' ? null : { x: 1, y: 1 }));
    expect(placed.map((p) => [p.slot, p.label])).toEqual([[0, 'label a'], [1, 'label c']]);
  });

  it('never fills more than the pool, even when more signs are visible', () => {
    const many = Array.from({ length: 100 }, (_, i) => sign(`p${String(i).padStart(3, '0')}`));
    expect(placeSigns(many, at(0, 0))).toHaveLength(SIGN_MAX_VISIBLE);
    expect(placeSigns(many, at(0, 0), 5)).toHaveLength(5);
    expect(placeSigns(many, at(0, 0), 0)).toEqual([]);
  });

  it('keeps the nearest signs when the pool is full: the first ones in the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => sign(`p${i}`));
    expect(placeSigns(many, at(0, 0), 3).map((p) => p.label)).toEqual(['label p0', 'label p1', 'label p2']);
  });

  it('uses slots 0 to n-1 exactly once each and at most the pool size, for any signs and any that cannot be projected', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 80 }),
        fc.integer({ min: 0, max: 40 }),
        (projectable, poolSize) => {
          const visible = projectable.map((_, i) => sign(`p${i}`));
          const placed = placeSigns(visible, (path) => (projectable[Number(path.slice(1))] ? { x: 1, y: 2 } : null), poolSize);
          const expectedCount = Math.min(poolSize, projectable.filter(Boolean).length);
          return placed.length === expectedCount && placed.every((p, i) => p.slot === i);
        },
      ),
    );
  });
});
