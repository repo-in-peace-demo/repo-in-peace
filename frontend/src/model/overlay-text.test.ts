import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { graveyardFrom } from '../../test/make-graveyard';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { SHORT_SHA_LENGTH, shortSha, statsHeading, statsLayout, statsRows } from './overlay-text';
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
  it('has files and folders at the top, then the groups Age, Usage, Activity, History, each row with its rule', () => {
    const g = graveyardFrom({});
    const layout = statsLayout(computeStats(g), g.meta);
    expect(layout.top.map((r) => r.id)).toEqual(['files', 'folders']);
    expect(layout.groups.map((gr) => gr.title)).toEqual(['Age', 'Usage', 'Activity', 'History']);
    expect(layout.groups.map((gr) => gr.rows.map((r) => r.label))).toEqual([['Fresh', 'Stale', 'Ancient'], ['Unused'], ['Hot'], ['Ghosts']]);
    expect(layout.groups.every((gr) => gr.rows.every((r) => (r.rule ?? '').length > 0))).toBe(true);
    const rows = statsRows(computeStats(g), g.meta);
    expect(rows.map((r) => r.id)).toEqual(['files', 'folders', 'fresh', 'stale', 'ancient', 'unused', 'hot', 'ghosts']);
    expect([...rows.map((r) => r.id)].sort()).toEqual([...STATS_KEYS].sort());
  });

  it('gives the oikos thresholds as the rules: under 21, 21–45, over 45 days, 5+ commits in 30 days', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const rule = (id: keyof Stats) => statsRows(computeStats(g), g.meta).find((r) => r.id === id)!.rule;
    expect([rule('fresh'), rule('stale'), rule('ancient'), rule('unused'), rule('hot'), rule('ghosts')]).toEqual([
      'under 21 days',
      '21–45 days',
      'over 45 days',
      'nothing imports it (Knip)',
      '5+ commits in the 30 days before the snapshot',
      'deleted files',
    ]);
  });

  it.each(REAL_GRAVEYARDS)('%s: shows the counts of the data file', (name) => {
    const g = loadRealGraveyard(name);
    const rows = statsRows(computeStats(g), g.meta);
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
        const rows = statsRows(stats, g.meta);
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
