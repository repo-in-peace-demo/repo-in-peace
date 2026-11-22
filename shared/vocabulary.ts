import type { FileEntry, Thresholds } from './graveyard-schema.js';

/**
 * The one vocabulary of Repo In Peace: the names and rules for a grave's states, flags and ghosts, the same everywhere. The frontend's
 * stats panel, legend, list, hover line and detail panel use it (through `frontend/src/model/grave-facts.ts`), and the analyser
 * describes a grave in these words to the model that writes its eulogy. Four dimensions, always in this order: Age (Fresh, Stale,
 * Ancient: when it last changed, before the snapshot), Usage (Unused), Activity (Hot), History (Ghosts). A file's age and its usage
 * are independent. Pure.
 */

/** A fact a grave can show: its age state, a flag, or being a ghost. */
export type FactId = 'fresh' | 'stale' | 'ancient' | 'unused' | 'hot' | 'ghost';

/** Its name, everywhere: states Fresh, Stale, Ancient; flags Unused, Hot; deleted files Ghosts (one is a Ghost). */
export const FACT_NAMES: Record<FactId, string> = { fresh: 'Fresh', stale: 'Stale', ancient: 'Ancient', unused: 'Unused', hot: 'Hot', ghost: 'Ghosts' };
/** The name of one: "Ghost" for a single deleted file, the same names otherwise. */
export const factNameOne = (id: FactId): string => (id === 'ghost' ? 'Ghost' : FACT_NAMES[id]);

export type GroupId = 'age' | 'usage' | 'activity' | 'history';

export interface FactGroup {
  id: GroupId;
  title: string;
  /** What the dimension is, in a few words. */
  about: string;
  facts: readonly FactId[];
}

export const FACT_GROUPS: readonly FactGroup[] = [
  { id: 'age', title: 'Age', about: 'last change before the snapshot', facts: ['fresh', 'stale', 'ancient'] },
  { id: 'usage', title: 'Usage', about: 'whether anything imports the file', facts: ['unused'] },
  { id: 'activity', title: 'Activity', about: 'recent commits', facts: ['hot'] },
  { id: 'history', title: 'History', about: 'files no longer in the repository', facts: ['ghost'] },
];

/** The note that age and usage are separate dimensions. */
/** What a used file is, the counterpart of the Unused rule: the detail panel's Usage row for a file that is not unused. */
export const USED_RULE = 'imported by other files in the project';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A calendar day in UTC: "Jun 13", or "Jun 13, 2025" when the year is not the snapshot's. Shared so the panel and the PR text agree. */
export function calendarDay(iso: string, snapshotIso: string): string {
  const d = new Date(iso);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(snapshotIso).getUTCFullYear() ? day : `${day}, ${d.getUTCFullYear()}`;
}

export const INDEPENDENCE_NOTE = "A file's age and its usage are independent: a fresh file can be unused.";

/** "1 day", "21 days" (and "1 commit", "5 commits"). */
const n = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/**
 * The rule for a fact, from the data file's thresholds, in the same words everywhere: "under 21 days", "21–45 days", "over 45 days",
 * "nothing in the project imports it (Knip)", "5+ commits in the 30 days before the snapshot", "deleted files". The analyser's rule: fresh under
 * `staleAfterDays`, stale from it up to and including `ancientAfterDays`, ancient above that.
 */
export function factRule(id: FactId, t: Thresholds): string {
  switch (id) {
    case 'fresh':
      return `under ${n(t.staleAfterDays, 'day', 'days')}`;
    case 'stale':
      return `${t.staleAfterDays.toLocaleString('en-US')}–${n(t.ancientAfterDays, 'day', 'days')}`;
    case 'ancient':
      return `over ${n(t.ancientAfterDays, 'day', 'days')}`;
    case 'unused':
      return 'nothing in the project imports it (Knip)';
    case 'hot':
      return `${t.hotCommits.toLocaleString('en-US')}+ ${t.hotCommits === 1 ? 'commit' : 'commits'} in the ${n(t.hotWindowDays, 'day', 'days')} before the snapshot`;
    case 'ghost':
      return 'deleted files';
  }
}

/** The rule as a sentence: "Last changed 21–45 days before the snapshot." for an age; "Nothing imports it (Knip)." and so on. */
export function factRuleSentence(id: FactId, t: Thresholds): string {
  const rule = factRule(id, t);
  if (id === 'fresh' || id === 'stale' || id === 'ancient') return `Last changed ${rule} before the snapshot.`;
  return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}.`;
}

/** The facts a file has: its age state, then its flags, in the vocabulary's order. */
export function factsOf(file: Pick<FileEntry, 'decayState' | 'unused' | 'hot'>): FactId[] {
  return [file.decayState, ...(file.unused ? (['unused'] as const) : []), ...(file.hot ? (['hot'] as const) : [])];
}
