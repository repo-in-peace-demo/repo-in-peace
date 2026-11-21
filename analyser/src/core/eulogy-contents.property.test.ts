import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONTENTS_BUDGET_BYTES, cutContents } from './eulogy-contents';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const byteLength = (text: string): number => encode(text).length;

/** Text files: lines of any Unicode text (no NUL), so the multi-byte characters land on and around the budget. */
const textArb = fc.array(fc.string({ unit: 'grapheme', maxLength: 120 }).map((s) => s.replace(/\0/g, '')), { maxLength: 80 }).map((lines) => lines.join('\n'));

describe('P6: cutting a file to the budget', () => {
  it('never exceeds the budget, is a prefix of the file, is whole UTF-8, and ends at a line end when one fits', () => {
    fc.assert(
      fc.property(textArb, fc.integer({ min: 1, max: 600 }), (text, budget) => {
        const bytes = encode(text);
        const c = cutContents(bytes, budget);
        if (bytes.length === 0) return c.kind === 'empty';
        if (c.kind !== 'text') return false;
        const size = byteLength(c.text);
        if (size > budget || !text.startsWith(c.text)) return false;
        if (!c.cut) return c.text === text && bytes.length <= budget;
        // Cut: at the last line end within the budget when there is one there.
        const lastNewline = bytes.lastIndexOf(0x0a, budget - 1);
        return lastNewline >= 0 ? c.text.endsWith('\n') && size === lastNewline + 1 : size <= budget && size > budget - 4;
      }),
      { numRuns: 400 },
    );
  });

  it('calls a file with a NUL byte, or one that is not UTF-8, binary; an empty file empty', () => {
    expect(cutContents(new Uint8Array([0x61, 0x00, 0x62]))).toEqual({ text: '', cut: false, kind: 'binary' });
    expect(cutContents(new Uint8Array([0xff, 0xfe, 0x41]))).toEqual({ text: '', cut: false, kind: 'binary' });
    expect(cutContents(new Uint8Array())).toEqual({ text: '', cut: false, kind: 'empty' });
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), fc.nat(299), (bytes, at) => {
        const withNul = new Uint8Array([...bytes.slice(0, at), 0, ...bytes.slice(at)]);
        return cutContents(withNul).kind === 'binary';
      }),
    );
  });

  it('cuts a 10 KB file to whole lines under 4096 bytes, and marks it cut', () => {
    const line = 'export const value = 1; // a line of about forty bytes\n';
    const big = line.repeat(Math.ceil(10_240 / line.length));
    const c = cutContents(encode(big));
    expect(c.cut).toBe(true);
    expect(byteLength(c.text)).toBeLessThanOrEqual(CONTENTS_BUDGET_BYTES);
    expect(byteLength(c.text)).toBeGreaterThan(CONTENTS_BUDGET_BYTES - line.length);
    expect(c.text.endsWith('\n')).toBe(true);
  });

  it('cuts one very long line at the budget without splitting a character', () => {
    const c = cutContents(encode('é'.repeat(3000)), 4095); // two bytes each: 4095 is in the middle of one
    expect(byteLength(c.text)).toBe(4094);
    expect(c.text).toBe('é'.repeat(2047));
  });
});
