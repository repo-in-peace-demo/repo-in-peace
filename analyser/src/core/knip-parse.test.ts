import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KnipOutputError, parseKnipOutput } from './knip-parse';

// The example from Knip's documentation (https://knip.dev/features/reporters#json).
const DOCS_SAMPLE = JSON.stringify({
  issues: [
    { file: 'src/legacy.ts', files: [{ name: 'src/legacy.ts' }] },
    {
      file: 'src/math.ts',
      exports: [{ name: 'factorial', line: 12, col: 14, pos: 256 }],
      types: [{ name: 'Radians', line: 20, col: 13, pos: 410 }],
    },
    { file: 'package.json', dependencies: [{ name: 'lodash' }], unlisted: [{ name: 'rimraf' }] },
  ],
});

describe('parseKnipOutput', () => {
  it('reads unused files from the documented shape and ignores exports, types and dependencies', () => {
    expect(parseKnipOutput(DOCS_SAMPLE)).toEqual(new Set(['src/legacy.ts']));
  });

  it('returns an empty set when Knip finds nothing', () => {
    expect(parseKnipOutput('{"issues":[]}')).toEqual(new Set());
  });

  it('ignores entries whose files array is empty, as when every issue type is enabled', () => {
    const json = JSON.stringify({
      issues: [
        { file: 'src/a.ts', files: [], exports: [{ name: 'x' }] },
        { file: 'src/b.ts', files: [{ name: 'src/b.ts' }], exports: [] },
      ],
    });
    expect(parseKnipOutput(json)).toEqual(new Set(['src/b.ts']));
  });

  it('reads several unused files', () => {
    const json = JSON.stringify({
      issues: [
        { file: 'a.ts', files: [{ name: 'a.ts' }] },
        { file: 'src/deep/b.tsx', files: [{ name: 'src/deep/b.tsx' }] },
      ],
    });
    expect(parseKnipOutput(json)).toEqual(new Set(['a.ts', 'src/deep/b.tsx']));
  });

  it('reads the older shape, with a top-level files array', () => {
    const json = JSON.stringify({ files: ['old/a.js', 'old/b.js'], issues: [] });
    expect(parseKnipOutput(json)).toEqual(new Set(['old/a.js', 'old/b.js']));
  });

  it('combines both shapes', () => {
    const json = JSON.stringify({
      files: ['old/a.js'],
      issues: [{ file: 'src/new.ts', files: [{ name: 'src/new.ts' }] }],
    });
    expect(parseKnipOutput(json)).toEqual(new Set(['old/a.js', 'src/new.ts']));
  });

  it('falls back to the names inside files when an entry has no file field', () => {
    const json = JSON.stringify({ issues: [{ files: [{ name: 'src/x.ts' }] }] });
    expect(parseKnipOutput(json)).toEqual(new Set(['src/x.ts']));
  });

  it('normalises backslashes and a leading ./', () => {
    const json = JSON.stringify({
      issues: [
        { file: 'src\\win\\a.ts', files: [{ name: 'src\\win\\a.ts' }] },
        { file: './b.ts', files: [{ name: './b.ts' }] },
      ],
    });
    expect(parseKnipOutput(json)).toEqual(new Set(['src/win/a.ts', 'b.ts']));
  });

  it('accepts surrounding whitespace and a trailing newline', () => {
    expect(parseKnipOutput(`  ${DOCS_SAMPLE}\n\n`)).toEqual(new Set(['src/legacy.ts']));
  });

  it('uses the last line when something else was printed before the JSON', () => {
    expect(parseKnipOutput(`Loading config...\nwarning: something\n${DOCS_SAMPLE}\n`)).toEqual(
      new Set(['src/legacy.ts']),
    );
  });

  it.each([
    ['empty output', ''],
    ['only whitespace', '  \n '],
    ['not JSON', 'Error: cannot find module'],
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['an object with no issues', '{"files":[]}'],
    ['issues that is not an array', '{"issues":{}}'],
    ['an issue that is not an object', '{"issues":[5]}'],
    ['an issue listing unused files but naming none', '{"issues":[{"files":[{}]}]}'],
  ])('throws KnipOutputError for %s', (_label, text) => {
    expect(() => parseKnipOutput(text)).toThrow(KnipOutputError);
  });

  it('shows the start of unparseable output in the error', () => {
    expect(() => parseKnipOutput('Error: cannot find module "typescript"')).toThrow(/cannot find module/);
  });
});

describe('parseKnipOutput properties', () => {
  it('returns exactly the files flagged unused, whatever else the entries contain', () => {
    const entry = fc.record({
      file: fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,3}\.(ts|js|tsx)$/),
      unused: fc.boolean(),
      hasExports: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.uniqueArray(entry, { selector: (e) => e.file, maxLength: 20 }), (entries) => {
        const json = JSON.stringify({
          issues: entries.map((e) => ({
            file: e.file,
            files: e.unused ? [{ name: e.file }] : [],
            ...(e.hasExports ? { exports: [{ name: 'x', line: 1, col: 1, pos: 0 }] } : {}),
          })),
        });
        const expected = new Set(entries.filter((e) => e.unused).map((e) => e.file));
        return JSON.stringify([...parseKnipOutput(json)].sort()) === JSON.stringify([...expected].sort());
      }),
    );
  });

  it('either returns a set or throws KnipOutputError for any text, never anything else', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.constant('')), (text) => {
        try {
          return parseKnipOutput(text) instanceof Set;
        } catch (error) {
          return error instanceof KnipOutputError;
        }
      }),
    );
  });

  it('never throws a non-KnipOutputError for arbitrary JSON values in the issues array', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { maxLength: 8 }), (items) => {
        try {
          parseKnipOutput(JSON.stringify({ issues: items }));
          return true;
        } catch (error) {
          return error instanceof KnipOutputError;
        }
      }),
    );
  });
});
