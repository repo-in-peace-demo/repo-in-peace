import type { Graveyard } from '@shared/graveyard-schema';
import { FENCE_BAND } from '../src/model/layout-constants';
import type { Layout, PlotLayout } from '../src/model/layout';
import { EPS, contains, overlaps, type Rect } from '../src/model/rect';

/**
 * Checks on a layout, written separately from the code that builds it. Each returns a description of the
 * first problem found, or `undefined` when there is none, so a failing property test says what went wrong.
 */

interface Item {
  id: string;
  rect: Rect;
}

/**
 * The first two items whose rectangles overlap, or undefined. Sorts by the left edge and compares each item only
 * with those that start before it ends, so 2,000 items are checked quickly.
 */
export function firstOverlap(items: readonly Item[]): [Item, Item] | undefined {
  const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.rect.x >= a.rect.x + a.rect.w - EPS) break; // everything after b starts even further right
      if (overlaps(a.rect, b.rect)) return [a, b];
    }
  }
  return undefined;
}

/** The same answer as `firstOverlap`, the slow way. Used to test `firstOverlap` itself. */
export function firstOverlapBruteForce(items: readonly Item[]): [Item, Item] | undefined {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i]!.rect, items[j]!.rect)) return [items[i]!, items[j]!];
    }
  }
  return undefined;
}

const describePair = (what: string, pair: [Item, Item]): string => `${what}: ${pair[0].id} overlaps ${pair[1].id}`;

/** What a plot holds: its rectangle inset by the fence band. */
export function contentArea(plot: PlotLayout): Rect {
  return {
    x: plot.rect.x + FENCE_BAND,
    z: plot.rect.z + FENCE_BAND,
    w: Math.max(0, plot.rect.w - 2 * FENCE_BAND),
    d: Math.max(0, plot.rect.d - 2 * FENCE_BAND),
  };
}

/** P1, first part: no two stones or ghosts overlap, in the whole graveyard. */
export function cellOverlap(layout: Layout): string | undefined {
  const cells: Item[] = [
    ...layout.stones.map((s) => ({ id: `stone ${s.path}`, rect: s.cell })),
    ...layout.ghosts.map((g) => ({ id: `ghost ${g.path}`, rect: g.cell })),
  ];
  const pair = firstOverlap(cells);
  return pair && describePair('cells', pair);
}

/** P1, second part: no two plots overlap if they have the same parent, or the same depth anywhere. */
export function plotOverlap(layout: Layout): string | undefined {
  const byParent = new Map<string, Item[]>();
  const byDepth = new Map<number, Item[]>();
  for (const plot of layout.plots) {
    const item = { id: `plot "${plot.path}"`, rect: plot.rect };
    const parentKey = plot.parent ?? '(root)';
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), item]);
    byDepth.set(plot.depth, [...(byDepth.get(plot.depth) ?? []), item]);
  }
  for (const [parent, items] of byParent) {
    const pair = firstOverlap(items);
    if (pair) return describePair(`sibling plots under "${parent}"`, pair);
  }
  for (const [depth, items] of byDepth) {
    const pair = firstOverlap(items);
    if (pair) return describePair(`plots at depth ${depth}`, pair);
  }
  return undefined;
}

/** P1, third part: a folder's cells do not overlap its child plots. */
export function cellsVersusChildPlots(layout: Layout): string | undefined {
  const childPlots = new Map<string, PlotLayout[]>();
  for (const plot of layout.plots) {
    if (plot.parent !== null) childPlots.set(plot.parent, [...(childPlots.get(plot.parent) ?? []), plot]);
  }
  const cellsByFolder = new Map<string, Item[]>();
  for (const s of layout.stones) {
    cellsByFolder.set(s.folder, [...(cellsByFolder.get(s.folder) ?? []), { id: `stone ${s.path}`, rect: s.cell }]);
  }
  for (const g of layout.ghosts) {
    cellsByFolder.set(g.folder, [...(cellsByFolder.get(g.folder) ?? []), { id: `ghost ${g.path}`, rect: g.cell }]);
  }
  for (const [folder, cells] of cellsByFolder) {
    const children = (childPlots.get(folder) ?? []).map((p) => ({ id: `child plot "${p.path}"`, rect: p.rect }));
    const pair = firstOverlap([...cells, ...children]);
    if (pair) return describePair(`inside plot "${folder}"`, pair);
  }
  return undefined;
}

/** P2: cells and blocks lie inside their plot's content area, child plots inside their parent's, signs inside the front band. */
export function containment(layout: Layout): string | undefined {
  const plotByPath = new Map(layout.plots.map((p) => [p.path, p] as const));

  for (const plot of layout.plots) {
    if (plot.parent !== null) {
      const parent = plotByPath.get(plot.parent);
      if (!parent) return `plot "${plot.path}" has a parent "${plot.parent}" that has no plot`;
      if (!contains(contentArea(parent), plot.rect)) return `plot "${plot.path}" is not inside the content area of "${plot.parent}"`;
    }
    const frontBand: Rect = {
      x: plot.rect.x,
      z: plot.rect.z + plot.rect.d - FENCE_BAND,
      w: plot.rect.w,
      d: FENCE_BAND,
    };
    if (!contains(frontBand, plot.sign.footprint)) return `the sign of plot "${plot.path}" is not inside its front fence band`;
  }
  for (const block of layout.blocks) {
    const plot = plotByPath.get(block.folder);
    if (!plot) return `block of folder "${block.folder}" has no plot`;
    if (!contains(contentArea(plot), block.rect)) return `block of "${block.folder}" is not inside the content area of its plot`;
  }
  for (const s of layout.stones) {
    const plot = plotByPath.get(s.folder);
    if (!plot) return `stone ${s.path} is in folder "${s.folder}", which has no plot`;
    if (!contains(contentArea(plot), s.cell)) return `stone ${s.path} is not inside the content area of "${s.folder}"`;
  }
  for (const g of layout.ghosts) {
    const plot = plotByPath.get(g.folder);
    if (!plot) return `ghost ${g.path} is in folder "${g.folder}", which has no plot`;
    if (!contains(contentArea(plot), g.cell)) return `ghost ${g.path} is not inside the content area of "${g.folder}"`;
  }
  if (!contains(layout.bounds, layout.plots.find((p) => p.path === '')?.rect ?? layout.bounds)) return 'the root plot is not inside the bounds';
  return undefined;
}

/** P4: one plot per folder, one stone per file, one ghost per ghost, and nothing more. */
export function coverage(graveyard: Graveyard, layout: Layout): string | undefined {
  const same = (what: string, expected: string[], actual: string[]): string | undefined => {
    const e = [...expected].sort();
    const a = [...actual].sort();
    if (new Set(a).size !== a.length) return `${what}: a path appears more than once`;
    if (e.length !== a.length || e.some((p, i) => p !== a[i])) return `${what}: expected ${e.length} paths, got ${a.length}, or different ones`;
    return undefined;
  };
  const folderOfFile = new Map(graveyard.files.map((f) => [f.path, f.folder] as const));
  const wrongFolder = layout.stones.find((s) => folderOfFile.get(s.path) !== s.folder);
  return (
    same('plots', graveyard.folders.map((f) => f.path), layout.plots.map((p) => p.path)) ??
    same('stones', graveyard.files.map((f) => f.path), layout.stones.map((s) => s.path)) ??
    same('ghosts', graveyard.ghosts.map((g) => g.path), layout.ghosts.map((g) => g.path)) ??
    (wrongFolder ? `stone ${wrongFolder.path} stands in folder "${wrongFolder.folder}", not its own folder` : undefined)
  );
}

/** P10, first part: every number in the layout is a finite number. */
export function nonFinite(layout: Layout): string | undefined {
  const bad = (value: unknown, where: string): string | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? undefined : `${where} is ${value}`;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const problem = bad(value[i], `${where}[${i}]`);
        if (problem) return problem;
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        const problem = bad(inner, `${where}.${key}`);
        if (problem) return problem;
      }
    }
    return undefined;
  };
  return bad(layout, 'layout');
}

/** The sign of every plot overlaps no cell of that plot and no child plot of it (the plaque stands in the empty front band). */
export function signOverlap(layout: Layout): string | undefined {
  const items = new Map<string, Item[]>();
  const add = (folder: string, item: Item): void => void items.set(folder, [...(items.get(folder) ?? []), item]);
  for (const s of layout.stones) add(s.folder, { id: `stone ${s.path}`, rect: s.cell });
  for (const g of layout.ghosts) add(g.folder, { id: `ghost ${g.path}`, rect: g.cell });
  for (const p of layout.plots) if (p.parent !== null) add(p.parent, { id: `child plot "${p.path}"`, rect: p.rect });
  for (const plot of layout.plots) {
    const sign = { id: `sign of "${plot.path}"`, rect: plot.sign.footprint };
    const pair = firstOverlap([sign, ...(items.get(plot.path) ?? [])]);
    if (pair) return describePair('sign', pair);
  }
  return undefined;
}

/** All the checks above, in one: the first problem found, or undefined. */
export function firstLayoutProblem(graveyard: Graveyard, layout: Layout): string | undefined {
  return (
    coverage(graveyard, layout) ??
    nonFinite(layout) ??
    cellOverlap(layout) ??
    plotOverlap(layout) ??
    cellsVersusChildPlots(layout) ??
    containment(layout) ??
    signOverlap(layout)
  );
}
