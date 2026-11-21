import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootLines, diggingLines, typedText, typingDuration } from './boot-script';
import { DIG_MIN_MS, DIG_MIN_REDUCED_MS, digHoldMs, digMinimumMs } from './digging-timing';

const manifest = { version: 1 as const, graveyards: [{ name: 'demo.oikosledger', repo: 'oikos_ledger', files: 129, unused: 12, ghosts: 0 }, { name: 'demo.spatialql', repo: 'spatialql', files: 120, unused: 2, ghosts: 2 }] };
const whole = (lines: readonly string[]) => lines.join('\n');

describe('the boot text', () => {
  it('is our own: no SGI, IRIX or FSN anywhere, and it says how many graveyards were found', () => {
    for (const lines of [bootLines(manifest), bootLines(null), diggingLines({ repo: 'x', files: 3, unused: 1, ghosts: 1 })]) expect(whole(lines)).not.toMatch(/sgi|irix|fsn|silicon graphics/i);
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
  it('use the real counts (graves, Unused, ghosts), in the singular for one, and leave out a count of none', () => {
    expect(diggingLines({ repo: 'oikos_ledger', files: 129, unused: 12, ghosts: 0 })).toEqual(['opening oikos_ledger…', 'exhuming 129 graves…', '12 lie Unused…', 'raising the fences…']);
    expect(diggingLines({ repo: 'spatialql', files: 120, unused: 2, ghosts: 2 })).toEqual(['opening spatialql…', 'exhuming 120 graves…', '2 lie Unused…', 'summoning 2 ghosts…', 'raising the fences…']);
    expect(diggingLines({ repo: 'r', files: 1, unused: 1, ghosts: 1 })).toEqual(['opening r…', 'exhuming 1 grave…', '1 lies Unused…', 'summoning 1 ghost…', 'raising the fences…']);
    expect(diggingLines({ repo: 'big', files: 2000, unused: 0, ghosts: 0 })).toEqual(['opening big…', 'exhuming 2,000 graves…', 'raising the fences…']);
    expect(diggingLines(null)).toEqual(['opening the gates…']);
  });

  it('type out well inside the digging screen\'s beat, for any counts', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z_]{1,30}$/), fc.nat(1_000_000), fc.nat(1_000_000), fc.nat(1_000_000), (repo, files, unused, ghosts) => typingDuration(diggingLines({ repo, files, unused, ghosts })) < DIG_MIN_MS - 300),
    );
  });
});

describe('P8: the digging screen\'s timing', () => {
  it('holds it until the minimum has passed since the choice (1.8 s; 0.6 s under reduced motion), and adds nothing once it has', () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ min: -1000, max: 10_000, noNaN: true }), fc.constantFrom(0, Number.NaN, Number.POSITIVE_INFINITY)), fc.boolean(), (work, reduced) => {
        const hold = digHoldMs(work, reduced);
        const min = digMinimumMs(reduced);
        const realWork = Number.isFinite(work) && work > 0 ? work : 0;
        return hold >= 0 && hold <= min && (Number.isFinite(work) ? (realWork >= min ? hold === 0 : realWork + hold === min) : true);
      }),
    );
    expect(digHoldMs(0)).toBe(DIG_MIN_MS);
    expect(DIG_MIN_MS).toBe(1800);
    expect(digHoldMs(0, true)).toBe(DIG_MIN_REDUCED_MS);
    expect(DIG_MIN_REDUCED_MS).toBe(600);
    expect(digHoldMs(5000)).toBe(0);
  });
});
