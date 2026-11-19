import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { DEFAULT_THRESHOLDS, makeFileCase, makeThresholds, thresholdsArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { buildLegend, snapshotDay, type LegendEntry, type LegendId } from './legend';
import { SYNTHETIC_THRESHOLDS } from './synthetic';

const metaWith = (thresholds: Thresholds, snapshotDate = '2026-08-18T00:38:17.000Z'): RepoMeta => ({
  ...makeFileCase({ age: 0, unused: false, hot: false, thresholds }).meta,
  snapshotDate,
});

const textOf = (legend: ReturnType<typeof buildLegend>, id: LegendId): string => legend.entries.find((e) => e.id === id)!.text;

describe('buildLegend with thresholds 21 / 45 / 5 commits in 30 days (the oikos_ledger file)', () => {
  const legend = buildLegend(metaWith(SYNTHETIC_THRESHOLDS));

  it('has an entry for every effect, in a fixed order', () => {
    expect(legend.entries.map((e) => e.id)).toEqual(['fresh', 'moss', 'ancient', 'unused', 'hot', 'ghost', 'floor']);
  });

  it('says what each effect means, with the real numbers', () => {
    expect(textOf(legend, 'fresh')).toBe('Last commit under 21 days before the snapshot.');
    expect(textOf(legend, 'moss')).toBe('Untouched 21 or more days. More moss the longer it has been untouched.');
    expect(textOf(legend, 'ancient')).toBe('Untouched more than 45 days.');
    expect(textOf(legend, 'unused')).toBe('Knip reports the file unused. This can happen with any of the above.');
    expect(textOf(legend, 'hot')).toBe('5 or more commits in the 30 days before the snapshot.');
    expect(textOf(legend, 'ghost')).toBe('A file that was deleted.');
    expect(textOf(legend, 'floor')).toBe('A folder nested deeper.');
  });

  it('gives each entry a short title', () => {
    expect(legend.entries.map((e) => e.title)).toEqual([
      'Clean, upright stone',
      'Moss',
      'Leaning, heavily overgrown',
      'Cracks and a faint red glow',
      'Lit candle',
      'Translucent floating figure',
      'Darker ground',
    ]);
  });

  it('says which day the ages are measured from', () => {
    expect(legend.snapshotLine).toBe('Ages are measured from the snapshot: 2026-08-18.');
  });

  it('says that the cracks can combine with the other effects', () => {
    expect(textOf(legend, 'unused')).toContain('any of the above');
  });
});

describe('buildLegend with other thresholds', () => {
  it('uses the thresholds of the data file, with the default values 90 / 360 / 5 in 30', () => {
    const legend = buildLegend(metaWith(DEFAULT_THRESHOLDS));
    expect(textOf(legend, 'fresh')).toContain('under 90 days');
    expect(textOf(legend, 'moss')).toContain('Untouched 90 or more days');
    expect(textOf(legend, 'ancient')).toContain('more than 360 days');
    expect(textOf(legend, 'hot')).toBe('5 or more commits in the 30 days before the snapshot.');
  });

  it('uses the spatialql thresholds, 14 / 30', () => {
    const legend = buildLegend(metaWith(makeThresholds(14, 16, 5, 30)));
    expect(textOf(legend, 'fresh')).toContain('under 14 days');
    expect(textOf(legend, 'ancient')).toContain('more than 30 days');
  });

  it('reads correctly in the singular', () => {
    const legend = buildLegend(metaWith(makeThresholds(1, 1, 1, 1)));
    expect(textOf(legend, 'fresh')).toBe('Last commit under 1 day before the snapshot.');
    expect(textOf(legend, 'ancient')).toBe('Untouched more than 2 days.'); // stale after 1, ancient after 2
    expect(textOf(legend, 'hot')).toBe('1 or more commits in the 1 day before the snapshot.');
  });

  it('shows the snapshot day of the data file, and only the day', () => {
    expect(buildLegend(metaWith(SYNTHETIC_THRESHOLDS, '2026-10-18T22:37:25.000Z')).snapshotLine).toContain('2026-10-18');
    expect(snapshotDay(metaWith(SYNTHETIC_THRESHOLDS, '2026-10-18T22:37:25.000Z'))).toBe('2026-10-18');
  });

  it.each(REAL_GRAVEYARDS)('reads the real thresholds of %s', (name) => {
    const g = loadRealGraveyard(name);
    const legend = buildLegend(g.meta);
    expect(textOf(legend, 'fresh')).toContain(`under ${g.meta.thresholds.staleAfterDays} days`);
    expect(textOf(legend, 'ancient')).toContain(`more than ${g.meta.thresholds.ancientAfterDays} days`);
  });
});

describe('P11: the legend says the real numbers', () => {
  /** The first number captured by a regular expression from a legend text. */
  const numbers = (text: string, pattern: RegExp): number[] => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`"${text}" does not match ${pattern}`);
    return match.slice(1).map(Number);
  };

  it('gives every threshold number in the entry that explains it', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const legend = buildLegend(metaWith(t));
        const [fresh] = numbers(textOf(legend, 'fresh'), /under (\d+) days?/);
        const [moss] = numbers(textOf(legend, 'moss'), /Untouched (\d+) or more days/);
        const [ancient] = numbers(textOf(legend, 'ancient'), /more than (\d+) days?/);
        const [commits, window] = numbers(textOf(legend, 'hot'), /(\d+) or more commits in the (\d+) days?/);
        return fresh === t.staleAfterDays && moss === t.staleAfterDays && ancient === t.ancientAfterDays && commits === t.hotCommits && window === t.hotWindowDays;
      }),
    );
  });

  it('has exactly the seven entries, each once, each with words', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const { entries } = buildLegend(metaWith(t));
        const ids = entries.map((e) => e.id);
        return (
          ids.length === 7 &&
          new Set(ids).size === 7 &&
          entries.every((e: LegendEntry) => e.title.trim().length > 0 && e.text.trim().length > 0)
        );
      }),
    );
  });

  it('has the ground-tint entry, which says darker ground means a deeper folder', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const floor = buildLegend(metaWith(t)).entries.find((e) => e.id === 'floor');
        return floor !== undefined && /Darker ground/.test(floor.title) && /nested deeper/.test(floor.text);
      }),
    );
  });

  it('changes only the words that carry a number when the thresholds change', () => {
    fc.assert(
      fc.property(thresholdsArb, thresholdsArb, (a, b) => {
        const first = buildLegend(metaWith(a));
        const second = buildLegend(metaWith(b));
        const unchanged: LegendId[] = ['unused', 'ghost', 'floor'];
        return (
          unchanged.every((id) => JSON.stringify(first.entries.find((e) => e.id === id)) === JSON.stringify(second.entries.find((e) => e.id === id))) &&
          first.entries.every((e, i) => e.id === second.entries[i]!.id && e.title === second.entries[i]!.title) &&
          first.snapshotLine === second.snapshotLine
        );
      }),
    );
  });

  it('gives the snapshot day of any date, as the first ten characters of the ISO date', () => {
    fc.assert(
      fc.property(fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }), (date) => {
        const iso = date.toISOString();
        const legend = buildLegend(metaWith(SYNTHETIC_THRESHOLDS, iso));
        return legend.snapshotLine.includes(iso.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDay(metaWith(SYNTHETIC_THRESHOLDS, iso)));
      }),
    );
  });

  it('is the same every time', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => JSON.stringify(buildLegend(metaWith(t))) === JSON.stringify(buildLegend(metaWith(t)))),
    );
  });
});
