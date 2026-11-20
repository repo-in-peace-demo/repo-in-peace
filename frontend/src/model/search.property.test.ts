import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rowsArb } from '../../test/row-arbitraries';
import { loadRealGraveyard } from '../../test/real-data';
import { buildRows, type Row } from './list-rows';
import { rankRow, searchRows } from './search';

const fileRow = (path: string): Row => {
  const cut = path.lastIndexOf('/');
  return { kind: 'file', path, name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut), state: 'fresh', unused: false, hot: false, lines: 1, age: 1, decay: 0, deleted: null };
};

describe('P3: search ranking', () => {
  it('ranks an exact name above a name prefix, above a name that contains it, above a path-only match', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,6}$/), fc.stringMatching(/^[a-z]{1,4}$/), (q, more) => {
        const exact = fileRow(`a/${q}`);
        const prefix = fileRow(`b/${q}${more}`);
        const contains = fileRow(`c/0${q}${more}`); // a digit first, so it can never start with the (letters-only) query
        const pathOnly = fileRow(`d/${q}/000`); // a name of digits, which can never contain it
        const out = searchRows([pathOnly, contains, prefix, exact], q.toUpperCase()).map((r) => r.path);
        return JSON.stringify(out) === JSON.stringify([exact.path, prefix.path, contains.path, pathOnly.path]);
      }),
    );
  });

  it('for any rows and query: only matching rows, ordered by rank then path, case-insensitive', () => {
    fc.assert(
      fc.property(rowsArb(), fc.stringMatching(/^[a-zA-Z0-9_.-]{0,4}$/), (rows, q) => {
        const out = searchRows(rows, q, 1000);
        const lower = q.trim().toLowerCase();
        if (lower === '') return out.length === 0;
        const matching = rows.filter((r) => r.path.toLowerCase().includes(lower));
        if (out.length !== matching.length) return false;
        for (let i = 1; i < out.length; i++) {
          const [a, b] = [rankRow(out[i - 1]!, q)!, rankRow(out[i]!, q)!];
          if (a > b || (a === b && out[i - 1]!.path > out[i]!.path)) return false;
        }
        return out.every((r) => rankRow(r, q) !== null);
      }),
    );
  });

  it('on oikos: index.ts puts the files named index.ts first, and voice puts names starting with voice before paths that contain it', () => {
    const rows = buildRows(loadRealGraveyard('demo.oikosledger'));
    const index = searchRows(rows, 'index.ts');
    const exact = index.filter((r) => r.name === 'index.ts');
    expect(exact.length).toBeGreaterThan(1);
    expect(index.slice(0, exact.length).every((r) => r.name === 'index.ts')).toBe(true);
    const voice = searchRows(rows, 'voice');
    const named = voice.reduce((last, r, i) => (r.name.toLowerCase().startsWith('voice') ? i : last), -1);
    const pathOnly = voice.findIndex((r) => !r.name.toLowerCase().includes('voice'));
    expect(pathOnly).toBeGreaterThan(named);
    expect(searchRows(rows, '   ')).toEqual([]);
  });
});
