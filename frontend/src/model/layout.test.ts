import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { firstLayoutProblem } from '../../test/layout-checks';
import { graveyardFrom } from '../../test/make-graveyard';
import fc from 'fast-check';
import { shuffled, shuffledGraveyard } from '../../test/arbitraries';
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
import { blockShape, dirnameOf, layout, nearestExistingFolder, packItems, type PackInput } from './layout';
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

describe('packItems', () => {
  const item = (id: string, w: number, d: number): PackInput => ({ id, w, d });

  it('has nothing to place for nothing', () => {
    const packed = packItems([]);
    expect(packed.offsets.size).toBe(0);
    expect([packed.w, packed.d]).toEqual([0, 0]);
  });

  it('puts a single item at the corner and is as big as the item', () => {
    const packed = packItems([item('a', 7, 3)]);
    expect(packed.offsets.get('a')).toEqual({ x: 0, z: 0 });
    expect([packed.w, packed.d]).toEqual([7, 3]);
  });

  it('puts the largest item at the corner', () => {
    const packed = packItems([item('small', 3, 3), item('big', 20, 20), item('medium', 8, 8)]);
    expect(packed.offsets.get('big')).toEqual({ x: 0, z: 0 });
  });

  it('breaks a tie of size by the longer side, then by id, whatever the order of the items', () => {
    const items = [item('b', 5, 5), item('a', 5, 5)];
    expect(packItems(items).offsets.get('a')).toEqual({ x: 0, z: 0 });
    expect(packItems([...items].reverse()).offsets.get('a')).toEqual({ x: 0, z: 0 });
  });

  it('fills the gaps beside a big item with small ones instead of starting a new row', () => {
    // One big item and many small ones: a shelf packer would waste the ground beside the small ones.
    const items = [item('big', 30, 30), ...Array.from({ length: 6 }, (_, i) => item(`s${i}`, 8, 8))];
    const packed = packItems(items);
    const ground = items.reduce((sum, it) => sum + it.w * it.d, 0);
    expect(packed.w * packed.d).toBeLessThan(ground * 1.8);
  });

  it('comes out close to a square when there are many items of similar size', () => {
    const packed = packItems(Array.from({ length: 36 }, (_, i) => item(`p${String(i).padStart(2, '0')}`, 5.4, 4.8)));
    expect(Math.max(packed.w, packed.d) / Math.min(packed.w, packed.d)).toBeLessThan(1.35);
  });

  it('is much better than one long row for 36 equal items', () => {
    const items = Array.from({ length: 36 }, (_, i) => item(`p${i}`, 5, 5));
    const packed = packItems(items);
    const oneRow = 36 * 5 + 35 * ITEM_GAP;
    expect(Math.max(packed.w, packed.d)).toBeLessThan(oneRow / 3);
  });
});

describe('packItems for any items', () => {
  // Items as the layout makes them are close to square: blocks of cells are near-square, and plots are packed into near-square
  // shapes. So the sizes here are anything from 3 to 60 units, with a shape no more than twice as long as wide.
  const itemsArb = fc
    .array(fc.record({ w: fc.double({ min: 3, max: 60, noNaN: true }), ratio: fc.double({ min: 0.5, max: 2, noNaN: true }) }), { maxLength: 40 })
    .map((list) => list.map((it, i): PackInput => ({ id: `i${String(i).padStart(3, '0')}`, w: it.w, d: it.w * it.ratio })));

  it('never overlaps two items, and keeps at least ITEM_GAP between them', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const packed = packItems(items);
        const rects = items.map((it) => ({ id: it.id, ...packed.offsets.get(it.id)!, w: it.w, d: it.d }));
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!;
            const b = rects[j]!;
            const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
            const gapZ = Math.max(b.z - (a.z + a.d), a.z - (b.z + b.d));
            if (Math.max(gapX, gapZ) < ITEM_GAP - 1e-6) return false;
          }
        }
        return true;
      }),
    );
  });

  it('has every item inside the packed area, which touches the items on its far sides and has no margin on its near sides', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        if (items.length === 0) return true;
        const packed = packItems(items);
        let right = 0;
        let bottom = 0;
        let left = Infinity;
        let top = Infinity;
        for (const it of items) {
          const o = packed.offsets.get(it.id)!;
          right = Math.max(right, o.x + it.w);
          bottom = Math.max(bottom, o.z + it.d);
          left = Math.min(left, o.x);
          top = Math.min(top, o.z);
        }
        return Math.abs(right - packed.w) < 1e-9 && Math.abs(bottom - packed.d) < 1e-9 && Math.abs(left) < 1e-9 && Math.abs(top) < 1e-9;
      }),
    );
  });

  it('gives every item exactly one place, and none to anything else', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const packed = packItems(items);
        return packed.offsets.size === items.length && items.every((it) => packed.offsets.has(it.id));
      }),
    );
  });

  it('gives the same result whatever order the items are given in', () => {
    fc.assert(
      fc.property(itemsArb, fc.integer({ min: 0, max: 1_000_000 }), (items, seed) => {
        const first = packItems(items);
        const second = packItems(shuffled(items, seed));
        return (
          first.w === second.w &&
          first.d === second.d &&
          items.every((it) => first.offsets.get(it.id)!.x === second.offsets.get(it.id)!.x && first.offsets.get(it.id)!.z === second.offsets.get(it.id)!.z)
        );
      }),
    );
  });

  it('uses little more ground than the items need: at most twice their area with the gaps counted', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        if (items.length === 0) return true;
        const packed = packItems(items);
        const held = items.reduce((sum, it) => sum + (it.w + ITEM_GAP) * (it.d + ITEM_GAP), 0);
        return (packed.w + ITEM_GAP) * (packed.d + ITEM_GAP) <= 2 * held + 1e-6;
      }),
    );
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
    // Every folder holds a file, so every folder has its own plot.
    const l = layout(graveyardFrom({ files: ['a/x.ts', 'a/b/c.ts', 'd.ts'] }));
    expect(l.plots.map((p) => [p.path, p.parent, p.depth, p.label])).toEqual([
      ['', null, 0, ''],
      ['a', '', 1, 'a'],
      ['a/b', 'a', 2, 'b'],
    ]);
    expect(l.plots.map((p) => p.folders)).toEqual([[''], ['a'], ['a/b']]);
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

  it('puts the biggest plot in the corner, and packs the smaller ones beside and below it', () => {
    const root = plotOf(l, '').rect;
    const x = plotOf(l, 'x').rect; // holds two stones and a folder, so it is the biggest
    expect(x.x).toBeCloseTo(root.x + FENCE_BAND, 9);
    expect(x.z).toBeCloseTo(root.z + FENCE_BAND, 9);
    for (const small of ['y', 'z']) {
      const r = plotOf(l, small).rect;
      expect(r.w * r.d).toBeLessThan(x.w * x.d);
    }
  });

  it('treats the folder\'s own stones as one more item beside its plots, not as a strip of their own', () => {
    const block = l.blocks.find((b) => b.folder === '')!;
    const siblings = ['x', 'y', 'z'].map((name) => plotOf(l, name).rect);
    // The block does not overlap any plot, and is not always at the top: it is wherever the packing put it.
    for (const r of siblings) expect(overlaps(block.rect, r)).toBe(false);
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
  it('shows a chain of 300 empty folders as one plot, named for all of them, with one fence and one sign', () => {
    const chain = Array.from({ length: 300 }, (_, i) => `l${i}`).reduce<string[]>((paths, name, i) => [...paths, i === 0 ? name : `${paths[i - 1]}/${name}`], []);
    const g = graveyardFrom({ folders: [chain[299]!] });
    const l = layout(g);
    // Even the root is part of the chain: it holds nothing but the first folder.
    expect(l.plots.map((p) => p.path)).toEqual([chain[299]]);
    const merged = plotOf(l, chain[299]!);
    expect(merged.folders).toEqual(['', ...chain]);
    expect(merged.label).toBe(Array.from({ length: 300 }, (_, i) => `l${i}`).join('/'));
    expect(merged.depth).toBe(300);
    expect(merged.parent).toBeNull();
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(l.bounds.w).toBeCloseTo(2 * FENCE_BAND, 9); // one fence around nothing
  });

  it('lays out a chain of 300 folders that each hold a file, one plot for each, nested 300 deep', () => {
    const chain = Array.from({ length: 300 }, (_, i) => `l${i}`).reduce<string[]>((paths, name, i) => [...paths, i === 0 ? name : `${paths[i - 1]}/${name}`], []);
    const g = graveyardFrom({ files: chain.map((folder) => `${folder}/f.ts`) });
    const l = layout(g);
    expect(l.plots).toHaveLength(300); // the root holds only l0, so it is part of l0's plot
    expect(plotOf(l, chain[299]!).depth).toBe(300);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(Number.isFinite(l.bounds.w) && Number.isFinite(l.bounds.d)).toBe(true);
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

  it('handles a folder with no files and no children, and a chain of folders that hold only the next one', () => {
    const g = graveyardFrom({ folders: ['empty', 'only/children/here'] });
    const l = layout(g);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
    expect(plotOf(l, 'empty').rect.w).toBeCloseTo(2 * FENCE_BAND, 9);
    expect(l.plots.map((p) => p.path)).toEqual(['', 'empty', 'only/children/here']);
    expect(plotOf(l, 'only/children/here').label).toBe('only/children/here');
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

  it('oikos_ledger: every one of its 68 folders is in one plot, empty single-child folders are shown with the folder inside, 129 stones, no ghosts', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const l = layout(g);
    expect(l.plots.flatMap((p) => p.folders).sort()).toEqual(g.folders.map((f) => f.path).sort());
    expect(l.plots.length).toBeLessThan(68); // the deep tree has chains that are shown together
    expect(l.plots.some((p) => p.folders.length > 1)).toBe(true);
    expect(l.stones).toHaveLength(129);
    expect(l.ghosts).toHaveLength(0);
    expect(Math.max(...l.plots.map((p) => p.depth))).toBeGreaterThanOrEqual(4); // a deep tree
  });

  it('oikos_ledger: every plot that shows several folders is named by joining their own names', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const l = layout(g);
    const shown = l.plots.filter((p) => p.folders.length > 1).map((p) => [p.folders.join(' > '), p.label]);
    // Every merged plot is named by joining its folders' own names.
    for (const [chain, label] of shown) {
      expect(label).toBe(chain!.split(' > ').filter((f) => f !== '').map((f) => f.slice(f.lastIndexOf('/') + 1)).join('/'));
    }
  });

  it('oikos_ledger: the root is close to a square, with little empty ground', () => {
    const l = layout(loadRealGraveyard('demo.oikosledger'));
    const { w, d } = l.bounds;
    expect(Math.max(w, d) / Math.min(w, d)).toBeLessThan(1.6);
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

describe('folders shown together', () => {
  const plotWith = (l: ReturnType<typeof layout>, folder: string) => l.plots.find((p) => p.folders.includes(folder))!;

  it('shows a folder with only one folder inside it together with that folder, and names the plot for both', () => {
    // app/api/accounts holds nothing but compare, which holds the file.
    const g = graveyardFrom({ files: ['app/api/accounts/compare/route.ts', 'app/api/other.ts'] });
    const l = layout(g);
    const merged = plotWith(l, 'app/api/accounts');
    expect(merged.folders).toEqual(['app/api/accounts', 'app/api/accounts/compare']);
    expect(merged.path).toBe('app/api/accounts/compare');
    expect(merged.label).toBe('accounts/compare');
    expect(merged.parent).toBe('app/api');
    expect(firstLayoutProblem(g, l)).toBeUndefined();
  });

  it('keeps the stone\'s real folder, so the hover label can show the full path', () => {
    const g = graveyardFrom({ files: ['app/api/accounts/compare/route.ts', 'app/api/other.ts'] });
    const l = layout(g);
    expect(l.stones.find((s) => s.path === 'app/api/accounts/compare/route.ts')!.folder).toBe('app/api/accounts/compare');
  });

  it('shows a whole chain as one plot: app, app/api and app/api/accounts hold only the next folder', () => {
    const g = graveyardFrom({ files: ['app/api/accounts/x.ts'] });
    const l = layout(g);
    expect(l.plots.map((p) => p.path)).toEqual(['app/api/accounts']);
    expect(plotWith(l, 'app').folders).toEqual(['', 'app', 'app/api', 'app/api/accounts']); // the root too: it holds only app
    expect(plotWith(l, 'app').label).toBe('app/api/accounts');
  });

  it('shows the root together with the folder inside it when the root holds nothing else, so there is no thin outer plot', () => {
    const l = layout(graveyardFrom({ files: ['only/f.ts'] }));
    expect(l.plots.map((p) => p.folders)).toEqual([['', 'only']]);
    expect(l.plots[0]!.label).toBe('only');
    expect(l.plots[0]!.parent).toBeNull();
    expect(l.plots[0]!.depth).toBe(1);
    expect(l.bounds).toEqual(l.plots[0]!.rect);
  });

  it('keeps the root as a plot of its own when it holds a file, a ghost, or more than one folder', () => {
    expect(layout(graveyardFrom({ files: ['root.ts', 'only/f.ts'] })).plots.map((p) => p.folders)).toEqual([[''], ['only']]);
    expect(layout(graveyardFrom({ files: ['only/f.ts'], ghosts: ['gone.ts'] })).plots.map((p) => p.folders)).toEqual([[''], ['only']]);
    expect(layout(graveyardFrom({ files: ['a/f.ts', 'b/f.ts'] })).plots.map((p) => p.folders)).toEqual([[''], ['a'], ['b']]);
  });

  it('an empty graveyard is a root plot and nothing else', () => {
    const l = layout(graveyardFrom({}));
    expect(l.plots.map((p) => p.folders)).toEqual([['']]);
  });

  it('does not show a folder together with the one inside it when it holds a file', () => {
    const l = layout(graveyardFrom({ files: ['a/own.ts', 'a/b/c.ts'] }));
    expect(l.plots.map((p) => p.path)).toEqual(['a', 'a/b']); // the root holds only a, so it joins a
    expect(l.plots[0]!.folders).toEqual(['', 'a']);
  });

  it('does not show a folder together with the one inside it when it holds a ghost, and stops the chain there', () => {
    // a holds only b, but a ghost of a/gone.ts stood in a: so a keeps its plot.
    const g = graveyardFrom({ files: ['a/b/c.ts'], ghosts: ['a/gone.ts'] });
    const l = layout(g);
    expect(l.plots.map((p) => p.path)).toEqual(['a', 'a/b']); // a keeps its plot (it holds the ghost); the root joins it
    expect(l.ghosts[0]!.folder).toBe('a');
    expect(firstLayoutProblem(g, l)).toBeUndefined();
  });

  it('shows the folders above a ghost\'s folder together, and those below it together', () => {
    // top > mid has a ghost > low1 > low2 holds the file. top is empty with one child, so it joins mid (which holds the ghost).
    const g = graveyardFrom({ files: ['top/mid/low1/low2/f.ts'], ghosts: ['top/mid/gone.ts'] });
    const l = layout(g);
    expect(l.plots.map((p) => p.folders)).toEqual([['', 'top', 'top/mid'], ['top/mid/low1', 'top/mid/low1/low2']]);
    expect(l.plots.map((p) => p.label)).toEqual(['top/mid', 'low1/low2']);
    expect(firstLayoutProblem(g, l)).toBeUndefined();
  });

  it('does not show a folder together with its child when it has two children', () => {
    const l = layout(graveyardFrom({ files: ['a/x/f.ts', 'a/y/f.ts'] }));
    expect(l.plots.map((p) => p.path)).toEqual(['a', 'a/x', 'a/y']); // the root holds only a, so it joins a
  });

  it('puts a ghost whose folder is gone in the nearest folder, even when that folder is shown with another', () => {
    // The ghost's old folder p/q no longer exists. p exists and is empty with one child r: but p now holds a ghost, so it is not merged.
    const g = graveyardFrom({ files: ['p/r/f.ts'], ghosts: ['p/q/gone.ts'] });
    const l = layout(g);
    expect(l.ghosts[0]!.folder).toBe('p');
    expect(l.plots.map((p) => p.path)).toEqual(['p', 'p/r']);
  });

  it('gives the plot the depth of its last folder, for the tint of its floor', () => {
    const l = layout(graveyardFrom({ files: ['a/b/c/f.ts'] }));
    expect(plotWith(l, 'a').depth).toBe(3);
  });

  it('saves a fence for every folder that is shown with the one inside it', () => {
    const together = layout(graveyardFrom({ files: ['a/b/c/f.ts'] }));
    const apart = layout(graveyardFrom({ files: ['a/f.ts', 'a/b/f.ts', 'a/b/c/f.ts'] }));
    expect(together.plots).toHaveLength(1);
    expect(apart.plots).toHaveLength(3); // a, a/b and a/b/c, with the root in a's
    expect(together.bounds.w * together.bounds.d).toBeLessThan(apart.bounds.w * apart.bounds.d);
  });

  it('is the same when the data file lists its folders in another order', () => {
    const g = graveyardFrom({ files: ['a/b/c/f.ts', 'a/b/c/g.ts', 'x/y/z.ts'], ghosts: ['a/gone.ts'] });
    expect(JSON.stringify(layout(shuffledGraveyard(g, 11)))).toBe(JSON.stringify(layout(g)));
  });
});
