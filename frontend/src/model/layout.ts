import type { FileEntry, Ghost, Graveyard } from '@shared/graveyard-schema';
import {
  CELL_D,
  CELL_PITCH_X,
  CELL_PITCH_Z,
  CELL_W,
  FENCE_BAND,
  ITEM_GAP,
  PACK_ASPECT,
  SIGN_D,
  SIGN_W,
} from './layout-constants';
import type { Rect } from './rect';
import { compareCodePoint } from './sort';
import { stoneHeight } from './tombstone-height';

/**
 * Where everything stands. A pure function of the data file: no clock, no random source, no renderer.
 *
 * - Every folder is a fenced plot, a rectangle on the ground. A plot holds its own stones and ghosts as a
 *   block of cells in rows, and its child plots, packed in rows beside the block (FSN-style nesting).
 * - Plots are sized from the leaves up and positioned from the root down. There is no recursion, so a chain
 *   of hundreds of folders is safe.
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
  path: string;
  parent: string | null;
  /** 0 for the root plot. */
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

export interface PackedRows {
  /** Where each item's corner goes, relative to the top left of the packed area, in the order given. */
  offsets: Array<{ x: number; z: number }>;
  /** The size of the packed area. */
  w: number;
  d: number;
}

/**
 * Packs items left to right in rows (shelf packing). The row width target is the widest item, or 1.25 times
 * the side of a square of the same total area, whichever is bigger. A new row starts when the next item would
 * pass the target. Items in a row, and the rows, are ITEM_GAP apart. Items keep their order.
 */
export function packRows(items: ReadonlyArray<{ w: number; d: number }>): PackedRows {
  if (items.length === 0) return { offsets: [], w: 0, d: 0 };

  let area = 0;
  let widest = 0;
  for (const item of items) {
    area += item.w * item.d;
    widest = Math.max(widest, item.w);
  }
  const target = Math.max(widest, Math.ceil(PACK_ASPECT * Math.sqrt(area)));

  const offsets: Array<{ x: number; z: number }> = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let width = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > target) {
      z += rowDepth + ITEM_GAP;
      x = 0;
      rowDepth = 0;
    }
    offsets.push({ x, z });
    width = Math.max(width, x + item.w);
    rowDepth = Math.max(rowDepth, item.d);
    x += item.w + ITEM_GAP;
  }
  return { offsets, w: width, d: z + rowDepth };
}

function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

const byPath = (a: { path: string }, b: { path: string }): number => compareCodePoint(a.path, b.path);

/** One thing a folder holds in its block: a stone or a ghost. */
type Occupant = { kind: 'stone'; file: FileEntry } | { kind: 'ghost'; ghost: Ghost };

/** What goes into a plot's packed area: its block of cells, or one child plot. */
type PackItem = { kind: 'block'; w: number; d: number } | { kind: 'child'; path: string; w: number; d: number };

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
  const order: string[] = [];
  if (folderPaths.has('')) {
    depthOf.set('', 0);
    order.push('');
  }
  for (let i = 0; i < order.length; i++) {
    const path = order[i]!;
    for (const child of childrenOf.get(path) ?? []) {
      depthOf.set(child, depthOf.get(path)! + 1);
      order.push(child);
    }
  }

  // ---- What each folder holds ----
  const occupantsOf = new Map<string, Occupant[]>();
  const stoneFiles = new Map<string, FileEntry[]>();
  const ghostsHere = new Map<string, Ghost[]>();
  for (const file of graveyard.files) addTo(stoneFiles, file.folder, file);
  for (const ghost of graveyard.ghosts) addTo(ghostsHere, nearestExistingFolder(ghost.path, folderPaths), ghost);
  for (const path of order) {
    const files = (stoneFiles.get(path) ?? []).sort(byPath);
    const ghosts = (ghostsHere.get(path) ?? []).sort(byPath);
    // Stones first, then ghosts, each in order of path.
    occupantsOf.set(path, [
      ...files.map((file): Occupant => ({ kind: 'stone', file })),
      ...ghosts.map((ghost): Occupant => ({ kind: 'ghost', ghost })),
    ]);
  }

  // ---- Sizes, from the leaves up ----
  const size = new Map<string, { w: number; d: number }>();
  const packedOf = new Map<string, { packed: PackedRows; items: PackItem[] }>();
  for (let i = order.length - 1; i >= 0; i--) {
    const path = order[i]!;
    const shape = blockShape(occupantsOf.get(path)!.length);

    const items: PackItem[] = [];
    if (shape.columns > 0) items.push({ kind: 'block', w: shape.w, d: shape.d });
    for (const child of childrenOf.get(path) ?? []) {
      const childSize = size.get(child)!;
      items.push({ kind: 'child', path: child, w: childSize.w, d: childSize.d });
    }

    const packed = packRows(items);
    packedOf.set(path, { packed, items });
    size.set(path, { w: packed.w + 2 * FENCE_BAND, d: packed.d + 2 * FENCE_BAND });
  }

  // ---- Positions, from the root down ----
  const plots: PlotLayout[] = [];
  const blocks: BlockLayout[] = [];
  const stones: StoneLayout[] = [];
  const ghosts: GhostLayout[] = [];
  const rectOf = new Map<string, Rect>();
  if (order.length > 0) {
    const rootSize = size.get('')!;
    rectOf.set('', { x: 0, z: 0, w: rootSize.w, d: rootSize.d });
  }

  for (const path of order) {
    const rect = rectOf.get(path)!;
    const originX = rect.x + FENCE_BAND;
    const originZ = rect.z + FENCE_BAND;
    const { packed, items } = packedOf.get(path)!;

    items.forEach((item, index) => {
      const offset = packed.offsets[index]!;
      if (item.kind === 'child') {
        rectOf.set(item.path, { x: originX + offset.x, z: originZ + offset.z, w: item.w, d: item.d });
        return;
      }

      // The block of cells: stones first, then ghosts.
      const occupants = occupantsOf.get(path)!;
      const shape = blockShape(occupants.length);
      const blockRect: Rect = { x: originX + offset.x, z: originZ + offset.z, w: item.w, d: item.d };
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
          stones.push({
            path: occupant.file.path,
            folder: path,
            cell,
            x,
            z,
            height: stoneHeight(occupant.file.linesOfCode),
          });
        } else {
          ghosts.push({ path: occupant.ghost.path, folder: path, cell, x, z });
        }
      });
    });

    // The plaque stands in the middle of the front edge, inside the fence band, where nothing else lies.
    const footprint: Rect = { x: rect.x + rect.w / 2 - SIGN_W / 2, z: rect.z + rect.d - SIGN_D, w: SIGN_W, d: SIGN_D };
    plots.push({
      path,
      parent: parentOf.get(path) ?? null,
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
