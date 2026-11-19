import type { Graveyard } from '@shared/graveyard-schema';
import { FENCE_BAND, ITEM_GAP } from '../src/model/layout-constants';
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

/** P4: every folder in exactly one plot, one stone per file, one ghost per ghost, and nothing more. */
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
    // A plot stands for one folder, or for several that are shown together: every folder is in exactly one plot.
    same('folders in plots', graveyard.folders.map((f) => f.path), layout.plots.flatMap((p) => p.folders)) ??
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

/**
 * The rules for showing folders together, worked out here from the data file alone and compared with the layout: a folder
 * with no files, no ghosts and exactly one subfolder is shown with that subfolder, and nothing else is merged. The root is
 * never merged. Chains are as long as they can be, each plot is named for its last folder, and its label joins the names.
 */
export function mergeProblems(graveyard: Graveyard, layout: Layout): string | undefined {
  const folderSet = new Set(graveyard.folders.map((f) => f.path));
  const parentOf = new Map(graveyard.folders.map((f) => [f.path, f.parent] as const));
  const childCount = new Map<string, number>();
  for (const f of graveyard.folders) if (f.parent !== null) childCount.set(f.parent, (childCount.get(f.parent) ?? 0) + 1);

  const fileCount = new Map<string, number>();
  for (const file of graveyard.files) fileCount.set(file.folder, (fileCount.get(file.folder) ?? 0) + 1);

  /** The nearest folder that still exists, walking up the path one directory at a time. */
  const owner = (path: string): string => {
    const segments = path.split('/');
    for (let n = segments.length - 1; n >= 1; n--) {
      const candidate = segments.slice(0, n).join('/');
      if (folderSet.has(candidate)) return candidate;
    }
    return '';
  };
  const ghostCount = new Map<string, number>();
  for (const ghost of graveyard.ghosts) ghostCount.set(owner(ghost.path), (ghostCount.get(owner(ghost.path)) ?? 0) + 1);

  const mergeable = (path: string): boolean =>
    path !== '' && (fileCount.get(path) ?? 0) === 0 && (ghostCount.get(path) ?? 0) === 0 && (childCount.get(path) ?? 0) === 1;

  const depthOf = (path: string): number => {
    let depth = 0;
    for (let p = parentOf.get(path) ?? null; p !== null; p = parentOf.get(p) ?? null) depth++;
    return depth;
  };

  const mergedAway = graveyard.folders.filter((f) => mergeable(f.path)).length;
  if (layout.plots.length !== graveyard.folders.length - mergedAway) {
    return `expected ${graveyard.folders.length - mergedAway} plots (${graveyard.folders.length} folders, ${mergedAway} shown with the folder inside), got ${layout.plots.length}`;
  }

  for (const plot of layout.plots) {
    const chain = plot.folders;
    if (chain.length === 0) return `plot "${plot.path}" stands for no folder`;
    if (chain[chain.length - 1] !== plot.path) return `plot "${plot.path}" is not named for its last folder`;
    if (plot.path === '' && (chain.length !== 1 || plot.label !== '')) return 'the root was merged or labelled';

    for (let i = 0; i < chain.length - 1; i++) {
      const folder = chain[i]!;
      if (!mergeable(folder)) return `plot "${plot.path}" has "${folder}", which holds something or has other folders, shown together with the folder inside it`;
      if (parentOf.get(chain[i + 1]!) !== folder) return `plot "${plot.path}": "${chain[i + 1]}" is not inside "${folder}"`;
    }
    if (mergeable(plot.path)) return `plot "${plot.path}" ends with a folder that should have been shown with the one inside it`;

    const head = chain[0]!;
    const above = parentOf.get(head) ?? null;
    if (above !== plot.parent) return `plot "${plot.path}" has parent ${JSON.stringify(plot.parent)}, expected ${JSON.stringify(above)}`;
    if (above !== null && mergeable(above)) return `plot "${plot.path}" could have been shown together with "${above}" above it`;

    const label = plot.path === '' ? '' : chain.map((f) => f.slice(f.lastIndexOf('/') + 1)).join('/');
    if (plot.label !== label) return `plot "${plot.path}" is labelled "${plot.label}", expected "${label}"`;
    if (plot.depth !== depthOf(plot.path)) return `plot "${plot.path}" has depth ${plot.depth}, expected ${depthOf(plot.path)}`;
  }

  for (const ghost of layout.ghosts) {
    if (ghost.folder !== owner(ghost.path)) return `ghost ${ghost.path} sits in "${ghost.folder}", expected "${owner(ghost.path)}"`;
    if (!layout.plots.some((p) => p.path === ghost.folder)) return `the folder of ghost ${ghost.path} was shown together with another`;
  }
  return undefined;
}

/**
 * How much of its content area a plot wastes: the area of what a plot holds, with ITEM_GAP added on two sides of
 * each item and of the whole, may be at most this many times the added-up area of the items. 1 would be a perfect fit.
 * Measured: the gaps themselves are counted as part of every item, so a small item next to a small item is not "waste".
 */
export const AREA_BOUND = 2;

/** Checks AREA_BOUND for every plot that holds anything. */
export function areaProblems(layout: Layout): string | undefined {
  const itemsOf = new Map<string, Rect[]>();
  const add = (folder: string, rect: Rect): void => void itemsOf.set(folder, [...(itemsOf.get(folder) ?? []), rect]);
  for (const block of layout.blocks) add(block.folder, block.rect);
  for (const plot of layout.plots) if (plot.parent !== null) add(plot.parent, plot.rect);

  for (const plot of layout.plots) {
    const items = itemsOf.get(plot.path);
    if (items === undefined || items.length === 0) continue;
    const content = contentArea(plot);
    const held = items.reduce((sum, r) => sum + (r.w + ITEM_GAP) * (r.d + ITEM_GAP), 0);
    const whole = (content.w + ITEM_GAP) * (content.d + ITEM_GAP);
    if (whole > AREA_BOUND * held + 1e-6) {
      return `plot "${plot.path}" holds ${items.length} items of ${held.toFixed(1)} but uses ${whole.toFixed(1)} (more than ${AREA_BOUND} times)`;
    }
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
    signOverlap(layout) ??
    mergeProblems(graveyard, layout) ??
    areaProblems(layout)
  );
}
