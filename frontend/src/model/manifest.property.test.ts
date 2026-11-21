import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { GRAVEYARD_NAME_PATTERN } from './graveyard-load';
import { buildManifest, checkManifest } from './manifest';

/** P6: the manifest lists exactly the valid `*.graveyard.json` files of the folder, with the counts in each. */

type Kind = 'valid' | 'old-version' | 'broken' | 'not-json' | 'other-file' | 'index';
const nameArb = fc.stringMatching(/^[a-z][a-z0-9._-]{0,12}$/);

function entryOf(kind: Kind, name: string, files: number, ghosts: number): { fileName: string; json: unknown } {
  const g = graveyardFrom({ name: `repo-${name}`, files: Array.from({ length: files }, (_, i) => `src/f${i}.ts`), ghosts: Array.from({ length: ghosts }, (_, i) => `gone/g${i}.ts`) });
  switch (kind) {
    case 'valid':
      return { fileName: `${name}.graveyard.json`, json: g };
    case 'old-version':
      return { fileName: `${name}.graveyard.json`, json: { ...g, meta: { ...g.meta, schemaVersion: 1 } } };
    case 'broken':
      return { fileName: `${name}.graveyard.json`, json: { ...g, files: [{ path: 3 }] } };
    case 'not-json':
      return { fileName: `${name}.graveyard.json`, json: undefined };
    case 'other-file':
      return { fileName: `${name}.txt`, json: g };
    case 'index':
      return { fileName: 'index.json', json: { version: 1, graveyards: [] } };
  }
}

describe('P6: the manifest', () => {
  it('lists exactly the valid graveyard files, named and counted from each, sorted; the other graveyard files are skipped, anything else ignored', () => {
    const item = fc.record({
      kind: fc.constantFrom<Kind>('valid', 'old-version', 'broken', 'not-json', 'other-file', 'index'),
      name: nameArb,
      files: fc.integer({ min: 0, max: 5 }),
      ghosts: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(item, { selector: (i) => `${i.kind === 'other-file' ? 'o' : i.kind === 'index' ? 'i' : 'g'}:${i.name}` , maxLength: 12 }), (items) => {
        // One graveyard file per name (the folder cannot hold two files of the same name).
        const seen = new Set<string>();
        const unique = items.filter((i) => {
          const key = i.kind === 'other-file' ? `o:${i.name}` : i.kind === 'index' ? 'index' : `g:${i.name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const { manifest, skipped } = buildManifest(unique.map((i) => entryOf(i.kind, i.name, i.files, i.ghosts)));
        const valid = unique.filter((i) => i.kind === 'valid' && GRAVEYARD_NAME_PATTERN.test(i.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const expected = valid.map((i) => ({ name: i.name, repo: `repo-${i.name}`, files: i.files, unused: 0, ghosts: i.ghosts }));
        const expectedSkipped = unique.filter((i) => ['old-version', 'broken', 'not-json'].includes(i.kind)).map((i) => `${i.name}.graveyard.json`).sort();
        return JSON.stringify(manifest.graveyards) === JSON.stringify(expected) && JSON.stringify(skipped) === JSON.stringify(expectedSkipped) && checkManifest(manifest) !== null;
      }),
      { numRuns: 150 },
    );
  });

  it('for the real folder: spatialql 120 files and 2 ghosts, oikos_ledger 129 files and none', () => {
    const { manifest, skipped } = buildManifest(REAL_GRAVEYARDS.map((name) => ({ fileName: `${name}.graveyard.json`, json: loadRealGraveyard(name) })));
    expect(skipped).toEqual([]);
    expect(manifest.graveyards).toEqual([
      { name: 'demo.oikosledger', repo: 'oikos_ledger', files: 129, unused: 12, ghosts: 0 },
      { name: 'demo.spatialql', repo: 'spatialql', files: 120, unused: 2, ghosts: 2 },
    ]);
  });
});

describe('checkManifest', () => {
  it('accepts a manifest and refuses anything else', () => {
    expect(checkManifest({ version: 1, graveyards: [{ name: 'a', repo: 'r', files: 1, unused: 0, ghosts: 0 }] })).not.toBeNull();
    for (const bad of [null, [], 'x', { version: 2, graveyards: [] }, { version: 1 }, { version: 1, graveyards: [{ name: '../x', repo: 'r', files: 1, unused: 0, ghosts: 0 }] }, { version: 1, graveyards: [{ name: 'a', repo: '', files: 1, unused: 0, ghosts: 0 }] }, { version: 1, graveyards: [{ name: 'a', repo: 'r', files: -1, unused: 0, ghosts: 0 }] }, { version: 1, graveyards: [{ name: 'a', repo: 'r', files: 1, ghosts: 0 }] }]) {
      expect(checkManifest(bad)).toBeNull();
    }
  });
});
