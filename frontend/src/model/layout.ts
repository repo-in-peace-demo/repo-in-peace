import type { FileEntry, Ghost, Graveyard } from '@shared/graveyard-schema';
import {
  CELL_D,
  CELL_PITCH_X,
  CELL_PITCH_Z,
  CELL_W,
  FENCE_BAND,
  ITEM_GAP,
  PACK_WIDTH_CANDIDATES,
  SIGN_D,
  SIGN_W,
} from './layout-constants';
import type { Rect } from './rect';
import { compareCodePoint } from './sort';
import { stoneHeight } from './tombstone-height';

/**
 * Where everything stands. A pure function of the data file: no clock, no random source, no renderer.
 *
 * - Every folder is a fenced plot, a rectangle on the ground. A plot holds its own stones and ghosts as a block of
 *   cells in rows, and its child plots. The block and the child plots are packed together as equal items, largest first,
 *   so the plot comes out close to a square with little empty ground (FSN-style nesting).
 * - A folder that holds no files and no ghosts and has exactly one subfolder is not given a plot of its own: it is
 *   shown together with that subfolder as one plot, like the compact folders of a code editor. The root is never
 *   merged, and neither is a folder that holds a ghost.
 * - Plots are sized from the leaves up and positioned from the root down. There is no recursion, so a chain of
 *   hundreds of folders is safe.
 * - Everything is placed in order of path (code-point order), so the order of the arrays in the data file
 *   never shows in the result.
 */

export interface SignSpot {
  /** Centre of the plaque on the ground. */
  x: number;
  z: number;
  /** The ground the plaque occupies. It lies inside the plot's fence band at the middle of the front edge. */
  footprint: Rect;
}

export interface PlotLayout {
  /** The folder that holds the plot's contents: the last of `folders`. This is the plot's identity. */
  path: string;
  /**
   * The real folders this plot stands for, outermost first. One folder, unless a chain of empty single-child folders
   * is shown as one plot: then the folders of the chain, ending with `path`. Every folder of the data file is in
   * exactly one plot.
   */
  folders: string[];
  /**
   * What the sign says: the folder's own name, or the names of the merged folders joined by "/" (for example
   * `accounts/compare`). Empty for the root, whose sign shows the repository name.
   */
  label: string;
  /** The folder that holds the outermost folder of the plot, which is the `path` of the plot around this one. null for the root. */
  parent: string | null;
  /** The nesting depth of `path` among the real folders. 0 for the root. */
  depth: number;
  /** The plot's outer rectangle, which is its fence line. What it holds lies inside this inset by FENCE_BAND. */
  rect: Rect;
  sign: SignSpot;
}

/** The block of stone and ghost cells of one folder. */
export interface BlockLayout {
  folder: string;
  rect: Rect;
  columns: number;
  rows: number;
  /** Number of cells: the folder's stones plus its ghosts. */
  count: number;
}

export interface StoneLayout {
  path: string;
  /** The folder whose plot the stone stands in. */
  folder: string;
  /** The ground the stone reserves, including the reach of a lean. */
  cell: Rect;
  /** Centre of the stone's base. */
  x: number;
  z: number;
  height: number;
}

export interface GhostLayout {
  path: string;
  /** The plot the ghost sits in: its old folder if that still exists, else the nearest ancestor that does. */
  folder: string;
  cell: Rect;
  x: number;
  z: number;
}

export interface Layout {
  /** Sorted by path. */
  plots: PlotLayout[];
  blocks: BlockLayout[];
  /** Sorted by path. */
  stones: StoneLayout[];
  /** Sorted by path. */
  ghosts: GhostLayout[];
  /** The root plot's rectangle, which holds everything. */
  bounds: Rect;
}

/** The directory part of a repo-relative path: everything before the last slash, or "" at the top level. */
export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * The folder whose plot a ghost sits in: its old folder if that is one of `folders`, otherwise the
 * nearest ancestor that is, ending at the root plot `""`.
 */
export function nearestExistingFolder(path: string, folders: ReadonlySet<string>): string {
  let directory = dirnameOf(path);
  for (;;) {
    if (folders.has(directory)) return directory;
    if (directory === '') return '';
    directory = dirnameOf(directory);
  }
}

/** The size and shape of a block of `count` cells: close to a square on the ground. */
export function blockShape(count: number): { columns: number; rows: number; w: number; d: number } {
  if (count <= 0) return { columns: 0, rows: 0, w: 0, d: 0 };
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * CELL_PITCH_Z) / CELL_PITCH_X)));
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    w: (columns - 1) * CELL_PITCH_X + CELL_W,
    d: (rows - 1) * CELL_PITCH_Z + CELL_D,
  };
}

// ---- Packing ----

export interface PackInput {
  /** Names the item and breaks ties, so the result does not depend on the order the items are given in. */
  id: string;
  w: number;
  d: number;
}

export interface PackedItems {
  /** The corner of every item, relative to the corner of the packed area. */
  offsets: Map<string, { x: number; z: number }>;
  /** The size of the packed area: as small as the items allow, with no spare margin. */
  w: number;
  d: number;
}

interface Segment {
  x: number;
  width: number;
  y: number;
}

const SKYLINE_EPS = 1e-9;

/**
 * Packs the items in a strip of the given width, largest first, each at the lowest place it fits, and at the
 * leftmost of those (a skyline: the height of what has been placed, from left to right). Items are made bigger by
 * ITEM_GAP on the right and at the bottom while they are placed, which keeps every item ITEM_GAP from the next.
 */
function packAtWidth(sorted: readonly PackInput[], stripWidth: number): PackedItems & { side: number } {
  const limit = stripWidth + ITEM_GAP;
  let skyline: Segment[] = [{ x: 0, width: limit, y: 0 }];
  const offsets = new Map<string, { x: number; z: number }>();
  let width = 0;
  let depth = 0;

  for (const item of sorted) {
    const needW = item.w + ITEM_GAP;
    const needD = item.d + ITEM_GAP;

    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let i = 0; i < skyline.length; i++) {
      const left = skyline[i]!;
      if (left.x + needW > limit + SKYLINE_EPS) break; // the segments are in order, so none further right fits either
      // The item rests on the tallest part of the skyline that lies under it.
      let y = left.y;
      let covered = left.width;
      for (let j = i + 1; covered < needW - SKYLINE_EPS && j < skyline.length; j++) {
        y = Math.max(y, skyline[j]!.y);
        covered += skyline[j]!.width;
      }
      if (y < bestY - SKYLINE_EPS) {
        bestY = y;
        bestX = left.x;
      }
    }

    offsets.set(item.id, { x: bestX, z: bestY });
    width = Math.max(width, bestX + item.w);
    depth = Math.max(depth, bestY + item.d);
    skyline = raiseSkyline(skyline, bestX, needW, bestY + needD);
  }

  return { offsets, w: width, d: depth, side: Math.max(width, depth) };
}

/** The skyline after something of width `w` is placed at `x`, reaching up to `top`. */
function raiseSkyline(skyline: readonly Segment[], x: number, w: number, top: number): Segment[] {
  const end = x + w;
  const next: Segment[] = [];
  for (const seg of skyline) {
    const segEnd = seg.x + seg.width;
    if (segEnd <= x + SKYLINE_EPS || seg.x >= end - SKYLINE_EPS) {
      next.push(seg); // not under the new item
      continue;
    }
    if (seg.x < x - SKYLINE_EPS) next.push({ x: seg.x, width: x - seg.x, y: seg.y }); // what sticks out to the left
    if (segEnd > end + SKYLINE_EPS) next.push({ x: end, width: segEnd - end, y: seg.y }); // what sticks out to the right
  }
  next.push({ x, width: w, y: top });
  next.sort((a, b) => a.x - b.x);

  // Neighbours at the same height are one segment.
  const merged: Segment[] = [];
  for (const seg of next) {
    const last = merged[merged.length - 1];
    if (last !== undefined && Math.abs(last.y - seg.y) <= SKYLINE_EPS) last.width += seg.width;
    else merged.push({ ...seg });
  }
  return merged;
}

/**
 * Packs rectangles close together with little empty ground, and into a shape close to a square.
 *
 * The items are sorted largest first (by area, then by the longer side, then by id, so the order they are given in does
 * not matter). They are packed into a strip with a skyline, for each of PACK_WIDTH_CANDIDATES strip widths between the widest
 * item and the widest item plus twice the side of a square of the items' total area; the packing whose longer side is
 * shortest wins, then the one with less area, then the narrower strip. Items are ITEM_GAP apart, and the packed area has
 * no margin around them.
 */
export function packItems(items: readonly PackInput[]): PackedItems {
  if (items.length === 0) return { offsets: new Map(), w: 0, d: 0 };

  const sorted = [...items].sort(
    (a, b) => b.w * b.d - a.w * a.d || Math.max(b.w, b.d) - Math.max(a.w, a.d) || compareCodePoint(a.id, b.id),
  );
  if (sorted.length === 1) {
    const only = sorted[0]!;
    return { offsets: new Map([[only.id, { x: 0, z: 0 }]]), w: only.w, d: only.d };
  }

  let widest = 0;
  let area = 0;
  for (const item of sorted) {
    widest = Math.max(widest, item.w);
    area += item.w * item.d;
  }
  const highest = widest + 2 * Math.sqrt(area);

  let best: (PackedItems & { side: number }) | undefined;
  for (let k = 0; k < PACK_WIDTH_CANDIDATES; k++) {
    const stripWidth = widest + ((highest - widest) * k) / (PACK_WIDTH_CANDIDATES - 1);
    const attempt = packAtWidth(sorted, stripWidth);
    if (
      best === undefined ||
      attempt.side < best.side - SKYLINE_EPS ||
      (Math.abs(attempt.side - best.side) <= SKYLINE_EPS && attempt.w * attempt.d < best.w * best.d - SKYLINE_EPS)
    ) {
      best = attempt;
    }
  }
  const { offsets, w, d } = best!;
  return { offsets, w, d };
}

// ---- The layout ----

function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

const byPath = (a: { path: string }, b: { path: string }): number => compareCodePoint(a.path, b.path);

/** One thing a folder holds in its block: a stone or a ghost. */
type Occupant = { kind: 'stone'; file: FileEntry } | { kind: 'ghost'; ghost: Ghost };

const BLOCK_ID = 'block';
const childId = (path: string): string => `child:${path}`;

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function layout(graveyard: Graveyard): Layout {
  // ---- The folder tree ----
  const folderPaths = new Set(graveyard.folders.map((f) => f.path));
  const parentOf = new Map(graveyard.folders.map((f) => [f.path, f.parent] as const));

  const childrenOf = new Map<string, string[]>();
  for (const folder of graveyard.folders) childrenOf.set(folder.path, []);
  for (const folder of graveyard.folders) {
    if (folder.parent !== null) childrenOf.get(folder.parent)?.push(folder.path);
  }
  for (const list of childrenOf.values()) list.sort(compareCodePoint);

  // Breadth first from the root: a parent always comes before its children, and depth never decreases.
  const depthOf = new Map<string, number>();
  const folderOrder: string[] = [];
  if (folderPaths.has('')) {
    depthOf.set('', 0);
    folderOrder.push('');
  }
  for (let i = 0; i < folderOrder.length; i++) {
    const path = folderOrder[i]!;
    for (const child of childrenOf.get(path) ?? []) {
      depthOf.set(child, depthOf.get(path)! + 1);
      folderOrder.push(child);
    }
  }

  // ---- What each folder holds ----
  const stoneFiles = new Map<string, FileEntry[]>();
  const ghostsHere = new Map<string, Ghost[]>();
  for (const file of graveyard.files) addTo(stoneFiles, file.folder, file);
  for (const ghost of graveyard.ghosts) addTo(ghostsHere, nearestExistingFolder(ghost.path, folderPaths), ghost);

  const occupantsOf = new Map<string, Occupant[]>();
  for (const path of folderOrder) {
    const files = (stoneFiles.get(path) ?? []).sort(byPath);
    const ghosts = (ghostsHere.get(path) ?? []).sort(byPath);
    // Stones first, then ghosts, each in order of path.
    occupantsOf.set(path, [
      ...files.map((file): Occupant => ({ kind: 'stone', file })),
      ...ghosts.map((ghost): Occupant => ({ kind: 'ghost', ghost })),
    ]);
  }

  // ---- Which folders share a plot ----
  // A folder with nothing in it but one subfolder is shown together with that subfolder. Not the root, and not a folder
  // that holds a ghost. A chain of such folders is one plot, which stands for all of them and is named for the last.
  const isMerged = (path: string): boolean =>
    path !== '' && occupantsOf.get(path)!.length === 0 && childrenOf.get(path)!.length === 1;

  const plotPaths = folderOrder.filter((path) => !isMerged(path)); // the last folder of each plot
  const foldersOfPlot = new Map<string, string[]>();
  for (const tail of plotPaths) {
    const folders = [tail];
    for (let up = parentOf.get(tail) ?? null; up !== null && isMerged(up); up = parentOf.get(up) ?? null) folders.unshift(up);
    foldersOfPlot.set(tail, folders);
  }

  // The plot around a plot is the one of the folder that holds its outermost folder.
  const plotParentOf = new Map<string, string | null>();
  const childPlotsOf = new Map<string, string[]>();
  for (const tail of plotPaths) {
    const head = foldersOfPlot.get(tail)![0]!;
    const parent = parentOf.get(head) ?? null;
    plotParentOf.set(tail, parent);
    if (parent !== null) addTo(childPlotsOf, parent, tail);
  }
  for (const list of childPlotsOf.values()) list.sort(compareCodePoint);

  // Breadth first over the plots, from the root.
  const plotOrder: string[] = plotPaths.includes('') ? [''] : [];
  for (let i = 0; i < plotOrder.length; i++) {
    for (const child of childPlotsOf.get(plotOrder[i]!) ?? []) plotOrder.push(child);
  }

  // ---- Sizes, from the leaves up ----
  const size = new Map<string, { w: number; d: number }>();
  const packedOf = new Map<string, PackedItems>();
  for (let i = plotOrder.length - 1; i >= 0; i--) {
    const path = plotOrder[i]!;
    const shape = blockShape(occupantsOf.get(path)!.length);

    // The block of cells is one more item, packed with the child plots.
    const items: PackInput[] = [];
    if (shape.columns > 0) items.push({ id: BLOCK_ID, w: shape.w, d: shape.d });
    for (const child of childPlotsOf.get(path) ?? []) {
      const childSize = size.get(child)!;
      items.push({ id: childId(child), w: childSize.w, d: childSize.d });
    }

    const packed = packItems(items);
    packedOf.set(path, packed);
    size.set(path, { w: packed.w + 2 * FENCE_BAND, d: packed.d + 2 * FENCE_BAND });
  }

  // ---- Positions, from the root down ----
  const plots: PlotLayout[] = [];
  const blocks: BlockLayout[] = [];
  const stones: StoneLayout[] = [];
  const ghosts: GhostLayout[] = [];
  const rectOf = new Map<string, Rect>();
  if (plotOrder.length > 0) {
    const rootSize = size.get('')!;
    rectOf.set('', { x: 0, z: 0, w: rootSize.w, d: rootSize.d });
  }

  for (const path of plotOrder) {
    const rect = rectOf.get(path)!;
    const originX = rect.x + FENCE_BAND;
    const originZ = rect.z + FENCE_BAND;
    const packed = packedOf.get(path)!;

    for (const child of childPlotsOf.get(path) ?? []) {
      const offset = packed.offsets.get(childId(child))!;
      const childSize = size.get(child)!;
      rectOf.set(child, { x: originX + offset.x, z: originZ + offset.z, w: childSize.w, d: childSize.d });
    }

    const occupants = occupantsOf.get(path)!;
    const blockOffset = packed.offsets.get(BLOCK_ID);
    if (blockOffset !== undefined) {
      const shape = blockShape(occupants.length);
      const blockRect: Rect = { x: originX + blockOffset.x, z: originZ + blockOffset.z, w: shape.w, d: shape.d };
      blocks.push({ folder: path, rect: blockRect, columns: shape.columns, rows: shape.rows, count: occupants.length });

      occupants.forEach((occupant, k) => {
        const cell: Rect = {
          x: blockRect.x + (k % shape.columns) * CELL_PITCH_X,
          z: blockRect.z + Math.floor(k / shape.columns) * CELL_PITCH_Z,
          w: CELL_W,
          d: CELL_D,
        };
        const x = cell.x + cell.w / 2;
        const z = cell.z + cell.d / 2;
        if (occupant.kind === 'stone') {
          stones.push({ path: occupant.file.path, folder: path, cell, x, z, height: stoneHeight(occupant.file.linesOfCode) });
        } else {
          ghosts.push({ path: occupant.ghost.path, folder: path, cell, x, z });
        }
      });
    }

    // The plaque stands in the middle of the front edge, inside the fence band, where nothing else lies.
    const footprint: Rect = { x: rect.x + rect.w / 2 - SIGN_W / 2, z: rect.z + rect.d - SIGN_D, w: SIGN_W, d: SIGN_D };
    const folders = foldersOfPlot.get(path)!;
    plots.push({
      path,
      folders,
      label: path === '' ? '' : folders.map(lastName).join('/'),
      parent: plotParentOf.get(path) ?? null,
      depth: depthOf.get(path)!,
      rect,
      sign: { x: footprint.x + footprint.w / 2, z: footprint.z + footprint.d / 2, footprint },
    });
  }

  plots.sort(byPath);
  blocks.sort((a, b) => compareCodePoint(a.folder, b.folder));
  stones.sort(byPath);
  ghosts.sort(byPath);

  const bounds = rectOf.get('') ?? { x: 0, z: 0, w: 0, d: 0 };
  return { plots, blocks, stones, ghosts, bounds };
}
