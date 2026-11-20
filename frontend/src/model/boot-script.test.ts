import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootLines, diggingLines, typedText, typingDuration } from './boot-script';
import { DIG_MAX_ADDED_MS, DIG_MIN_MS, digHoldMs } from './digging-timing';

const manifest = { version: 1 as const, graveyards: [{ name: 'demo.oikosledger', repo: 'oikos_ledger', files: 129, ghosts: 0 }, { name: 'demo.spatialql', repo: 'spatialql', files: 120, ghosts: 2 }] };
const whole = (lines: readonly string[]) => lines.join('\n');

describe('the boot text', () => {
  it('is our own: no SGI, IRIX or FSN anywhere, and it says how many graveyards were found', () => {
    for (const lines of [bootLines(manifest), bootLines(null), diggingLines({ repo: 'x', files: 3, ghosts: 1 })]) expect(whole(lines)).not.toMatch(/sgi|irix|fsn|silicon graphics/i);
    expect(whole(bootLines(manifest))).toContain('2 found');
    expect(whole(bootLines(null))).toContain('no demo list');
  });

  it('types in under 2 seconds', () => {
    expect(typingDuration(bootLines(manifest))).toBeLessThan(2000);
  });

  const lines = fc.array(fc.string({ unit: 'grapheme', maxLength: 30 }), { maxLength: 8 });

  it('for any lines and times: shows a prefix of the whole text, never less later, and all of it at the end', () => {
    fc.assert(
      fc.property(lines, fc.double({ min: -100, max: 5000, noNaN: true }), fc.double({ min: 0, max: 3000, noNaN: true }), (ls, t, later) => {
        const a = whole(typedText(ls, t).lines);
        const b = whole(typedText(ls, t + later).lines);
        const all = typedText(ls, Number.POSITIVE_INFINITY);
        return whole(ls).startsWith(a) && b.startsWith(a) && all.done && whole(all.lines) === whole(ls) && typedText(ls, typingDuration(ls)).done;
      }),
    );
  });
});

describe('the digging lines', () => {
  it('use the real counts, in the singular for one, with no ghost line when there are none', () => {
    expect(diggingLines({ repo: 'oikos_ledger', files: 129, ghosts: 0 })).toEqual(['opening oikos_ledger…', 'exhuming 129 graves…', 'raising the fences…']);
    expect(diggingLines({ repo: 'spatialql', files: 120, ghosts: 2 })).toContain('summoning 2 ghosts…');
    expect(diggingLines({ repo: 'r', files: 1, ghosts: 1 })).toEqual(['opening r…', 'exhuming 1 grave…', 'summoning 1 ghost…', 'raising the fences…']);
    expect(diggingLines({ repo: 'big', files: 2000, ghosts: 0 })).toContain('exhuming 2,000 graves…');
    expect(diggingLines(null)).toEqual(['opening the gates…']);
  });
});

describe('P8: the digging screen\'s timing', () => {
  it('adds between 0 and the cap, and shows for at least the minimum in all, for any work time', () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ min: -1000, max: 10_000, noNaN: true }), fc.constantFrom(0, Number.NaN, Number.POSITIVE_INFINITY)), (work) => {
        const hold = digHoldMs(work);
        const realWork = Number.isFinite(work) && work > 0 ? work : 0;
        return hold >= 0 && hold <= DIG_MAX_ADDED_MS && (realWork + hold >= DIG_MIN_MS || !Number.isFinite(work));
      }),
    );
    expect(digHoldMs(0)).toBe(DIG_MIN_MS);
    expect(digHoldMs(5000)).toBe(0);
  });
});
