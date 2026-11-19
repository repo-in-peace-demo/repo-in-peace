import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  validateGraveyard,
  type FileEntry,
  type Graveyard,
} from '../../../shared/graveyard-schema';
import { deriveFolders, folderOf } from './folders';
import { compareCodePoint } from './sort';
import { DEFAULT_THRESHOLDS } from './thresholds';

// Directory and file names include spaces, dots, non-ASCII and names that look like
// path pieces, to catch splitting mistakes.
const segment = fc.constantFrom('a', 'b', 'src', 'lib', 'é', 'sp ace', 'x.y', 'dist2', '.hidden', '1');
const fileName = fc.constantFrom('index.ts', 'a.js', 'x.tsx', 'sp ace.ts', 'é.mjs');

/** A file path with 0 to 5 directories above it. */
const filePath = fc
  .tuple(fc.array(segment, { maxLength: 5 }), fileName)
  .map(([dirs, name]) => [...dirs, name].join('/'));

const filePaths = fc.uniqueArray(filePath, { maxLength: 25 });

describe('P4: every file has a folder in the list, and the hierarchy has no cycles', () => {
  it('lists the folder of every file', () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const listed = new Set(deriveFolders(paths).map((f) => f.path));
        return paths.every((p) => listed.has(folderOf(p)));
      }),
    );
  });

  it('lists the parent of every folder, and the parent is the directory above it', () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const folders = deriveFolders(paths);
        const listed = new Set(folders.map((f) => f.path));
        return folders.every((f) =>
          f.path === '' ? f.parent === null : f.parent !== null && listed.has(f.parent) && f.parent === folderOf(f.path),
        );
      }),
    );
  });

  it('has exactly one root, and every parent chain reaches it without repeating a folder', () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const folders = deriveFolders(paths);
        const parentOf = new Map(folders.map((f) => [f.path, f.parent]));

        const roots = folders.filter((f) => f.parent === null);
        if (roots.length !== 1 || roots[0]?.path !== '') return false;

        return folders.every((f) => {
          const seen = new Set<string>();
          let current: string | null | undefined = f.path;
          while (current !== null) {
            if (current === undefined || seen.has(current)) return false; // dangling parent or cycle
            seen.add(current);
            current = parentOf.get(current);
          }
          return true; // reached the root
        });
      }),
    );
  });

  it('lists no folder without a file inside or below it (the root excepted)', () => {
    fc.assert(
      fc.property(filePaths, (paths) =>
        deriveFolders(paths).every(
          (f) => f.path === '' || paths.some((p) => p.startsWith(`${f.path}/`)),
        ),
      ),
    );
  });

  it('lists each folder once, sorted by path', () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const list = deriveFolders(paths).map((f) => f.path);
        const sorted = [...list].sort(compareCodePoint);
        return new Set(list).size === list.length && JSON.stringify(list) === JSON.stringify(sorted);
      }),
    );
  });

  it('gives the same folders whatever order or repetition the files arrive in', () => {
    fc.assert(
      fc.property(filePaths, fc.integer(), (paths, seed) => {
        const shuffled = [...paths].sort((a, b) => ((a.length * 31 + seed) % 7) - ((b.length * 31 + seed) % 7));
        const doubled = [...shuffled, ...paths];
        const expected = JSON.stringify(deriveFolders(paths));
        return JSON.stringify(deriveFolders(shuffled)) === expected && JSON.stringify(deriveFolders(doubled)) === expected;
      }),
    );
  });

  it('passes the shared schema validator when used in a graveyard', () => {
    fc.assert(
      fc.property(filePaths, (paths) => {
        const sha = 'a'.repeat(40);
        const files: FileEntry[] = paths.map((path) => ({
          path,
          folder: folderOf(path),
          linesOfCode: 1,
          lastCommitDate: '2026-01-01T00:00:00.000Z',
          lastCommitAuthor: 'Ann',
          recentCommits: 0,
          unused: false,
          decayScore: 0,
          decayState: 'fresh',
          hot: false,
          eulogy: '',
        }));
        const graveyard: Graveyard = {
          meta: {
            name: 'p4',
            snapshotSha: sha,
            snapshotDate: '2026-01-01T00:00:00.000Z',
            analysedAt: '2026-01-02T00:00:00.000Z',
            schemaVersion: SCHEMA_VERSION,
            thresholds: DEFAULT_THRESHOLDS,
          },
          folders: deriveFolders(paths),
          files,
          ghosts: [],
        };
        const result = validateGraveyard(graveyard);
        expect(result).toEqual({ ok: true });
        return true;
      }),
    );
  });
});
