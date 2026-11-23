import type { ImportRef } from './imports';
import { compareCodePoint } from './sort';

/**
 * The import graph (importers spec, Req 2, 4.1): resolved imports between analysed files, and its reverse, who imports each file.
 * Pure: the resolver comes in as a function.
 */
export interface Edge {
  from: string;
  to: string;
  typeOnly: boolean;
}
export type Ignored = 'package' | 'outside' | 'missing';
export type Resolution = { to: string } | { ignored: Ignored };
export type ImporterEntry = { path: string; typeOnly?: true };

export function buildEdges(
  imports: ReadonlyMap<string, readonly ImportRef[]>,
  resolve: (from: string, specifier: string) => Resolution,
): { edges: Edge[]; ignored: Record<Ignored, number> } {
  const ignored: Record<Ignored, number> = { package: 0, outside: 0, missing: 0 };
  // One edge per (from, to): type-only only when every import between them is.
  const pairs = new Map<string, Edge>();
  for (const from of [...imports.keys()].sort(compareCodePoint)) {
    for (const ref of imports.get(from)!) {
      const r = resolve(from, ref.specifier);
      if ('ignored' in r) {
        ignored[r.ignored]++;
        continue;
      }
      if (r.to === from) continue; // a file importing itself says nothing about who uses it
      const key = `${from}\u0000${r.to}`;
      const seen = pairs.get(key);
      if (seen) seen.typeOnly = seen.typeOnly && ref.typeOnly;
      else pairs.set(key, { from, to: r.to, typeOnly: ref.typeOnly });
    }
  }
  const edges = [...pairs.values()].sort((a, b) => compareCodePoint(a.from, b.from) || compareCodePoint(a.to, b.to));
  return { edges, ignored };
}

/** Every file's importers, sorted by path; an empty list for a file nothing imports. Edges to files not in `files` are dropped. */
export function importedByOf(edges: readonly Edge[], files: readonly string[]): Map<string, ImporterEntry[]> {
  const out = new Map<string, ImporterEntry[]>([...files].sort(compareCodePoint).map((f) => [f, []]));
  for (const e of edges) {
    const list = out.get(e.to);
    if (!list || !out.has(e.from)) continue;
    list.push(e.typeOnly ? { path: e.from, typeOnly: true } : { path: e.from });
  }
  for (const list of out.values()) list.sort((a, b) => compareCodePoint(a.path, b.path));
  return out;
}
