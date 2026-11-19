import type { RepoMeta } from '@shared/graveyard-schema';

/**
 * The words of the legend. Built from the data file's own thresholds, so a viewer sees the real numbers
 * ("moss: untouched 21 or more days"), never assumed defaults. Pure: a change of thresholds changes the words
 * of the entries that carry a number, and nothing else.
 */

export type LegendId = 'fresh' | 'moss' | 'ancient' | 'unused' | 'hot' | 'ghost' | 'floor';

export interface LegendEntry {
  id: LegendId;
  /** A few words naming the look. */
  title: string;
  /** What it means, in a sentence. */
  text: string;
}

export interface Legend {
  /** The day every age is measured from, as a sentence. */
  snapshotLine: string;
  entries: LegendEntry[];
}

/** "1 day", "21 days". */
const days = (n: number): string => (n === 1 ? '1 day' : `${n} days`);

/** The snapshot's day as YYYY-MM-DD, from the ISO date of the data file. */
export function snapshotDay(meta: RepoMeta): string {
  return meta.snapshotDate.slice(0, 10);
}

export function buildLegend(meta: RepoMeta): Legend {
  const t = meta.thresholds;
  return {
    snapshotLine: `Ages are measured from the snapshot: ${snapshotDay(meta)}.`,
    entries: [
      {
        id: 'fresh',
        title: 'Clean, upright stone',
        text: `Last commit under ${days(t.staleAfterDays)} before the snapshot.`,
      },
      {
        id: 'moss',
        title: 'Moss',
        text: `Untouched ${t.staleAfterDays} or more days. More moss the longer it has been untouched.`,
      },
      {
        id: 'ancient',
        title: 'Leaning, heavily overgrown',
        text: `Untouched more than ${days(t.ancientAfterDays)}.`,
      },
      {
        id: 'unused',
        title: 'Cracks and a faint red glow',
        text: 'Knip reports the file unused. This can happen with any of the above.',
      },
      {
        id: 'hot',
        title: 'Lit candle',
        text: `${t.hotCommits} or more commits in the ${days(t.hotWindowDays)} before the snapshot.`,
      },
      {
        id: 'ghost',
        title: 'Translucent floating figure',
        text: "A file that was deleted. Its tag shows the deleted file's type.",
      },
      {
        id: 'floor',
        title: 'Darker ground',
        text: 'A folder nested deeper.',
      },
    ],
  };
}
