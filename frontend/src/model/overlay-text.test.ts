import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { SHORT_SHA_LENGTH, shortSha, statsHeading, statsRows } from './overlay-text';
import { computeStats, type Stats } from './stats';

const STATS_KEYS: ReadonlyArray<keyof Stats> = ['files', 'folders', 'ghosts', 'fresh', 'stale', 'ancient', 'unused', 'hot'];

describe('shortSha', () => {
  it('keeps the first 7 characters of a full SHA', () => {
    expect(SHORT_SHA_LENGTH).toBe(7);
    expect(shortSha('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
  });

  it('leaves a shorter value whole, and copes with an empty one', () => {
    expect(shortSha('abc')).toBe('abc');
    expect(shortSha('')).toBe('');
  });
});

describe('statsHeading', () => {
  it.each(REAL_GRAVEYARDS)('%s: names the repository, the snapshot day and the short SHA', (name) => {
    const { meta } = loadRealGraveyard(name);
    const heading = statsHeading(meta);
    expect(heading.name).toBe(meta.name);
    expect(heading.detail).toBe(`snapshot ${meta.snapshotDate.slice(0, 10)} · ${meta.snapshotSha.slice(0, 7)}`);
    expect(heading.detail).toMatch(/^snapshot \d{4}-\d{2}-\d{2} · [0-9a-f]{7}$/);
  });

  it('passes a name with markup through as plain text, unchanged', () => {
    const g = graveyardFrom({});
    expect(statsHeading({ ...g.meta, name: '<script>x</script>' }).name).toBe('<script>x</script>');
  });
});

describe('statsRows', () => {
  it('has one row for each statistic, in a fixed order, with a distinct label', () => {
    const rows = statsRows(computeStats(graveyardFrom({})));
    expect(rows.map((r) => r.id)).toEqual(['files', 'folders', 'fresh', 'stale', 'ancient', 'unused', 'hot', 'ghosts']);
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
    expect([...rows.map((r) => r.id)].sort()).toEqual([...STATS_KEYS].sort());
  });

  it.each(REAL_GRAVEYARDS)('%s: shows the counts of the data file', (name) => {
    const g = loadRealGraveyard(name);
    const rows = statsRows(computeStats(g));
    const value = (id: keyof Stats): number => rows.find((r) => r.id === id)!.value;
    expect(value('files')).toBe(g.files.length);
    expect(value('folders')).toBe(g.folders.length);
    expect(value('ghosts')).toBe(g.ghosts.length);
    expect(value('fresh') + value('stale') + value('ancient')).toBe(g.files.length);
  });

  it('shows exactly the numbers it is given, and fresh, stale and ancient add up to the files, for any graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const stats = computeStats(g);
        const rows = statsRows(stats);
        const value = (id: keyof Stats): number => rows.find((r) => r.id === id)!.value;
        return (
          STATS_KEYS.every((k) => value(k) === stats[k]) &&
          value('fresh') + value('stale') + value('ancient') === value('files') &&
          value('unused') <= value('files') &&
          value('hot') <= value('files')
        );
      }),
      { numRuns: 60 },
    );
  });
});
