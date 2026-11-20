import type { DecayState, Graveyard } from '@shared/graveyard-schema';
import type { Selection } from '../store/selection-store';
import { ageDays } from './age';
import { compareCodePoint } from './sort';

/**
 * The list view's rows, and how they are filtered, sorted and matched to the selection (interface spec, Req 5). Pure.
 */

export interface Row {
  kind: 'file' | 'ghost';
  path: string;
  /** The last part of the path. */
  name: string;
  /** Everything before the name, "" for the root. */
  folder: string;
  /** A file's state; null for a ghost. */
  state: DecayState | null;
  unused: boolean;
  hot: boolean;
  /** Lines of code; null for a ghost, which has no size. */
  lines: number | null;
  /** A file's age, or the whole days from a ghost's deletion to the snapshot. */
  age: number;
  /** A file's decay score; null for a ghost. */
  decay: number | null;
  /** A ghost's deletion date (ISO); null for a file. */
  deleted: string | null;
}

const split = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/');
  return { name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) };
};

export function buildRows(g: Graveyard): Row[] {
  const snapshot = g.meta.snapshotDate;
  const files = g.files.map((f): Row => ({
    kind: 'file',
    path: f.path,
    ...split(f.path),
    state: f.decayState,
    unused: f.unused,
    hot: f.hot,
    lines: f.linesOfCode,
    age: ageDays(f.lastCommitDate, snapshot),
    decay: f.decayScore,
    deleted: null,
  }));
  const ghosts = g.ghosts.map((x): Row => ({
    kind: 'ghost',
    path: x.path,
    ...split(x.path),
    state: null,
    unused: false,
    hot: false,
    lines: null,
    age: ageDays(x.deletedDate, snapshot),
    decay: null,
    deleted: x.deletedDate,
  }));
  return [...files, ...ghosts];
}

/** What a row is, for the kind filters. */
export type Kind = DecayState | 'ghost';
export type Flag = 'unused' | 'hot';
export const KINDS: readonly Kind[] = ['fresh', 'stale', 'ancient', 'ghost'];
export const FLAGS: readonly Flag[] = ['unused', 'hot'];

export const kindOf = (row: Row): Kind => (row.kind === 'ghost' ? 'ghost' : row.state!);

/**
 * The rows that are one of the selected kinds (OR; any kind when none is selected) and have every selected flag (AND); the two
 * groups combine with AND. A ghost has neither flag. The order of the rows is kept.
 */
export function filterRows(rows: readonly Row[], kinds: ReadonlySet<Kind>, flags: ReadonlySet<Flag>): Row[] {
  return rows.filter((row) => (kinds.size === 0 || kinds.has(kindOf(row))) && [...flags].every((flag) => row[flag]));
}

export type SortKey = 'decay' | 'age' | 'name' | 'size';
export const SORT_KEYS: readonly SortKey[] = ['decay', 'age', 'name', 'size'];

const byPath = (a: Row, b: Row): number => compareCodePoint(a.path, b.path);

const COMPARE: Record<SortKey, (a: Row, b: Row) => number> = {
  // Stones before ghosts: a clean-up list, and ghosts are already deleted. Stones most decayed first; ghosts deleted longest ago first.
  decay: (a, b) => {
    if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1;
    if (a.kind === 'file') return b.decay! - a.decay! || byPath(a, b);
    return compareCodePoint(a.deleted!, b.deleted!) || byPath(a, b);
  },
  age: (a, b) => b.age - a.age || byPath(a, b),
  name: (a, b) => compareCodePoint(a.name, b.name) || byPath(a, b),
  // Largest first; ghosts, which have no size, last.
  size: (a, b) => {
    if ((a.lines === null) !== (b.lines === null)) return a.lines === null ? 1 : -1;
    return (b.lines ?? 0) - (a.lines ?? 0) || byPath(a, b);
  },
};

/**
 * The rows in the order of `key`, every tie settled by path, so the same rows always give the same order whatever order they came
 * in. `reversed` reverses the whole order (so reversing twice gives the first order back).
 */
export function sortRows(rows: readonly Row[], key: SortKey, reversed = false): Row[] {
  const sorted = [...rows].sort(COMPARE[key]);
  return reversed ? sorted.reverse() : sorted;
}

/** The index of the selected file or ghost among these rows, or -1 when none is selected or it is not among them (filtered out). */
export function highlightedIndex(rows: readonly Row[], selection: Selection): number {
  if (selection === null) return -1;
  return rows.findIndex((row) => row.kind === selection.kind && row.path === selection.path);
}
