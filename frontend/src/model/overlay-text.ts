import type { RepoMeta } from '@shared/graveyard-schema';
import { snapshotDay } from './legend';
import type { Stats } from './stats';

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
  label: string;
  value: number;
  /** A few words under the label, where the number could be misread. */
  hint?: string;
}

/** The rows in the order they are shown. Fresh, stale and ancient add up to the files; unused and hot do not. */
export function statsRows(stats: Stats): StatsRow[] {
  return [
    { id: 'files', label: 'Files', value: stats.files },
    { id: 'folders', label: 'Folders', value: stats.folders },
    { id: 'fresh', label: 'Fresh', value: stats.fresh },
    { id: 'stale', label: 'Stale', value: stats.stale },
    { id: 'ancient', label: 'Ancient', value: stats.ancient },
    { id: 'unused', label: 'Unused', value: stats.unused, hint: 'of any age' },
    { id: 'hot', label: 'Hot', value: stats.hot, hint: 'of any age' },
    { id: 'ghosts', label: 'Ghosts', value: stats.ghosts, hint: 'deleted files' },
  ];
}
