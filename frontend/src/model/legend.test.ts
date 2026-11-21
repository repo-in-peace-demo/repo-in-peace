import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { DEFAULT_THRESHOLDS, makeFileCase, makeThresholds, thresholdsArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { buildLegend, legendEntries, snapshotDay, type LegendEntry, type LegendId } from './legend';
import { SYNTHETIC_THRESHOLDS } from './synthetic';

const metaWith = (thresholds: Thresholds, snapshotDate = '2026-08-18T00:38:17.000Z'): RepoMeta => ({
  ...makeFileCase({ age: 0, unused: false, hot: false, thresholds }).meta,
  snapshotDate,
});

const entryOf = (legend: ReturnType<typeof buildLegend>, id: LegendId): LegendEntry => legendEntries(legend).find((e) => e.id === id)!;
const textOf = (legend: ReturnType<typeof buildLegend>, id: LegendId): string => entryOf(legend, id).text;

describe('buildLegend with thresholds 21 / 45 / 5 commits in 30 days (the oikos_ledger file)', () => {
  const legend = buildLegend(metaWith(SYNTHETIC_THRESHOLDS));

  it('groups the entries by dimension, in the same order as the stats panel, with the ground last', () => {
    expect(legend.groups.map((g) => g.title)).toEqual(['Age', 'Usage', 'Activity', 'History', 'Layout']);
    expect(legend.groups.map((g) => g.entries.map((e) => e.id))).toEqual([['fresh', 'stale', 'ancient'], ['unused'], ['hot'], ['ghost'], ['floor']]);
  });

  it('names each fact as everywhere else: Fresh, Stale, Ancient, Unused, Hot, Ghosts', () => {
    expect(legendEntries(legend).map((e) => e.title)).toEqual(['Fresh', 'Stale', 'Ancient', 'Unused', 'Hot', 'Ghosts', 'Darker ground']);
  });

  it('says how each looks, then its rule, with the real numbers', () => {
    expect(textOf(legend, 'fresh')).toBe('A clean, upright stone. Last changed under 21 days before the snapshot.');
    expect(textOf(legend, 'stale')).toBe('Moss creeping up, more with age. Last changed 21–45 days before the snapshot.');
    expect(textOf(legend, 'ancient')).toBe('Leaning and heavily overgrown. Last changed over 45 days before the snapshot.');
    expect(textOf(legend, 'unused')).toBe('Cracks and a faint red glow, and RIP carved on it. Nothing imports it (Knip).');
    expect(textOf(legend, 'hot')).toBe('A lit candle at its foot. 5+ commits in the 30 days before the snapshot.');
    expect(textOf(legend, 'ghost')).toBe("A translucent floating figure; its tag shows the deleted file's type. Deleted files.");
    expect(textOf(legend, 'floor')).toBe('A folder nested deeper.');
  });

  it('says that age and usage are independent, in the Age group', () => {
    expect(legend.groups[0]!.note).toContain('a fresh file can be unused');
  });

  it('says which day the ages are measured from', () => {
    expect(legend.snapshotLine).toBe('Ages are measured from the snapshot: 2026-08-18.');
  });
});

describe('buildLegend with other thresholds', () => {
  it('uses the thresholds of the data file, with the default values 90 / 360 / 5 in 30', () => {
    const legend = buildLegend(metaWith(DEFAULT_THRESHOLDS));
    expect(textOf(legend, 'fresh')).toContain('under 90 days');
    expect(textOf(legend, 'stale')).toContain('90–360 days');
    expect(textOf(legend, 'ancient')).toContain('over 360 days');
  });

  it('uses the spatialql thresholds, 14 / 30', () => {
    const legend = buildLegend(metaWith(makeThresholds(14, 16, 5, 30)));
    expect(textOf(legend, 'fresh')).toContain('under 14 days');
    expect(textOf(legend, 'ancient')).toContain('over 30 days');
  });

  it('reads correctly in the singular', () => {
    const legend = buildLegend(metaWith(makeThresholds(1, 1, 1, 1)));
    expect(textOf(legend, 'fresh')).toContain('under 1 day before');
    expect(textOf(legend, 'hot')).toContain('1+ commit in the 1 day before the snapshot.');
  });

  it('shows the snapshot day of the data file, and only the day', () => {
    expect(buildLegend(metaWith(SYNTHETIC_THRESHOLDS, '2026-10-18T22:37:25.000Z')).snapshotLine).toContain('2026-10-18');
    expect(snapshotDay(metaWith(SYNTHETIC_THRESHOLDS, '2026-10-18T22:37:25.000Z'))).toBe('2026-10-18');
  });

  it.each(REAL_GRAVEYARDS)('reads the real thresholds of %s', (name) => {
    const g = loadRealGraveyard(name);
    const legend = buildLegend(g.meta);
    expect(textOf(legend, 'fresh')).toContain(`under ${g.meta.thresholds.staleAfterDays} days`);
    expect(textOf(legend, 'ancient')).toContain(`over ${g.meta.thresholds.ancientAfterDays} days`);
  });
});

describe('P11: the legend says the real numbers', () => {
  const numbers = (text: string, pattern: RegExp): number[] => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`"${text}" does not match ${pattern}`);
    return match.slice(1).map(Number);
  };

  it('gives every threshold number in the entry that explains it', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const legend = buildLegend(metaWith(t));
        const [fresh] = numbers(textOf(legend, 'fresh'), /under ([\d,]+) days?/);
        const [s0, s1] = numbers(textOf(legend, 'stale'), /([\d,]+)–([\d,]+) days?/);
        const [ancient] = numbers(textOf(legend, 'ancient'), /over ([\d,]+) days?/);
        const [commits, window] = numbers(textOf(legend, 'hot'), /([\d,]+)\+ commits? in the ([\d,]+) days?/);
        return fresh === t.staleAfterDays && s0 === t.staleAfterDays && s1 === t.ancientAfterDays && ancient === t.ancientAfterDays && commits === t.hotCommits && window === t.hotWindowDays;
      }),
    );
  });

  it('has exactly the seven entries, each once, each with words', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const entries = legendEntries(buildLegend(metaWith(t)));
        const ids = entries.map((e) => e.id);
        return ids.length === 7 && new Set(ids).size === 7 && entries.every((e) => e.title.trim().length > 0 && e.text.trim().length > 0);
      }),
    );
  });

  it('has the ground-tint entry, which says darker ground means a deeper folder', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const floor = entryOf(buildLegend(metaWith(t)), 'floor');
        return /Darker ground/.test(floor.title) && /nested deeper/.test(floor.text);
      }),
    );
  });

  it('changes only the words that carry a number when the thresholds change', () => {
    fc.assert(
      fc.property(thresholdsArb, thresholdsArb, (a, b) => {
        const first = legendEntries(buildLegend(metaWith(a)));
        const second = legendEntries(buildLegend(metaWith(b)));
        const unchanged: LegendId[] = ['unused', 'ghost', 'floor'];
        return (
          unchanged.every((id) => JSON.stringify(first.find((e) => e.id === id)) === JSON.stringify(second.find((e) => e.id === id))) &&
          first.every((e, i) => e.id === second[i]!.id && e.title === second[i]!.title)
        );
      }),
    );
  });

  it('is the same every time', () => {
    fc.assert(fc.property(thresholdsArb, (t) => JSON.stringify(buildLegend(metaWith(t))) === JSON.stringify(buildLegend(metaWith(t)))));
  });
});
