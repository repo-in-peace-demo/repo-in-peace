import { describe, expect, it } from 'vitest';
import { countNonBlankLines, isTrackedSourcePath } from './files';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('isTrackedSourcePath', () => {
  it.each([
    'index.js',
    'src/app.jsx',
    'lib/util.mjs',
    'lib/util.cjs',
    'src/main.ts',
    'src/App.tsx',
    'src/config.mts',
    'src/config.cts',
    'a/b/c/d/deep.ts',
    'src/dist.ts', // a file called dist is not a directory called dist
    'distance/readme.ts',
    'src/builder/index.ts',
    'src/outline/index.ts',
    'nextjs/page.tsx',
  ])('keeps %s', (path) => {
    expect(isTrackedSourcePath(path)).toBe(true);
  });

  it.each([
    'README.md',
    'package.json',
    'styles.css',
    'script.py',
    'src/main.ts.map',
    'Makefile',
    'src/main.TS', // extensions are case-sensitive
    '',
  ])('drops %s (not a source file)', (path) => {
    expect(isTrackedSourcePath(path)).toBe(false);
  });

  it.each([
    'node_modules/pkg/index.js',
    'packages/a/node_modules/pkg/index.js',
    'dist/index.js',
    'packages/a/dist/index.js',
    'build/out.js',
    'src/build/tool.ts',
    'coverage/lcov-report/prettify.js',
    '.next/server/page.js',
    'out/index.js',
    'a/out/b/c.ts',
  ])('drops %s (excluded directory)', (path) => {
    expect(isTrackedSourcePath(path)).toBe(false);
  });

  it.each(['types.d.ts', 'src/globals.d.ts', 'src/env.d.mts', 'src/env.d.cts'])(
    'drops %s (declaration file)',
    (path) => {
      expect(isTrackedSourcePath(path)).toBe(false);
    },
  );

  it('keeps files that only look like declaration files', () => {
    expect(isTrackedSourcePath('src/d.ts')).toBe(true);
    expect(isTrackedSourcePath('src/model.d.tsx')).toBe(true);
  });
});

describe('countNonBlankLines', () => {
  it.each([
    ['', 0],
    ['\n', 0],
    ['\n\n\n', 0],
    ['   \n\t\n', 0],
    ['a', 1],
    ['a\n', 1],
    ['a\nb', 2],
    ['a\nb\n', 2],
    ['a\n\nb\n', 2],
    ['a\n   \n\tb\n', 2],
    ['a\r\nb\r\n', 2],
    ['a\r\n\r\nb\r\n', 2],
    ['\r\n', 0],
    ['// comment\nconst x = 1;\n\n', 2],
    ['const é = "ü";\n', 1],
  ])('%j has %i non-blank lines', (text, expected) => {
    expect(countNonBlankLines(bytes(text))).toBe(expected);
  });

  it('counts a UTF-8 byte order mark on its own line as blank', () => {
    expect(countNonBlankLines(new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, 0x61, 0x0a]))).toBe(1);
  });

  it('does not throw on bytes that are not valid UTF-8', () => {
    expect(() => countNonBlankLines(new Uint8Array([0xff, 0xfe, 0x0a, 0x80]))).not.toThrow();
  });
});
