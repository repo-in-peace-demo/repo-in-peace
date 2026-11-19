import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fnv1a32, hash01, mix32 } from './hash';

/** An independent implementation of 32-bit FNV-1a, with BigInt arithmetic instead of Math.imul. */
function referenceFnv1a32(text: string): number {
  let hash = 0x811c9dc5n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x01000193n) & 0xffffffffn;
  }
  return Number(hash);
}

/** An independent implementation of the MurmurHash3 finalizer, with BigInt arithmetic. */
function referenceMix32(value: number): number {
  const mask = 0xffffffffn;
  let h = BigInt(value) & mask;
  h ^= h >> 16n;
  h = (h * 0x85ebca6bn) & mask;
  h ^= h >> 13n;
  h = (h * 0xc2b2ae35n) & mask;
  h ^= h >> 16n;
  return Number(h);
}

describe('fnv1a32', () => {
  // Published test vectors for 32-bit FNV-1a.
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('gives the published value for %j', (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });

  it('agrees with an independent implementation for any text, including non-ASCII', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 40 }), (text) => fnv1a32(text) === referenceFnv1a32(text)),
    );
  });

  it('hashes the UTF-8 bytes, so a non-ASCII path has one value on every machine', () => {
    expect(fnv1a32('é')).toBe(referenceFnv1a32('é'));
    expect(fnv1a32('é')).not.toBe(fnv1a32('e'));
  });

  it('is an unsigned 32-bit integer', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const h = fnv1a32(text);
        return Number.isInteger(h) && h >= 0 && h <= 0xffffffff;
      }),
    );
  });
});

describe('mix32', () => {
  it('agrees with an independent implementation for any 32-bit value', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), (v) => mix32(v) === referenceMix32(v)));
  });

  it('maps 0 to 0 (the finalizer has that known fixed point) and is an unsigned 32-bit integer otherwise', () => {
    expect(mix32(0)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0xffffffff }), (v) => {
        const m = mix32(v);
        return Number.isInteger(m) && m >= 0 && m <= 0xffffffff;
      }),
    );
  });

  it('gives a different value for every input in a run of consecutive integers (it is a bijection)', () => {
    const seen = new Set<number>();
    for (let v = 1; v <= 5000; v++) seen.add(mix32(v));
    expect(seen.size).toBe(5000);
  });
});

describe('hash01', () => {
  it('is in [0, 1) for any text and salt', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.string({ maxLength: 10 }), (text, salt) => {
        const h = hash01(text, salt);
        return h >= 0 && h < 1;
      }),
    );
  });

  it('gives the same number every time', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), fc.string({ maxLength: 10 }), (text, salt) => {
        return hash01(text, salt) === hash01(text, salt);
      }),
    );
  });

  it('is the mixed FNV-1a hash of the text, a separator and the salt, divided by 2^32', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 30 }), fc.string({ maxLength: 8 }), (text, salt) => {
        const expected = referenceMix32(referenceFnv1a32(`${text}\u0000${salt}`)) / 4_294_967_296;
        return hash01(text, salt) === expected;
      }),
    );
  });

  it('gives unrelated numbers for different salts: they differ for nearly every path', () => {
    const paths = Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`);
    const differing = paths.filter((p) => hash01(p, 'float') !== hash01(p, 'flicker')).length;
    expect(differing).toBeGreaterThanOrEqual(195);
  });

  it('spreads similar paths over the range instead of bunching them', () => {
    const paths = Array.from({ length: 2000 }, (_, i) => `src/dir-${i % 40}/file-${i}.ts`);
    const buckets = new Array<number>(10).fill(0);
    for (const p of paths) {
      const bucket = Math.floor(hash01(p) * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    // 200 expected per bucket; the margin is wide so the test is about "spread", not about statistics.
    for (const count of buckets) expect(count).toBeGreaterThan(130);
  });

  it('spreads paths that differ only in the last character, too', () => {
    const paths = Array.from('abcdefghijklmnopqrstuvwxyz0123456789', (c) => `src/components/chart-${c}`);
    const values = paths.map((p) => hash01(p, 'lean'));
    expect(Math.min(...values)).toBeLessThan(0.25);
    expect(Math.max(...values)).toBeGreaterThan(0.75);
  });

  it('does not confuse where the text ends and the salt begins', () => {
    expect(hash01('ab', 'c')).not.toBe(hash01('a', 'bc'));
  });
});
