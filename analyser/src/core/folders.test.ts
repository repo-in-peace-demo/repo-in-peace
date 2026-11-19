import { describe, expect, it } from 'vitest';
import { deriveFolders, folderOf } from './folders';

describe('folderOf', () => {
  it.each([
    ['index.ts', ''],
    ['src/index.ts', 'src'],
    ['src/lib/util.ts', 'src/lib'],
    ['a/b/c/d.ts', 'a/b/c'],
    ['src', ''],
    ['', ''],
  ])('folderOf(%j) is %j', (path, folder) => {
    expect(folderOf(path)).toBe(folder);
  });
});

describe('deriveFolders', () => {
  it('lists only the root for no files', () => {
    expect(deriveFolders([])).toEqual([{ path: '', parent: null }]);
  });

  it('lists only the root for files at the top level', () => {
    expect(deriveFolders(['a.ts', 'b.ts'])).toEqual([{ path: '', parent: null }]);
  });

  it('adds every ancestor of a deep file, with parents, sorted by path', () => {
    expect(deriveFolders(['src/lib/deep/x.ts'])).toEqual([
      { path: '', parent: null },
      { path: 'src', parent: '' },
      { path: 'src/lib', parent: 'src' },
      { path: 'src/lib/deep', parent: 'src/lib' },
    ]);
  });

  it('lists a shared folder once', () => {
    const folders = deriveFolders(['src/a.ts', 'src/b.ts', 'src/lib/c.ts', 'test/d.ts']);
    expect(folders.map((f) => f.path)).toEqual(['', 'src', 'src/lib', 'test']);
  });

  it('keeps names with spaces and non-ASCII characters', () => {
    const folders = deriveFolders(['my dir/é/x.ts']);
    expect(folders.map((f) => f.path)).toEqual(['', 'my dir', 'my dir/é']);
  });

  it('does not mutate its input', () => {
    const input = ['b/x.ts', 'a/y.ts'];
    deriveFolders(input);
    expect(input).toEqual(['b/x.ts', 'a/y.ts']);
  });
});
