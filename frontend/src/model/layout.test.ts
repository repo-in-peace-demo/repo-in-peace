import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { firstLayoutProblem } from '../../test/layout-checks';
import { graveyardFrom } from '../../test/make-graveyard';
import { shuffledGraveyard } from '../../test/arbitraries';
import {
  CELL_D,
  CELL_PITCH_X,
  CELL_PITCH_Z,
  CELL_W,
  FENCE_BAND,
  ITEM_GAP,
  MAX_STONE_H,
  MIN_STONE_H,
  SIGN_D,
  SIGN_W,
} from './layout-constants';
import { blockShape, dirnameOf, layout, nearestExistingFolder, packRows } from './layout';
import { stoneHeight } from './tombstone-height';
import { overlaps } from './rect';

const plotOf = (l: ReturnType<typeof layout>, path: string) => l.plots.find((p) => p.path === path)!;

describe('dirnameOf and nearestExistingFolder', () => {
  it.each([
    ['a.ts', ''],
    ['src/a.ts', 'src'],
    ['src/lib/a.ts', 'src/lib'],
    ['', ''],
  ])('the directory of %j is %j', (path, dir) => {
    expect(dirnameOf(path)).toBe(dir);
  });

  it('is the old folder when it still exists', () => {
    expect(nearestExistingFolder('src/lib/old.ts', new Set(['', 'src', 'src/lib']))).toBe('src/lib');
  });

  it('is the nearest ancestor when the old folder is gone', () => {
    expect(nearestExistingFolder('src/lib/deep/old.ts', new Set(['', 'src']))).toBe('src');
    expect(nearestExistingFolder('src/lib/deep/old.ts', new Set(['', 'src', 'src/lib']))).toBe('src/lib');
  });

  it('is the root when no ancestor exists, and for a file at the top level', () => {
    expect(nearestExistingFolder('gone/deeper/old.ts', new Set(['', 'src']))).toBe('');
    expect(nearestExistingFolder('old.ts', new Set(['', 'src']))).toBe('');
  });

  it('skips a missing folder between two that exist', () => {
    expect(nearestExistingFolder('a/b/c/d/old.ts', new Set(['', 'a', 'a/b/c/d']))).toBe('a/b/c/d');
    expect(nearestExistingFolder('a/b/c/old.ts', new Set(['', 'a', 'a/b/c/d']))).toBe('a');
  });
});

describe('blockShape', () => {
  it('is empty for no cells', () => {
    expect(blockShape(0)).toEqual({ columns: 0, rows: 0, w: 0, d: 0 });
  });

  it('is one cell for one stone', () => {
    expect(blockShape(1)).toEqual({ columns: 1, rows: 1, w: CELL_W, d: CELL_D });
  });

  it('is as wide as it needs, and no wider, for a few cells', () => {
    const two = blockShape(2);
    expect(two.columns).toBe(2);
    expect(two.rows).toBe(1);
    expect(two.w).toBeCloseTo(CELL_PITCH_X + CELL_W, 9);
  });

  it('is close to a square on the ground for the 68-file folder of the spatialql test file', () => {
    const shape = blockShape(68);
    expect(shape.columns * shape.rows).toBeGreaterThanOrEqual(68);
    expect(Math.max(shape.w, shape.d) / Math.min(shape.w, shape.d)).toBeLessThan(1.3);
  });

  it('has room for every cell, and no empty row, for any count', () => {
    for (let n = 1; n <= 2500; n++) {
      const { columns, rows } = blockShape(n);
      if (columns * rows < n) throw new Error(`${n} cells do not fit in ${columns} x ${rows}`);
      if ((rows - 1) * columns >= n) throw new Error(`${n} cells leave an empty row in ${columns} x ${rows}`);
    }
  });

  it('is within a factor of 1.5 of a square in world units from 20 cells up', () => {
    for (let n = 20; n <= 2500; n++) {
      const { w, d } = blockShape(n);
      const ratio = Math.max(w, d) / Math.min(w, d);
      if (ratio > 1.5) throw new Error(`${n} cells give a block of ${w} by ${d}`);
    }
  });
});

describe('packRows', () => {
  it('has nothing to place for nothing', () => {
    expect(packRows([])).toEqual({ offsets: [], w: 0, d: 0 });
  });

  it('puts a single item at the corner and is as big as the item', () => {
    expect(packRows([{ w: 7, d: 3 }])).toEqual({ offsets: [{ x: 0, z: 0 }], w: 7, d: 3 });
  });

  it('starts a new row for an item as wide as the widest one, whatever the gap', () => {
    // The widest item sets the target width, so no other item can share a row with it.
    const packed = packRows([{ w: 20, d: 2 }, { w: 20, d: 2 }]);
    expect(packed.offsets[0]).toEqual({ x: 0, z: 0 });
    expect(packed.offsets[1]!.x).toBe(0);
    expect(packed.offsets[1]!.z).toBeCloseTo(2 + ITEM_GAP, 9);
  });

  it('puts small items side by side, ITEM_GAP apart, when they fit the target width', () => {
    // Nine squares of side ITEM_GAP: the area is 9G², so the target is at least 3.75G. Two squares need 3G, three need 5G.
    const g = ITEM_GAP;
    const packed = packRows(Array.from({ length: 9 }, () => ({ w: g, d: g })));
    expect(packed.offsets[0]).toEqual({ x: 0, z: 0 });
    expect(packed.offsets[1]!.x).toBeCloseTo(2 * g, 9);
    expect(packed.offsets[1]!.z).toBe(0);
    expect(packed.offsets[2]!.x).toBe(0); // the third would pass the target
    expect(packed.offsets[2]!.z).toBeCloseTo(2 * g, 9);
  });

  it('starts a new row when the next item would pass the target, and never before the first item of a row', () => {
    const items = [{ w: 20, d: 5 }, { w: 3, d: 5 }, { w: 3, d: 5 }];
    const packed = packRows(items);
    expect(packed.offsets[0]).toEqual({ x: 0, z: 0 });
    // The widest item sets the target, so 20 + gap + 3 passes it and the second item goes on a new row.
    expect(packed.offsets[1]!.x).toBe(0);
    expect(packed.offsets[1]!.z).toBeCloseTo(5 + ITEM_GAP, 9);
  });

  it('keeps items in the order given', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ w: 3 + (i % 4), d: 2 + (i % 3) }));
    const packed = packRows(items);
    // Reading order: by row, then by column, is the order given.
    for (let i = 1; i < packed.offsets.length; i++) {
      const a = packed.offsets[i - 1]!;
      const b = packed.offsets[i]!;
      expect(b.z > a.z || (b.z === a.z && b.x > a.x)).toBe(true);
    }
  });

  it('never overlaps items, and keeps them inside the packed area, with the gap between neighbours', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ w: 2 + ((i * 7) % 9), d: 2 + ((i * 5) % 6) }));
    const packed = packRows(items);
    const rects = packed.offsets.map((o, i) => ({ x: o.x, z: o.z, w: items[i]!.w, d: items[i]!.d }));
    for (let i = 0; i < rects.length; i++) {
      expect(rects[i]!.x + rects[i]!.w).toBeLessThanOrEqual(packed.w + 1e-9);
      expect(rects[i]!.z + rects[i]!.d).toBeLessThanOrEqual(packed.d + 1e-9);
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
        // Not even closer than the gap in both directions at once.
        const gapX = Math.max(rects[j]!.x - (rects[i]!.x + rects[i]!.w), rects[i]!.x - (rects[j]!.x + rects[j]!.w));
        const gapZ = Math.max(rects[j]!.z - (rects[i]!.z + rects[i]!.d), rects[i]!.z - (rects[j]!.z + rects[j]!.d));
        expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(ITEM_GAP - 1e-9);
      }
    }
  });
});

describe('layout of simple graveyards', () => {
  it('has only the root plot for an empty graveyard, just big enough for its fence', () => {
    const l = layout(graveyardFrom({}));
    expect(l.plots).toHaveLength(1);
    expect(l.stones).toEqual([]);
    expect(l.ghosts).toEqual([]);
    expect(l.blocks).toEqual([]);
    expect(l.plots[0]!.rect).toEqual({ x: 0, z: 0, w: 2 * FENCE_BAND, d: 2 * FENCE_BAND });
    expect(l.bounds).toEqual(l.plots[0]!.rect);
  });

  it('puts the sign in the middle of the front edge, inside the fence band', () => {
    const plot = layout(graveyardFrom({})).plots[0]!;
    expect(plot.sign.footprint).toEqual({
      x: plot.rect.w / 2 - SIGN_W / 2,
      z: plot.rect.d - SIGN_D,
      w: SIGN_W,
      d: SIGN_D,
    });
    expect(plot.sign.x).toBeCloseTo(plot.rect.w / 2, 9);
    expect(plot.sign.z).toBeCloseTo(plot.rect.d - SIGN_D / 2, 9);
  });

  it('puts one stone in a cell just inside the fence, with the plot as big as the cell and the fence', () => {
    const l = layout(graveyardFrom({ files: [{ path: 'a.ts', linesOfCode: 100 }] }));
    const stone = l.stones[0]!;
    expect(stone.cell).toEqual({ x: FENCE_BAND, z: FENCE_BAND, w: CELL_W, d: CELL_D });
    expect(stone.x).toBeCloseTo(FENCE_BAND + CELL_W / 2, 9);
    expect(stone.z).toBeCloseTo(FENCE_BAND + CELL_D / 2, 9);
    expect(stone.height).toBe(stoneHeight(100));
    expect(l.plots[0]!.rect.w).toBeCloseTo(CELL_W + 2 * FENCE_BAND, 9);
    expect(l.plots[0]!.rect.d).toBeCloseTo(CELL_D + 2 * FENCE_BAND, 9);
  });

  it('gives a stone the height of its lines of code', () => {
    const l = layout(graveyardFrom({ files: [{ path: 'tiny.ts', linesOfCode: 1 }, { path: 'huge.ts', linesOfCode: 6451 }] }));
    expect(l.stones.find((s) => s.path === 'tiny.ts')!.height).toBe(MIN_STONE_H);
    expect(l.stones.find((s) => s.path === 'huge.ts')!.height).toBe(MAX_STONE_H);
  });

  it('places stones in order of path, row by row, whatever order the file lists them in', () => {
    const l = layout(graveyardFrom({ files: ['c.ts', 'a.ts', 'e.ts', 'b.ts', 'd.ts'] }));
    const readingOrder = [...l.stones].sort((p, q) => p.cell.z - q.cell.z || p.cell.x - q.cell.x).map((s) => s.path);
    expect(readingOrder).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
  });

  it('places ghosts after the stones of their folder', () => {
    const l = layout(graveyardFrom({ files: ['b.ts', 'c.ts'], ghosts: ['a-gone.ts'] }));
    const all = [...l.stones, ...l.ghosts].sort((p, q) => p.cell.z - q.cell.z || p.cell.x - q.cell.x).map((s) => s.path);
    expect(all).toEqual(['b.ts', 'c.ts', 'a-gone.ts']); // the ghost sorts first by name but comes last
  });

  it('sorts plots, stones and ghosts by path', () => {
    const l = layout(graveyardFrom({ files: ['z/a.ts', 'b.ts', 'a/x.ts'], ghosts: ['q.ts', 'a/old.ts'] }));
    expect(l.plots.map((p) => p.path)).toEqual(['', 'a', 'z']);
    expect(l.stones.map((s) => s.path)).toEqual(['a/x.ts', 'b.ts', 'z/a.ts']);
    expect(l.ghosts.map((g) => g.path)).toEqual(['a/old.ts', 'q.ts']);
  });

  it('records depth and parent of every plot', () => {
    const l = layout(graveyardFrom({ files: ['a/b/c.ts', 'd.ts'] }));
    expect(l.plots.map((p) => [p.path, p.parent, p.depth])).toEqual([
      ['', null, 0],
      ['a', '', 1],
      ['a/b', 'a', 2],
    ]);
  });
});

describe('nesting', () => {
  const g = graveyardFrom({ files: ['a.ts', 'b.ts', 'x/a.ts', 'x/b.ts', 'y/a.ts', 'z/a.ts', 'x/inner/c.ts'] });
  const l = layout(g);

  it('has no problem of any kind', () => {
    expect(firstLayoutProblem(g, l)).toBeUndefined();
  });

  it('puts child plots inside the content area of their parent, beside the parent\'s own block', () => {
    const root = plotOf(l, '');
    for (const child of ['x', 'y', 'z']) {
      const r = plotOf(l, child).rect;
      expect(r.x).toBeGreaterThanOrEqual(root.rect.x + FENCE_BAND - 1e-9);
      expect(r.z).toBeGreaterThanOrEqual(root.rect.z + FENCE_BAND - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(root.rect.x + root.rect.w - FENCE_BAND + 1e-9);
      expect(r.z + r.d).toBeLessThanOrEqual(root.rect.z + root.rect.d - FENCE_BAND + 1e-9);
    }
    const block = l.blocks.find((b) => b.folder === '')!;
    for (const child of ['x', 'y', 'z']) expect(overlaps(block.rect, plotOf(l, child).rect)).toBe(false);
  });

  it('places sibling plots in order of path', () => {
    const x = plotOf(l, 'x').rect;
    const y = plotOf(l, 'y').rect;
    const z = plotOf(l, 'z').rect;
    const before = (p: typeof x, q: typeof x) => p.z < q.z || (p.z === q.z && p.x < q.x);
    expect(before(x, y)).toBe(true);
    expect(before(y, z)).toBe(true);
  });

  it('makes the parent bigger for each level of nesting', () => {
    expect(plotOf(l, 'x').rect.w).toBeGreaterThan(plotOf(l, 'x/inner').rect.w);
    expect(plotOf(l, '').rect.w).toBeGreaterThan(plotOf(l, 'x').rect.w);
  });

  it('is the same when the data file lists its folders, files and ghosts in another order', () => {
    expect(JSON.stringify(layout(shuffledGraveyard(g, 7)))).toBe(JSON.stringify(l));
    expect(JSON.stringify(layout(shuffledGraveyard(g, 99)))).toBe(JSON.stringify(l));
  });
});

describe('ghost placement in the layout', () => {
  const g = graveyardFrom({
    files: ['a.ts', 'src/a.ts', 'src/lib/a.ts'],
    ghosts: ['gone.ts', 'src/gone.ts', 'src/lib/gone.ts', 'src/removed/gone.ts', 'src/removed/deep/gone.ts', 'vanished/deep/gone.ts'],
  });
  const l = layout(g);
  const folderOfGhost = (path: string) => l.ghosts.find((x) => x.path === path)!.folder;

  it('sits in the plot of its old folder when that still exists', () => {
    expect(folderOfGhost('gone.ts')).toBe('');
    expect(folderOfGhost('src/gone.ts')).toBe('src');
    expect(folderOfGhost('src/lib/gone.ts')).toBe('src/lib');
  });

  it('sits in the nearest existing ancestor when the folder is gone', () => {
    expect(folderOfGhost('src/removed/gone.ts')).toBe('src');
    expect(folderOfGhost('src/removed/deep/gone.ts')).toBe('src');
    expect(folderOfGhost('vanished/deep/gone.ts')).toBe('');
  });

  it('stands inside the plot it is assigned to, and overlaps nothing', () => {
    expect(firstLayoutProblem(g, l)).toBeUndefined();
  });
});

describe('extreme shapes', () => {
  it('lays out a chain of 300 empty folders, each plot 2 × FENCE_BAND bigger than the one inside it', () => {
    const chain = Array.from({ length: 300 }, (_, i) => `l${i}`).reduce<string[]>((paths, name, i) => [...paths, i === 0 ? name : `${paths[i - 1]}/${name}`], []);
    const g = graveyardFrom({ folders: [chain[299]!] });
    const l = layout(g);
    expect(l.plots).toHaveLength(301);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(l.bounds.w).toBeCloseTo(2 * FENCE_BAND * 301, 6);
    expect(plotOf(l, chain[299]!).depth).toBe(300);
  });

  it('lays out 600 files in one folder as a near-square block', () => {
    const g = graveyardFrom({ files: Array.from({ length: 600 }, (_, i) => `src/f${i}.ts`) });
    const l = layout(g);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    const src = plotOf(l, 'src').rect;
    expect(Math.max(src.w, src.d) / Math.min(src.w, src.d)).toBeLessThan(1.3);
    const shape = blockShape(600);
    expect(l.blocks.find((b) => b.folder === 'src')).toMatchObject({ columns: shape.columns, rows: shape.rows, count: 600 });
  });

  it('lays out 300 sibling folders without overlap, in rows rather than one long line', () => {
    const g = graveyardFrom({ files: Array.from({ length: 300 }, (_, i) => `pkg${String(i).padStart(3, '0')}/a.ts`) });
    const l = layout(g);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(Math.max(l.bounds.w, l.bounds.d) / Math.min(l.bounds.w, l.bounds.d)).toBeLessThan(2);
  });

  it('handles a folder with no files and no children, and one with only children', () => {
    const g = graveyardFrom({ folders: ['empty', 'only/children/here'] });
    const l = layout(g);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(plotOf(l, 'empty').rect.w).toBeCloseTo(2 * FENCE_BAND, 9);
  });

  it('handles names with spaces, dots and non-ASCII characters', () => {
    const g = graveyardFrom({ files: ['sp ace/é.ts', 'x.y/.hidden.ts', '日本/ファイル.ts'], ghosts: ['日本/old.ts'] });
    expect(firstLayoutProblem(g, layout(g))).toBeUndefined();
  });
});

describe('the real test files', () => {
  it.each(REAL_GRAVEYARDS)('%s lays out with no problem of any kind', (name) => {
    const g = loadRealGraveyard(name);
    expect(firstLayoutProblem(g, layout(g))).toBeUndefined();
  });

  it('oikos_ledger: one plot per folder (68), one stone per file (129), no ghosts', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const l = layout(g);
    expect(l.plots).toHaveLength(68);
    expect(l.stones).toHaveLength(129);
    expect(l.ghosts).toHaveLength(0);
    expect(Math.max(...l.plots.map((p) => p.depth))).toBeGreaterThanOrEqual(4); // a deep tree
  });

  it('spatialql: the crowded src folder is a near-square block, and the two ghosts are in the plots of their old folders', () => {
    const g = loadRealGraveyard('demo.spatialql');
    const l = layout(g);
    expect(l.plots.map((p) => p.path)).toEqual(['', 'src', 'src/data']);
    expect(l.stones).toHaveLength(120);

    const srcBlock = l.blocks.find((b) => b.folder === 'src')!;
    // 68 files directly in src, plus the ghost of src/surface-placement.ts
    expect(srcBlock.count).toBe(69);
    expect(Math.max(srcBlock.rect.w, srcBlock.rect.d) / Math.min(srcBlock.rect.w, srcBlock.rect.d)).toBeLessThan(1.3);

    expect(l.ghosts.map((x) => [x.path, x.folder])).toEqual([
      ['src/data/surface-placement.test.ts', 'src/data'],
      ['src/surface-placement.ts', 'src'],
    ]);
  });

  it('every stone height is within the range', () => {
    for (const name of REAL_GRAVEYARDS) {
      for (const stone of layout(loadRealGraveyard(name)).stones) {
        expect(stone.height).toBeGreaterThanOrEqual(MIN_STONE_H);
        expect(stone.height).toBeLessThanOrEqual(MAX_STONE_H);
      }
    }
  });

  it('is the same every time, and the same for the shuffled file', () => {
    const g = loadRealGraveyard('demo.spatialql');
    const once = JSON.stringify(layout(g));
    expect(JSON.stringify(layout(g))).toBe(once);
    expect(JSON.stringify(layout(shuffledGraveyard(g, 3)))).toBe(once);
  });
});

describe('cell pitch', () => {
  it('is what the block shape uses between neighbouring cells', () => {
    const g = graveyardFrom({ files: Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`) });
    const l = layout(g);
    const first = l.stones[0]!.cell;
    const second = l.stones[1]!.cell;
    expect(second.x - first.x).toBeCloseTo(CELL_PITCH_X, 9);
    const shape = blockShape(12);
    const nextRow = l.stones[shape.columns]!.cell;
    expect(nextRow.z - first.z).toBeCloseTo(CELL_PITCH_Z, 9);
  });
});
