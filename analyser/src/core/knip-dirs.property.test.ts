import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseKnipDir, prefixKnipPaths, relativeToKnipDir } from './knip-dirs';

// A small repository: files at the top, and under a few nested folders, with names that
// look alike (app, application) to catch prefix mistakes.
const segment = fc.constantFrom('app', 'application', 'web', 'src', 'lib', 'sp ace', 'é');
const fileName = fc.constantFrom('a.ts', 'b.js', 'c.tsx', 'index.ts');
const filePath = fc
  .tuple(fc.array(segment, { maxLength: 4 }), fileName)
  .map(([dirs, name]) => [...dirs, name].join('/'));
const repoFiles = fc.uniqueArray(filePath, { minLength: 1, maxLength: 30 });

/** A folder of the repository: the root, or the folder of one of its files. */
function foldersOf(files: readonly string[]): string[] {
  const dirs = new Set<string>(['']);
  for (const file of files) {
    const parts = file.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs];
}

describe('every path Knip reports, once prefixed, is one of the current files', () => {
  it('holds for any folder and any subset of the files in it', () => {
    fc.assert(
      fc.property(repoFiles, fc.nat(), fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }), (files, pick, coins) => {
        const dirs = foldersOf(files);
        const dir = dirs[pick % dirs.length]!;

        // What Knip prints when run in `dir`: paths relative to `dir`, for a subset of the files under it.
        const reported = relativeToKnipDir(dir, files).filter((_, i) => coins[i % coins.length]);

        const prefixed = prefixKnipPaths(dir, reported);
        const current = new Set(files);
        return [...prefixed].every((path) => current.has(path)) && prefixed.size === new Set(reported).size;
      }),
    );
  });

  it('holds when several folders are merged', () => {
    fc.assert(
      fc.property(repoFiles, fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), (files, picks) => {
        const dirs = foldersOf(files);
        const current = new Set(files);
        const merged = new Set<string>();
        for (const pick of picks) {
          const dir = dirs[pick % dirs.length]!;
          // Knip reports every file under its folder as unused: the largest possible report.
          for (const path of prefixKnipPaths(dir, relativeToKnipDir(dir, files))) merged.add(path);
        }
        return [...merged].every((path) => current.has(path));
      }),
    );
  });

  it('covers exactly the files under the folder, no more and no fewer', () => {
    fc.assert(
      fc.property(repoFiles, fc.nat(), (files, pick) => {
        const dirs = foldersOf(files);
        const dir = dirs[pick % dirs.length]!;
        const prefixed = prefixKnipPaths(dir, relativeToKnipDir(dir, files));
        const expected = files.filter((f) => dir === '' || f.startsWith(`${dir}/`));
        return JSON.stringify([...prefixed].sort()) === JSON.stringify([...expected].sort());
      }),
    );
  });

  it('does not match a folder whose name merely starts with the same letters', () => {
    expect(relativeToKnipDir('app', ['application/x.ts', 'app/y.ts'])).toEqual(['y.ts']);
  });
});

describe('normaliseKnipDir properties', () => {
  const rawDir = fc.stringMatching(/^(\.\/|\.\.\/|\/)?[a-z.]{0,6}(\/[a-z.]{0,6}){0,3}\/?$/);

  it('never returns an absolute path, a trailing slash or a ".." segment', () => {
    fc.assert(
      fc.property(rawDir, (raw) => {
        const dir = normaliseKnipDir(raw);
        if (dir === undefined) return true;
        return !dir.startsWith('/') && !dir.endsWith('/') && !dir.split('/').includes('..') && !dir.includes('//');
      }),
    );
  });

  it('is idempotent: cleaning a cleaned folder changes nothing', () => {
    fc.assert(
      fc.property(rawDir, (raw) => {
        const dir = normaliseKnipDir(raw);
        return dir === undefined || normaliseKnipDir(dir === '' ? '.' : dir) === dir;
      }),
    );
  });
});
