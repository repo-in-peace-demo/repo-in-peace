import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { layout } from '../src/model/layout';
import { graveyardFrom } from './make-graveyard';
import {
  cellOverlap,
  cellsVersusChildPlots,
  containment,
  coverage,
  firstLayoutProblem,
  firstOverlap,
  firstOverlapBruteForce,
  nonFinite,
  plotOverlap,
  signOverlap,
} from './layout-checks';
import type { Rect } from '../src/model/rect';

/**
 * The checkers used by the layout properties must be able to fail. These tests give them correct layouts, which
 * must pass, and broken layouts, which must not.
 */

const rect = fc.record({
  x: fc.integer({ min: 0, max: 60 }),
  z: fc.integer({ min: 0, max: 60 }),
  w: fc.integer({ min: 1, max: 15 }),
  d: fc.integer({ min: 1, max: 15 }),
});

describe('firstOverlap', () => {
  it('finds an overlap exactly when the slow way does, and the pair it returns really overlaps', () => {
    fc.assert(
      fc.property(fc.array(rect, { maxLength: 40 }), (rects) => {
        const items = rects.map((r, i) => ({ id: `r${i}`, rect: r as Rect }));
        const fast = firstOverlap(items);
        const slow = firstOverlapBruteForce(items);
        if (slow === undefined) return fast === undefined;
        return fast !== undefined && fast[0].rect.w > 0 && firstOverlapBruteForce([fast[0], fast[1]]) !== undefined;
      }),
    );
  });

  it('finds nothing in rectangles that only touch', () => {
    const items = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, rect: { x: i * 4, z: 0, w: 4, d: 4 } }));
    expect(firstOverlap(items)).toBeUndefined();
  });

  it('finds an overlap between rectangles that are far apart in the list', () => {
    const items = [
      { id: 'a', rect: { x: 0, z: 0, w: 10, d: 10 } },
      ...Array.from({ length: 30 }, (_, i) => ({ id: `far${i}`, rect: { x: 100 + i * 20, z: 0, w: 5, d: 5 } })),
      { id: 'b', rect: { x: 9, z: 9, w: 5, d: 5 } },
    ];
    const pair = firstOverlap(items);
    expect(pair?.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});

describe('the layout checkers', () => {
  // The root holds two stones and three child folders; a ghost sits in each of three places.
  const graveyard = graveyardFrom({
    files: ['a.ts', 'b.ts', 'x/a.ts', 'x/b.ts', 'y/a.ts', 'y/b.ts', 'z/a.ts', 'x/inner/c.ts'],
    ghosts: ['old.ts', 'x/old.ts', 'gone/deep/old.ts'],
  });
  const good = layout(graveyard);

  it('find no problem in a correct layout', () => {
    expect(firstLayoutProblem(graveyard, good)).toBeUndefined();
  });

  it('see two stones on the same ground', () => {
    const broken = structuredClone(good);
    broken.stones[1]!.cell = { ...broken.stones[0]!.cell };
    expect(cellOverlap(broken)).toMatch(/overlaps/);
  });

  it('see two sibling plots on the same ground', () => {
    const broken = structuredClone(good);
    const siblings = broken.plots.filter((p) => p.parent === '');
    expect(siblings.length).toBeGreaterThanOrEqual(2);
    siblings[1]!.rect = { ...siblings[0]!.rect };
    expect(plotOverlap(broken)).toMatch(/overlaps/);
  });

  it('see a stone standing on a child plot of its own folder', () => {
    const broken = structuredClone(good);
    const parentWithChild = broken.plots.find((p) => p.parent !== null && broken.stones.some((s) => s.folder === p.parent));
    expect(parentWithChild).toBeDefined();
    const stone = broken.stones.find((s) => s.folder === parentWithChild!.parent)!;
    stone.cell = { ...stone.cell, x: parentWithChild!.rect.x, z: parentWithChild!.rect.z };
    expect(cellsVersusChildPlots(broken)).toMatch(/overlaps/);
  });

  it('see a stone outside its plot, and a plot outside its parent', () => {
    const outside = structuredClone(good);
    outside.stones[0]!.cell = { ...outside.stones[0]!.cell, x: -50 };
    expect(containment(outside)).toMatch(/not inside/);

    const sticking = structuredClone(good);
    const child = sticking.plots.find((p) => p.parent !== null)!;
    child.rect = { ...child.rect, w: child.rect.w + 1000 };
    expect(containment(sticking)).toMatch(/not inside/);
  });

  it('see a stone, a ghost or a plot that is missing, or twice', () => {
    const missing = structuredClone(good);
    missing.stones.pop();
    expect(coverage(graveyard, missing)).toMatch(/stones/);

    const twice = structuredClone(good);
    twice.stones.push({ ...twice.stones[0]! });
    expect(coverage(graveyard, twice)).toMatch(/more than once/);

    const noGhost = structuredClone(good);
    noGhost.ghosts.pop();
    expect(coverage(graveyard, noGhost)).toMatch(/ghosts/);

    const noPlot = structuredClone(good);
    noPlot.plots.pop();
    expect(coverage(graveyard, noPlot)).toMatch(/plots/);
  });

  it('see a stone in a folder that is not its own', () => {
    const broken = structuredClone(good);
    broken.stones[0]!.folder = 'somewhere/else';
    expect(coverage(graveyard, broken)).toMatch(/not its own folder/);
  });

  it('see a number that is not finite', () => {
    const broken = structuredClone(good);
    broken.stones[0]!.height = Number.NaN;
    expect(nonFinite(broken)).toMatch(/NaN/);
    const infinite = structuredClone(good);
    infinite.bounds.w = Number.POSITIVE_INFINITY;
    expect(nonFinite(infinite)).toMatch(/Infinity/);
  });

  it('see a sign standing on a stone', () => {
    const broken = structuredClone(good);
    const plot = broken.plots.find((p) => broken.stones.some((s) => s.folder === p.path))!;
    const stone = broken.stones.find((s) => s.folder === plot.path)!;
    plot.sign.footprint = { ...stone.cell };
    expect(signOverlap(broken)).toMatch(/overlaps/);
  });
});
