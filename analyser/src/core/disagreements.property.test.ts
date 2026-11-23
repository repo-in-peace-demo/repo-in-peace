import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { disagreementReport, disagreements } from './disagreements';
import { buildEdges, importedByOf } from './import-graph';

const graphArb = fc
  .uniqueArray(fc.stringMatching(/^[a-z]{1,4}\.ts$/), { minLength: 1, maxLength: 20 })
  .chain((paths) =>
    fc.record({
      files: fc.tuple(...paths.map((path) => fc.record({ path: fc.constant(path), unused: fc.boolean(), entry: fc.boolean() }))),
      edges: fc.array(fc.tuple(fc.constantFrom(...paths), fc.constantFrom(...paths)), { maxLength: 50 }),
    }),
  );

describe('P2, P3: every disagreement is reported, and nothing else', () => {
  it('reports exactly the unused files with a used importer, and the used non-entry files nothing imports', () => {
    fc.assert(
      fc.property(graphArb, ({ files, edges }) => {
        const imports = new Map(files.map((f) => [f.path, edges.filter(([from]) => from === f.path).map(([, to]) => ({ specifier: to, typeOnly: false, kind: 'static' as const }))]));
        const by = importedByOf(buildEdges(imports, (_f, s) => ({ to: s })).edges, files.map((f) => f.path));
        const d = disagreements(files, by);
        const unused = new Set(files.filter((f) => f.unused).map((f) => f.path));
        const importersOf = (p: string) => [...new Set(edges.filter(([from, to]) => to === p && from !== p).map(([from]) => from))];
        // P2: an unused file is reported exactly when one of its importers is used.
        for (const f of files.filter((x) => x.unused)) {
          const live = importersOf(f.path).some((i) => !unused.has(i));
          expect(d.usedImporters.some((x) => x.file === f.path), f.path).toBe(live);
        }
        for (const x of d.usedImporters) expect(unused.has(x.importer)).toBe(false);
        // P3: a used file is reported exactly when it isn't an entry point and nothing imports it.
        for (const f of files.filter((x) => !x.unused)) expect(d.unimported.includes(f.path), f.path).toBe(!f.entry && importersOf(f.path).length === 0);
        expect(d.unimported.every((p) => !unused.has(p))).toBe(true);
      }),
      { numRuns: 400 },
    );
  });
});

describe('the report', () => {
  it('names each file and the used importer, at most 20 of each, then a count', () => {
    const many = Array.from({ length: 23 }, (_, i) => `f${i}.ts`);
    const lines = disagreementReport({ usedImporters: many.map((file) => ({ file, importer: 'live.ts' })), unimported: many });
    expect(lines[0]).toBe('Knip and the import graph disagree on 23 files (the data is written as Knip says):');
    expect(lines[1]).toBe('  f0.ts is unused (Knip), but imported by live.ts, which is used');
    expect(lines).toContain('  … and 3 more');
    expect(lines.at(-1)).toMatch(/^Used files nothing imports and that aren't entry points \(23\): f0\.ts, .*, … and 3 more$/);
    expect(disagreementReport({ usedImporters: [], unimported: [] })).toEqual([]);
  });
});
