import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { FENCE_INSET, FENCE_POST_SPACING, GATE_WIDTH, fenceForPlot, fenceInstances } from './fences';
import { layout } from './layout';
import type { Rect } from './rect';

const EPS = 1e-9;

/** The numbers worked out the plain way from a plot's rectangle. */
function lines(rect: Rect) {
  const left = rect.x + FENCE_INSET;
  const right = rect.x + rect.w - FENCE_INSET;
  const back = rect.z + FENCE_INSET;
  const front = rect.z + rect.d - FENCE_INSET;
  const middle = (left + right) / 2;
  const halfGate = Math.max(0, Math.min(GATE_WIDTH / 2, (right - left) / 2 - 0.05));
  return { left, right, back, front, middle, halfGate };
}

/** Posts that are on one side of the fence, sorted along it. */
const along = (values: number[]) => [...values].sort((a, b) => a - b);

describe('fenceForPlot', () => {
  const rect: Rect = { x: 10, z: 20, w: 30, d: 20 };
  const f = fenceForPlot(rect);
  const l = lines(rect);

  it('has a post at each of the four corners of the fence line', () => {
    for (const [x, z] of [[l.left, l.back], [l.right, l.back], [l.left, l.front], [l.right, l.front]] as const) {
      expect(f.posts.some((p) => Math.abs(p.x - x) < EPS && Math.abs(p.z - z) < EPS)).toBe(true);
    }
  });

  it('keeps every post on the fence line, which is just inside the plot\'s edge', () => {
    for (const p of f.posts) {
      const onSide = Math.abs(p.x - l.left) < EPS || Math.abs(p.x - l.right) < EPS;
      const onEnd = Math.abs(p.z - l.back) < EPS || Math.abs(p.z - l.front) < EPS;
      const within = p.x >= l.left - EPS && p.x <= l.right + EPS && p.z >= l.back - EPS && p.z <= l.front + EPS;
      expect(within && (onSide || onEnd)).toBe(true);
    }
  });

  it('leaves a gate in the middle of the front, with a post at each side of it and none in it', () => {
    const front = f.posts.filter((p) => Math.abs(p.z - l.front) < EPS);
    expect(front.some((p) => Math.abs(p.x - (l.middle - l.halfGate)) < EPS)).toBe(true);
    expect(front.some((p) => Math.abs(p.x - (l.middle + l.halfGate)) < EPS)).toBe(true);
    expect(front.every((p) => Math.abs(p.x - l.middle) >= l.halfGate - EPS)).toBe(true);
  });

  it('is wider than the plaque, which stands in it', () => {
    expect(GATE_WIDTH).toBeGreaterThan(1.6);
    expect(l.halfGate * 2).toBeCloseTo(GATE_WIDTH, 9);
  });

  it('has five rails: the back, the two sides and the front on either side of the gate', () => {
    expect(f.rails).toHaveLength(5);
    expect(f.rails.filter((r) => r.axis === 'x')).toHaveLength(3);
    expect(f.rails.filter((r) => r.axis === 'z')).toHaveLength(2);
  });

  it('covers the whole fence line except the gate with rails', () => {
    const perimeter = 2 * (l.right - l.left) + 2 * (l.front - l.back);
    const total = f.rails.reduce((sum, r) => sum + r.length, 0);
    expect(total).toBeCloseTo(perimeter - 2 * l.halfGate, 9);
  });

  it('puts no rail across the gate', () => {
    for (const r of f.rails.filter((x) => x.axis === 'x' && Math.abs(x.z - l.front) < EPS)) {
      const from = r.x - r.length / 2;
      const to = r.x + r.length / 2;
      const overlap = Math.min(to, l.middle + l.halfGate) - Math.max(from, l.middle - l.halfGate);
      expect(overlap).toBeLessThanOrEqual(EPS);
    }
  });

  it('keeps posts no further than the spacing apart along the back and the sides', () => {
    const back = along(f.posts.filter((p) => Math.abs(p.z - l.back) < EPS).map((p) => p.x));
    for (let i = 1; i < back.length; i++) expect(back[i]! - back[i - 1]!).toBeLessThanOrEqual(FENCE_POST_SPACING + EPS);
    for (const x of [l.left, l.right]) {
      const side = along(f.posts.filter((p) => Math.abs(p.x - x) < EPS).map((p) => p.z));
      for (let i = 1; i < side.length; i++) expect(side[i]! - side[i - 1]!).toBeLessThanOrEqual(FENCE_POST_SPACING + EPS);
    }
  });

  it('has no two posts in the same place', () => {
    const keys = f.posts.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('works for the smallest plot, 3 by 3', () => {
    const small = fenceForPlot({ x: 0, z: 0, w: 3, d: 3 });
    expect(small.rails).toHaveLength(5);
    expect(small.posts.length).toBeGreaterThanOrEqual(6); // four corners and the two sides of the gate
    expect(small.posts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });
});

describe('fenceForPlot for any plot', () => {
  const size = fc.double({ min: 3, max: 300, noNaN: true });
  const plot = fc.record({ x: fc.double({ min: -500, max: 500, noNaN: true }), z: fc.double({ min: -500, max: 500, noNaN: true }), w: size, d: size });

  it('keeps every post on the fence line and out of the gate, and the rails add up to the fence minus the gate', () => {
    fc.assert(
      fc.property(plot, (rect) => {
        const f = fenceForPlot(rect);
        const l = lines(rect);
        const postsOk = f.posts.every((p) => {
          const within = p.x >= l.left - 1e-6 && p.x <= l.right + 1e-6 && p.z >= l.back - 1e-6 && p.z <= l.front + 1e-6;
          const onLine = Math.abs(p.x - l.left) < 1e-6 || Math.abs(p.x - l.right) < 1e-6 || Math.abs(p.z - l.back) < 1e-6 || Math.abs(p.z - l.front) < 1e-6;
          const inGate = Math.abs(p.z - l.front) < 1e-6 && Math.abs(p.x - l.middle) < l.halfGate - 1e-6;
          return within && onLine && !inGate;
        });
        const total = f.rails.reduce((sum, r) => sum + r.length, 0);
        const perimeter = 2 * (l.right - l.left) + 2 * (l.front - l.back);
        return postsOk && Math.abs(total - (perimeter - 2 * l.halfGate)) < 1e-6 && f.rails.length === 5 && f.posts.length >= 6;
      }),
    );
  });

  it('grows with the size of the plot: more perimeter, more posts', () => {
    fc.assert(
      fc.property(plot, fc.double({ min: 10, max: 200, noNaN: true }), (rect, extra) => {
        const bigger = { ...rect, w: rect.w + extra, d: rect.d + extra };
        return fenceForPlot(bigger).posts.length >= fenceForPlot(rect).posts.length;
      }),
    );
  });

  it('keeps every post within the spacing of the next along each side', () => {
    fc.assert(
      fc.property(plot, (rect) => {
        const f = fenceForPlot(rect);
        const l = lines(rect);
        const back = along(f.posts.filter((p) => Math.abs(p.z - l.back) < 1e-6).map((p) => p.x));
        const left = along(f.posts.filter((p) => Math.abs(p.x - l.left) < 1e-6).map((p) => p.z));
        const gaps = (values: number[]) => values.slice(1).every((v, i) => v - values[i]! <= FENCE_POST_SPACING + 1e-6);
        return gaps(back) && gaps(left);
      }),
    );
  });
});

describe('fenceInstances', () => {
  it('has five rails for every plot', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        return fenceInstances(l).rails.length === 5 * l.plots.length;
      }),
      { numRuns: 40 },
    );
  });

  it('puts the fence of every plot inside its rectangle, so the fences of two plots never share a post', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const { posts } = fenceInstances(l);
        const keys = new Set(posts.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`));
        return keys.size === posts.length && posts.every((p) => p.x >= l.bounds.x && p.x <= l.bounds.x + l.bounds.w && p.z >= l.bounds.z && p.z <= l.bounds.z + l.bounds.d);
      }),
      { numRuns: 40 },
    );
  });

  it('is the same every time', () => {
    const g = graveyardFrom({ files: ['a.ts', 'x/b.ts', 'x/y/c.ts'] });
    expect(JSON.stringify(fenceInstances(layout(g)))).toBe(JSON.stringify(fenceInstances(layout(g))));
  });

  it.each(REAL_GRAVEYARDS)('draws a fence around every plot of %s with about one post for every 1.5 units of fence', (name) => {
    const l = layout(loadRealGraveyard(name));
    const fence = fenceInstances(l);
    expect(fence.rails).toHaveLength(5 * l.plots.length);
    expect(fence.posts.length).toBeGreaterThanOrEqual(6 * l.plots.length);
    // At most one post for every spacing along the perimeter, plus a few for corners and the gate of each plot.
    const upper = l.plots.reduce((sum, p) => sum + (2 * (p.rect.w + p.rect.d)) / FENCE_POST_SPACING + 12, 0);
    expect(fence.posts.length).toBeLessThanOrEqual(upper);
  });
});
