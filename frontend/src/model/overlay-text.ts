import type { RepoMeta } from '@shared/graveyard-schema';
import { snapshotDay } from './legend';
import type { Stats } from './stats';
import { FACT_GROUPS, FACT_NAMES, factRule, type FactId, type GroupId } from './grave-facts';

/**
 * The words and numbers of the statistics panel. Pure, so a test can check them without a page. The panel only
 * puts them on the screen as text, so a repository named `<script>` is shown as that text.
 */

/** How many characters of the snapshot commit's SHA are shown. */
export const SHORT_SHA_LENGTH = 7;

export const shortSha = (sha: string): string => sha.slice(0, SHORT_SHA_LENGTH);

export interface StatsHeading {
  /** The repository's name. */
  name: string;
  /** The snapshot's day and short SHA. */
  detail: string;
}

export function statsHeading(meta: RepoMeta): StatsHeading {
  return { name: meta.name, detail: `snapshot ${snapshotDay(meta)} · ${shortSha(meta.snapshotSha)}` };
}

export interface StatsRow {
  id: keyof Stats;
  /** The fact's name, from the one vocabulary. */
  label: string;
  value: number;
  /** The rule beside the name, from the data file's thresholds: "21–45 days". */
  rule?: string;
}

export interface StatsGroup {
  id: GroupId;
  /** "Age", "Usage", "Activity", "History", in that order. */
  title: string;
  /** What the dimension is: "last change before the snapshot". */
  about: string;
  rows: StatsRow[];
}

export interface StatsLayout {
  /** Files and folders, at the top. */
  top: StatsRow[];
  /** The same groups, in the same order, as the legend. */
  groups: StatsGroup[];
}

const STAT_OF: Record<FactId, keyof Stats> = { fresh: 'fresh', stale: 'stale', ancient: 'ancient', unused: 'unused', hot: 'hot', ghost: 'ghosts' };

/**
 * The stats panel: files and folders, then one group per dimension (Age, Usage, Activity, History), each row its name, its rule and
 * its count. Fresh, stale and ancient add up to the files; unused and hot are counted among all files, of any age.
 */
export function statsLayout(stats: Stats, meta: RepoMeta): StatsLayout {
  return {
    top: [
      { id: 'files', label: 'Files', value: stats.files },
      { id: 'folders', label: 'Folders', value: stats.folders },
    ],
    groups: FACT_GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      about: group.about,
      rows: group.facts.map((fact) => ({ id: STAT_OF[fact], label: FACT_NAMES[fact], value: stats[STAT_OF[fact]], rule: factRule(fact, meta.thresholds) })),
    })),
  };
}

/** Every row, in the order shown. */
export const statsRows = (stats: Stats, meta: RepoMeta): StatsRow[] => {
  const layout = statsLayout(stats, meta);
  return [...layout.top, ...layout.groups.flatMap((g) => g.rows)];
};
