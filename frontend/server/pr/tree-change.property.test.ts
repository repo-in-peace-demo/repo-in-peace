import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { blobSha, buildTrees } from '../../test/git-trees';
import { applyTreeChange, buryChange, lookupPath, resurrectChange, type FlatTree } from './tree-change';

const MODES = ['100644', '100755', '120000'] as const;
const segment = fc.stringMatching(/^[a-z]{1,3}(\.ts)?$/);
const pathArb = fc.array(segment, { minLength: 1, maxLength: 4 }).map((p) => p.join('/'));

/** A file list where no file sits where another needs a folder (as in a real git tree). */
const filesArb = fc.uniqueArray(fc.tuple(pathArb, fc.constantFrom(...MODES), fc.string({ maxLength: 6 })), { minLength: 1, maxLength: 25, selector: ([p]) => p }).map((list) => {
  const files = new Map<string, { mode: string; sha: string }>();
  for (const [path, mode, content] of list) {
    const clash = [...files.keys()].some((f) => path.startsWith(`${f}/`) || f.startsWith(`${path}/`));
    if (!clash) files.set(path, { mode, sha: blobSha(`${path}:${content}`) });
  }
  return files as FlatTree;
});

const diff = (a: FlatTree, b: FlatTree): string[] => {
  const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p))).sort();
};

describe('lookupPath', () => {
  it('finds every file with its mode and blob, and reports folders, absences and files in the way', async () => {
    await fc.assert(
      fc.asyncProperty(filesArb, pathArb, async (files, other) => {
        const store = buildTrees(files);
        for (const [path, f] of files) expect(await lookupPath(store.read, store.root, path)).toEqual({ kind: 'blob', mode: f.mode, sha: f.sha });
        const found = await lookupPath(store.read, store.root, other);
        const isFile = files.has(other);
        const isFolder = [...files.keys()].some((f) => f.startsWith(`${other}/`));
        const blocker = [...files.keys()].find((f) => other.startsWith(`${f}/`));
        if (isFile) expect(found.kind).toBe('blob');
        else if (isFolder) expect(found).toEqual({ kind: 'tree' });
        else if (blocker !== undefined) expect(found).toEqual({ kind: 'blocked', at: blocker });
        else expect(found).toEqual({ kind: 'absent' });
      }),
      { numRuns: 200 },
    );
  });

  it('reports a submodule as such', async () => {
    const store = buildTrees(new Map([['a.ts', { mode: '100644', sha: blobSha('a') }]]), new Map([['vendor/lib', 'c'.repeat(40)]]));
    expect(await lookupPath(store.read, store.root, 'vendor/lib')).toEqual({ kind: 'commit' });
    expect(await lookupPath(store.read, store.root, 'vendor/lib/x.ts')).toEqual({ kind: 'blocked', at: 'vendor/lib' });
  });
});

describe('P3: the tree change', () => {
  it('Bury removes exactly the chosen file, and nothing else', async () => {
    await fc.assert(
      fc.asyncProperty(filesArb, fc.nat(), async (files, i) => {
        const path = [...files.keys()][i % files.size]!;
        const store = buildTrees(files);
        const change = buryChange(path, await lookupPath(store.read, store.root, path));
        if (!('entry' in change)) return false;
        expect(change.entry).toEqual({ path, mode: files.get(path)!.mode, type: 'blob', sha: null });
        const after = applyTreeChange(files, change.entry);
        expect(diff(files, after)).toEqual([path]);
        expect(after.has(path)).toBe(false);
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('Resurrect adds exactly one path, with the original blob and mode, where nothing is in the way', async () => {
    await fc.assert(
      fc.asyncProperty(filesArb, pathArb, fc.constantFrom(...MODES), fc.string({ maxLength: 6 }), async (base, path, mode, content) => {
        const original = new Map([[path, { mode, sha: blobSha(`old:${content}`) }]]);
        const baseStore = buildTrees(base);
        const oldStore = buildTrees(original);
        const onBase = await lookupPath(baseStore.read, baseStore.root, path);
        const change = resurrectChange(path, onBase, await lookupPath(oldStore.read, oldStore.root, path));
        const free = !base.has(path) && ![...base.keys()].some((f) => f.startsWith(`${path}/`) || path.startsWith(`${f}/`));
        if (!free) {
          expect(change).toEqual({ refused: 'already-exists' });
          return;
        }
        if (!('entry' in change)) throw new Error('expected a change');
        const after = applyTreeChange(base, change.entry);
        expect(diff(base, after)).toEqual([path]);
        expect(after.get(path)).toEqual(original.get(path));
      }),
      { numRuns: 300 },
    );
  });

  it('refuses a Bury of a missing file, a folder or a submodule; and a Resurrect without an original file', () => {
    expect(buryChange('a.ts', { kind: 'absent' })).toEqual({ refused: 'not-on-base' });
    expect(buryChange('a/b.ts', { kind: 'blocked', at: 'a' })).toEqual({ refused: 'not-on-base' });
    expect(buryChange('a', { kind: 'tree' })).toEqual({ refused: 'not-a-file' });
    expect(buryChange('a', { kind: 'commit' })).toEqual({ refused: 'not-a-file' });
    expect(resurrectChange('a.ts', { kind: 'absent' }, { kind: 'absent' })).toEqual({ refused: 'original-missing' });
    expect(resurrectChange('a.ts', { kind: 'absent' }, { kind: 'tree' })).toEqual({ refused: 'original-missing' });
    expect(resurrectChange('a.ts', { kind: 'tree' }, { kind: 'blob', mode: '100644', sha: 'x' })).toEqual({ refused: 'already-exists' });
    expect(resurrectChange('a/b.ts', { kind: 'blocked', at: 'a' }, { kind: 'blob', mode: '100644', sha: 'x' })).toEqual({ refused: 'already-exists' });
  });

  it('deleting a path that is not there fails, as on GitHub', () => {
    expect(() => applyTreeChange(new Map(), { path: 'x', mode: '100644', type: 'blob', sha: null })).toThrow(/not in the tree/);
  });
});
