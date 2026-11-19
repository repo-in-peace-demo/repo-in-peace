import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareCodePoint } from './sort';

describe('compareCodePoint', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    ['', 'a', -1],
    ['a', '', 1],
    ['', '', 0],
    ['a', 'ab', -1],
    ['src', 'src/lib', -1],
    ['B', 'a', -1], // uppercase sorts before lowercase, whatever the locale
    ['a/b', 'a.b', 1], // "/" (U+002F) is after "." (U+002E)
  ])('compares %j and %j as %i', (a, b, expected) => {
    expect(compareCodePoint(a, b)).toBe(expected);
  });

  it('orders by code point, not UTF-16 code unit, for characters outside the BMP', () => {
    const astral = '\u{1F600}'; // code point 0x1F600, UTF-16 starts with 0xD83D
    const high = '\uFFFF';
    expect(compareCodePoint(high, astral)).toBe(-1);
    expect(compareCodePoint(astral, high)).toBe(1);
    expect(high < astral).toBe(false); // plain `<` gets this wrong
  });

  it('sorts a list the same way every time', () => {
    const list = ['src/b.ts', 'Src/a.ts', 'src/a.ts', 'a.ts', 'src', ''];
    expect([...list].sort(compareCodePoint)).toEqual(['', 'Src/a.ts', 'a.ts', 'src', 'src/a.ts', 'src/b.ts']);
  });
});

describe('compareCodePoint properties', () => {
  const text = fc.string({ unit: 'grapheme', maxLength: 8 });

  it('is zero exactly when the strings are equal', () => {
    fc.assert(fc.property(text, text, (a, b) => (compareCodePoint(a, b) === 0) === (a === b)));
  });

  it('is antisymmetric', () => {
    fc.assert(fc.property(text, text, (a, b) => compareCodePoint(a, b) === -compareCodePoint(b, a)));
  });

  it('is transitive', () => {
    fc.assert(
      fc.property(text, text, text, (a, b, c) => {
        if (compareCodePoint(a, b) <= 0 && compareCodePoint(b, c) <= 0) {
          return compareCodePoint(a, c) <= 0;
        }
        return true;
      }),
    );
  });

  it('gives one result whatever order the input arrives in', () => {
    fc.assert(
      fc.property(fc.uniqueArray(text, { maxLength: 20 }), (items) => {
        const forward = [...items].sort(compareCodePoint);
        const backward = [...items].reverse().sort(compareCodePoint);
        return JSON.stringify(forward) === JSON.stringify(backward);
      }),
    );
  });
});
