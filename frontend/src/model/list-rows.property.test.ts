import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rowsArb } from '../../test/row-arbitraries';
import { loadRealGraveyard } from '../../test/real-data';
import { FLAGS, KINDS, SORT_KEYS, buildRows, filterRows, highlightedIndex, kindOf, sortRows, type Flag, type Kind, type Row } from './list-rows';
import { makeSyntheticGraveyard } from './synthetic';

const kindsArb = fc.subarray([...KINDS]).map((k) => new Set<Kind>(k));
const flagsArb = fc.subarray([...FLAGS]).map((f) => new Set<Flag>(f));
const paths = (rows: readonly Row[]) => rows.map((r) => `${r.kind}:${r.path}`);

describe('P1: filters', () => {
  it('give exactly the rows of a selected kind (any when none) that have every selected flag, in their order; no filters give every row', () => {
    fc.assert(
      fc.property(rowsArb(), kindsArb, flagsArb, (rows, kinds, flags) => {
        const out = filterRows(rows, kinds, flags);
        const expected = rows.filter((r) => {
          const kindOk = kinds.size === 0 || [...kinds].some((k) => (k === 'ghost' ? r.kind === 'ghost' : r.kind === 'file' && r.state === k));
          const flagsOk = (!flags.has('unused') || (r.kind === 'file' && r.unused)) && (!flags.has('hot') || (r.kind === 'file' && r.hot));
          return kindOk && flagsOk;
        });
        return JSON.stringify(paths(out)) === JSON.stringify(paths(expected)) && filterRows(rows, new Set(), new Set()).length === rows.length;
      }),
    );
  });

  it('on oikos: 12 unused, 7 hot, no ghosts', () => {
    const rows = buildRows(loadRealGraveyard('demo.oikosledger'));
    expect(rows).toHaveLength(129);
    expect(filterRows(rows, new Set(), new Set(['unused']))).toHaveLength(12);
    expect(filterRows(rows, new Set(), new Set(['hot']))).toHaveLength(7);
    expect(filterRows(rows, new Set(['ghost']), new Set())).toHaveLength(0);
    expect(filterRows(buildRows(loadRealGraveyard('demo.spatialql')), new Set(['ghost']), new Set())).toHaveLength(2);
  });
});

describe('P2: sorting', () => {
  it('gives the same order for the rows in any order, settles ties by path, and reversing twice gives the first order back', () => {
    fc.assert(
      fc.property(rowsArb(), fc.constantFrom(...SORT_KEYS), fc.boolean(), fc.integer(), (rows, key, reversed, seed) => {
        const shuffled = [...rows].sort((a, b) => ((a.path.length * 31 + seed) % 7) - ((b.path.length * 31 + seed) % 7));
        const a = sortRows(rows, key, reversed);
        const b = sortRows(shuffled, key, reversed);
        const twice = sortRows(sortRows(rows, key, true), key, false);
        const forward = paths(sortRows(rows, key));
        const backward = paths(sortRows(rows, key, true));
        const same = (x: readonly string[], y: readonly string[]) => JSON.stringify(x) === JSON.stringify(y);
        // In any input order the same result; reversing reverses the whole order; reversing twice gives the first order back.
        return same(paths(a), paths(b)) && same(backward, [...forward].reverse()) && same(paths(twice), forward);
      }),
    );
  });

  it('under decay: every stone before every ghost, stones most decayed first, ghosts deleted longest ago first, ties by path', () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const out = sortRows(rows, 'decay');
        const firstGhost = out.findIndex((r) => r.kind === 'ghost');
        if (firstGhost >= 0 && out.slice(firstGhost).some((r) => r.kind === 'file')) return false;
        for (let i = 1; i < out.length; i++) {
          const [p, q] = [out[i - 1]!, out[i]!];
          if (p.kind !== q.kind) continue;
          const key = p.kind === 'file' ? q.decay! - p.decay! : p.deleted! < q.deleted! ? -1 : p.deleted! > q.deleted! ? 1 : 0;
          if (p.kind === 'file' ? key > 0 : key > 0) return false;
          if (key === 0 && p.path > q.path) return false;
        }
        return true;
      }),
    );
    const s = sortRows(buildRows(loadRealGraveyard('demo.spatialql')), 'decay');
    expect(s.slice(-2).map((r) => r.kind)).toEqual(['ghost', 'ghost']);
  });

  it('under size: largest first and ghosts last; under age: oldest first; under name: by file name', () => {
    fc.assert(
      fc.property(rowsArb(), (rows) => {
        const size = sortRows(rows, 'size');
        const ages = sortRows(rows, 'age').map((r) => r.age);
        const names = sortRows(rows, 'name').map((r) => r.name);
        const firstGhost = size.findIndex((r) => r.lines === null);
        const lines = size.filter((r) => r.lines !== null).map((r) => r.lines!);
        return (firstGhost < 0 || size.slice(firstGhost).every((r) => r.lines === null)) && lines.every((n, i) => i === 0 || lines[i - 1]! >= n) && ages.every((n, i) => i === 0 || ages[i - 1]! >= n) && names.every((n, i) => i === 0 || names[i - 1]! <= n);
      }),
    );
  });

  it('sorts and filters 2,000 rows in under 16 ms (the median of 5 runs)', () => {
    const rows = buildRows(makeSyntheticGraveyard({ files: 2000, seed: 1, shape: 'mixed' }));
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      for (const key of SORT_KEYS) sortRows(filterRows(rows, new Set(['stale', 'ancient']), new Set(['unused'])), key);
      sortRows(rows, 'decay');
      times.push((performance.now() - t0) / (SORT_KEYS.length + 1));
    }
    times.sort((a, b) => a - b);
    expect(times[2]!).toBeLessThan(16);
  });
});

describe('P4 (the pure part): the highlighted row', () => {
  it('is the one row of the selection, or -1 when nothing is selected or it is filtered out', () => {
    fc.assert(
      fc.property(rowsArb(), fc.nat(), kindsArb, flagsArb, (rows, i, kinds, flags) => {
        if (rows.length === 0) return highlightedIndex(rows, { kind: 'file', path: 'x' }) === -1;
        const chosen = rows[i % rows.length]!;
        const shown = filterRows(rows, kinds, flags);
        const at = highlightedIndex(shown, { kind: chosen.kind, path: chosen.path });
        const matches = shown.filter((r) => r.kind === chosen.kind && r.path === chosen.path).length;
        return matches <= 1 && (matches === 0 ? at === -1 : shown[at]!.path === chosen.path) && highlightedIndex(shown, null) === -1;
      }),
    );
  });

  it('knows a ghost from a file', () => {
    const rows = buildRows(loadRealGraveyard('demo.spatialql'));
    const ghost = rows.find((r) => r.kind === 'ghost')!;
    expect(kindOf(ghost)).toBe('ghost');
    expect(highlightedIndex(rows, { kind: 'file', path: ghost.path })).toBe(-1);
  });
});
