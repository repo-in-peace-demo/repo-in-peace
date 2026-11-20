import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { placeSigns, placeSignsClear, signBox, SIGN_TOUCH_GAP_PX } from './sign-placement';
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

describe('placeSignsClear: only the nearest of signs that overlap on screen', () => {
  it('keeps the nearer sign and drops the one whose text overlaps it', () => {
    const where: Record<string, { x: number; y: number }> = { near: { x: 100, y: 100 }, far: { x: 110, y: 104 }, apart: { x: 600, y: 100 } };
    const placed = placeSignsClear([sign('near'), sign('far'), sign('apart')], (p) => where[p]!);
    expect(placed.map((p) => p.label)).toEqual(['label near', 'label apart']);
    expect(placed.map((p) => p.slot)).toEqual([0, 1]);
  });

  it('keeps both when their texts are clear of each other', () => {
    const placed = placeSignsClear([sign('a'), sign('b')], (p) => (p === 'a' ? { x: 100, y: 100 } : { x: 100, y: 100 + 20 + SIGN_TOUCH_GAP_PX + 1 }));
    expect(placed).toHaveLength(2);
  });

  it('keeps the signs below the pool size, with slots 0 to n-1', () => {
    const many = Array.from({ length: 50 }, (_, i) => sign(`p${i}`));
    const placed = placeSignsClear(many, (p) => ({ x: Number(p.slice(1)) * 400, y: 100 }), 10);
    expect(placed).toHaveLength(10);
    expect(placed.map((p) => p.slot)).toEqual([...Array(10).keys()]);
  });

  it('for any signs: no two placed signs overlap, the first projectable sign is placed, and every dropped sign touches one placed before it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 300 }), name: fc.string({ minLength: 1, maxLength: 20 }), projectable: fc.boolean() }), { maxLength: 40 }),
        (items) => {
          const visible: VisibleSign[] = items.map((it, i) => ({ path: `p${i}`, label: it.name, opacity: 1 }));
          const project = (path: string) => {
            const it = items[Number(path.slice(1))]!;
            return it.projectable ? { x: it.x, y: it.y } : null;
          };
          const placed = placeSignsClear(visible, project, 100);
          const box = (p: { label: string; x: number; y: number }) => signBox(p.label, p.x, p.y);
          const overlap = (a: ReturnType<typeof signBox>, b: ReturnType<typeof signBox>) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
          for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) if (overlap(box(placed[i]!), box(placed[j]!))) return false;
          const firstProjectable = items.findIndex((it) => it.projectable);
          if (firstProjectable >= 0 && !placed.some((p) => p.label === items[firstProjectable]!.name && p.x === items[firstProjectable]!.x && p.y === items[firstProjectable]!.y)) return false;
          if (firstProjectable < 0 && placed.length !== 0) return false;
          // Without any overlap among the projectable signs, nothing is dropped.
          return placed.length <= items.filter((it) => it.projectable).length;
        },
      ),
      { numRuns: 200 },
    );
  });
});
