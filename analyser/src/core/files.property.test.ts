import fc from 'fast-check';
import { describe, it } from 'vitest';
import { EXCLUDED_DIRECTORIES, countNonBlankLines, isTrackedSourcePath } from './files';

const excludedDir = fc.constantFrom(...EXCLUDED_DIRECTORIES);
const okDir = fc.constantFrom('src', 'lib', 'app', 'utils', 'distance', 'builder', 'outline', 'a', 'b');
const sourceExt = fc.constantFrom('.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts');
const baseName = fc.constantFrom('index', 'main', 'util', 'App', 'dist', 'build', 'out');

/** Builds a path from directories, a base name and an extension. */
const pathWith = (dirs: string[], base: string, ext: string) => [...dirs, `${base}${ext}`].join('/');

describe('isTrackedSourcePath properties', () => {
  it('rejects any path with an excluded directory at any depth', () => {
    fc.assert(
      fc.property(
        fc.array(okDir, { maxLength: 3 }),
        excludedDir,
        fc.array(okDir, { maxLength: 3 }),
        baseName,
        sourceExt,
        (before, excluded, after, base, ext) =>
          !isTrackedSourcePath(pathWith([...before, excluded, ...after], base, ext)),
      ),
    );
  });

  it('accepts any path of ordinary directories with a source extension', () => {
    fc.assert(
      fc.property(
        fc.array(okDir, { maxLength: 5 }),
        baseName,
        sourceExt,
        (dirs, base, ext) => isTrackedSourcePath(pathWith(dirs, base, ext)),
      ),
    );
  });

});

describe('countNonBlankLines properties', () => {
  const lineChar = fc.constantFrom(' ', '\t', '\r', 'a', 'b', '}', 'é', '/');
  const line = fc.stringOf(lineChar, { maxLength: 12 });

  it('equals the number of generated lines that contain a non-whitespace character', () => {
    fc.assert(
      fc.property(
        fc.array(line, { maxLength: 30 }),
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        (lines, eol, trailingNewline) => {
          const text = lines.join(eol) + (trailingNewline && lines.length > 0 ? eol : '');
          const expected = lines.filter((l) => /\S/.test(l)).length;
          return countNonBlankLines(new TextEncoder().encode(text)) === expected;
        },
      ),
    );
  });

  it('never exceeds the number of lines', () => {
    fc.assert(
      fc.property(fc.array(line, { maxLength: 30 }), (lines) => {
        const text = lines.join('\n');
        return countNonBlankLines(new TextEncoder().encode(text)) <= lines.length;
      }),
    );
  });
});
