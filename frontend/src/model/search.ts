import type { Row } from './list-rows';
import { compareCodePoint } from './sort';

/**
 * The search box's matching and ranking (interface spec, Req 6). Pure. Case does not matter.
 *   0  the file name is the query           index.ts
 *   1  the file name starts with the query  index
 *   2  the file name contains the query     dex
 *   3  only the path contains the query     components/
 */
export type Rank = 0 | 1 | 2 | 3;

const normal = (text: string): string => text.toLowerCase();

export function rankRow(row: Row, query: string): Rank | null {
  const q = normal(query.trim());
  if (q.length === 0) return null;
  const name = normal(row.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (normal(row.path).includes(q)) return 3;
  return null;
}

/** The matching rows, best rank first, then by path; at most `limit`. An empty or blank query matches nothing. */
export function searchRows(rows: readonly Row[], query: string, limit = 50): Row[] {
  const ranked: Array<{ row: Row; rank: Rank }> = [];
  for (const row of rows) {
    const rank = rankRow(row, query);
    if (rank !== null) ranked.push({ row, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || compareCodePoint(a.row.path, b.row.path) || (a.row.kind === b.row.kind ? 0 : a.row.kind === 'file' ? -1 : 1));
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.row);
}
