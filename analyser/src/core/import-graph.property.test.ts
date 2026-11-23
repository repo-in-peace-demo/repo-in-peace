import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildEdges, importedByOf, type Resolution } from './import-graph';
import type { ImportRef } from './imports';

/** Random graphs: files, and from each a list of imports to other files (by path as the specifier), packages or nothing. */
const graphArb = fc
  .uniqueArray(fc.stringMatching(/^[a-c]\/[a-z]{1,4}\.ts$/), { minLength: 1, maxLength: 25 })
  .chain((files) =>
    fc
      .array(
        fc.record({
          from: fc.constantFrom(...files),
          to: fc.oneof(fc.constantFrom(...files), fc.constant('pkg:react'), fc.constant('missing:x')),
          typeOnly: fc.boolean(),
        }),
        { maxLength: 80 },
      )
      .map((list) => ({ files, list })),
  );

const resolve = (files: readonly string[]) => (_from: string, specifier: string): Resolution =>
  files.includes(specifier) ? { to: specifier } : specifier.startsWith('pkg:') ? { ignored: 'package' } : { ignored: 'missing' };

const importsOf = (files: readonly string[], list: ReadonlyArray<{ from: string; to: string; typeOnly: boolean }>) => {
  const m = new Map<string, ImportRef[]>(files.map((f) => [f, []]));
  for (const i of list) m.get(i.from)!.push({ specifier: i.to, typeOnly: i.typeOnly, kind: 'static' });
  return m;
};

describe('P1: importedBy is the exact reverse of the imports', () => {
  it('lists every importer once, sorted, only analysed files, type-only exactly when every import of the pair is', () => {
    fc.assert(
      fc.property(graphArb, ({ files, list }) => {
        const { edges, ignored } = buildEdges(importsOf(files, list), resolve(files));
        const by = importedByOf(edges, files);
        expect([...by.keys()].sort()).toEqual([...files].sort());
        for (const file of files) {
          // The model: every pair (from, file), from != file, from the list.
          const pairs = list.filter((i) => i.to === file && i.from !== file);
          const expected = [...new Set(pairs.map((p) => p.from))].sort().map((from) => {
            const typeOnly = pairs.filter((p) => p.from === from).every((p) => p.typeOnly);
            return typeOnly ? { path: from, typeOnly: true } : { path: from };
          });
          expect(by.get(file)).toEqual(expected);
          for (const e of by.get(file)!) expect(files).toContain(e.path);
        }
        expect(ignored.package).toBe(list.filter((i) => i.to.startsWith('pkg:')).length);
        expect(ignored.missing).toBe(list.filter((i) => i.to.startsWith('missing:')).length);
      }),
      { numRuns: 300 },
    );
  });
});

describe('P4 (pure): the same graph whatever order it is read in', () => {
  it('shuffled files and imports give the same edges and the same map', () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), ({ files, list }, seed) => {
        const shuffle = <T,>(xs: readonly T[]): T[] => {
          const a = [...xs];
          let s = seed >>> 0;
          for (let i = a.length - 1; i > 0; i--) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const j = s % (i + 1);
            [a[i], a[j]] = [a[j]!, a[i]!];
          }
          return a;
        };
        const one = buildEdges(importsOf(files, list), resolve(files));
        const two = buildEdges(importsOf(shuffle(files), shuffle(list)), resolve(files));
        expect(two.edges).toEqual(one.edges);
        expect([...importedByOf(two.edges, shuffle(files))]).toEqual([...importedByOf(one.edges, files)]);
      }),
      { numRuns: 200 },
    );
  });
});

describe('examples', () => {
  it('drops self-imports and edges to files outside the set', () => {
    const imports = new Map<string, ImportRef[]>([
      ['a.ts', [{ specifier: 'a.ts', typeOnly: false, kind: 'static' }, { specifier: 'b.ts', typeOnly: false, kind: 'static' }]],
      ['b.ts', [{ specifier: 'c.ts', typeOnly: false, kind: 'static' }]],
    ]);
    const { edges } = buildEdges(imports, (_f, s) => ({ to: s }));
    expect(importedByOf(edges, ['a.ts', 'b.ts'])).toEqual(new Map([['a.ts', []], ['b.ts', [{ path: 'a.ts' }]]]));
  });
});
