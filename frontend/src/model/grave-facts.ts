import type { FileEntry, Ghost, RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { ageDays } from './age';
import { ghostTagText } from './ghost-tag';

/**
 * The words about a grave, shared by the detail panel and the hover label so the two never disagree (interface spec, Req 4.3 to
 * 4.9 and 4b). Pure. Ages are measured to the data file's snapshot, never to today; dates are calendar days in UTC, with fixed
 * English month names, so the words do not depend on the viewer's time zone or language settings.
 */

// ---- The one vocabulary (interface spec, "one vocabulary, grouped by dimension") ----
//
// Every user-facing name and rule for a state, a flag and a ghost comes from here: the stats panel, the legend, the list's tags,
// the hover line and the detail panel. Four dimensions, always in this order: Age (Fresh, Stale, Ancient: when it last changed,
// before the snapshot), Usage (Unused), Activity (Hot), History (Ghosts). A file's age and its usage are independent.

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
export const INDEPENDENCE_NOTE = "A file's age and its usage are independent: a fresh file can be unused.";

/** "1 day", "21 days" (and "1 commit", "5 commits"). */
const n = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/**
 * The rule for a fact, from the data file's thresholds, in the same words everywhere: "under 21 days", "21–45 days", "over 45 days",
 * "nothing imports it (Knip)", "5+ commits in the 30 days before the snapshot", "deleted files". The analyser's rule: fresh under
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
      return 'nothing imports it (Knip)';
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

/** How each fact looks in the scene, for the legend. */
export const FACT_LOOKS: Record<FactId, string> = {
  fresh: 'a clean, upright stone',
  stale: 'moss creeping up, more with age',
  ancient: 'leaning and heavily overgrown',
  unused: 'cracks and a faint red glow, and RIP carved on it',
  hot: 'a lit candle at its foot',
  ghost: "a translucent floating figure; its tag shows the deleted file's type",
};

/** The facts a file has: its age state, then its flags, in the vocabulary's order. */
export function factsOf(file: Pick<FileEntry, 'decayState' | 'unused' | 'hot'>): FactId[] {
  return [file.decayState, ...(file.unused ? (['unused'] as const) : []), ...(file.hot ? (['hot'] as const) : [])];
}

export type StateName = 'Fresh' | 'Stale' | 'Ancient';

const STATE_NAMES: Record<FileEntry['decayState'], StateName> = { fresh: 'Fresh', stale: 'Stale', ancient: 'Ancient' }; // = FACT_NAMES
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const stateName = (file: FileEntry): StateName => STATE_NAMES[file.decayState];

/**
 * The age in a sentence, from the file's state, its age and the data file's thresholds, with the state's rule:
 *   "Stale: last changed 30 days before the snapshot (Stale is 21–45 days)"
 */
export function stateSentence(file: FileEntry, meta: RepoMeta): string {
  const days = count(ageDays(file.lastCommitDate, meta.snapshotDate), 'day', 'days');
  return `${stateName(file)}: last changed ${days} before the snapshot (${stateName(file)} is ${factRule(file.decayState, meta.thresholds)})`;
}

/** A calendar day in UTC: "Jun 13", or "Jun 13, 2025" when the year is not the snapshot's. */
export function calendarDay(iso: string, snapshotIso: string): string {
  const d = new Date(iso);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(snapshotIso).getUTCFullYear() ? day : `${day}, ${d.getUTCFullYear()}`;
}

export const linesText = (n: number): string => count(n, 'line', 'lines');

/** "Hot (7 commits)" for a hot file, null otherwise. */
export const hotText = (file: FileEntry): string | null => (file.hot ? `${FACT_NAMES.hot} (${count(file.recentCommits, 'commit', 'commits')})` : null);

/** The detail panel's Activity row: "Hot: 7 commits in the 30 days before the snapshot", or "Not hot: 1 commit in the 30 days before the snapshot (Hot is 5+)". */
export function hotDetail(file: FileEntry, meta: RepoMeta): string {
  const commits = `${count(file.recentCommits, 'commit', 'commits')} in the ${count(meta.thresholds.hotWindowDays, 'day', 'days')} before the snapshot`;
  return file.hot ? `${FACT_NAMES.hot}: ${commits}` : `Not hot: ${commits} (${FACT_NAMES.hot} is ${meta.thresholds.hotCommits.toLocaleString('en-US')}+)`;
}

/** The detail panel's Usage row. */
export const usageDetail = (file: FileEntry, meta: RepoMeta): string => (file.unused ? `${FACT_NAMES.unused}: ${factRule('unused', meta.thresholds)}` : 'Used: something imports it');

/** A deleted file's type, as on its toe tag: ".ts", or "·" for a file with no extension. */
export const fileType = (path: string): string => ghostTagText(path);

/** The hover line of a stone: "Ancient · last changed Jun 13 · 26 lines · Unused · Hot (7 commits)", with only the flags that apply. */
export function stoneSummary(file: FileEntry, meta: RepoMeta): string {
  const parts = [stateName(file), `last changed ${calendarDay(file.lastCommitDate, meta.snapshotDate)}`, linesText(file.linesOfCode)];
  if (file.unused) parts.push(FACT_NAMES.unused);
  const hot = hotText(file);
  if (hot !== null) parts.push(hot);
  return parts.join(' · ');
}

/** The hover line of a ghost: "Ghost · deleted Oct 12 · .ts". */
export const ghostSummary = (ghost: Ghost, meta: RepoMeta): string => `${factNameOne('ghost')} · deleted ${calendarDay(ghost.deletedDate, meta.snapshotDate)} · ${fileType(ghost.path)}`;

/** Bury is offered on unused stones only, whatever their age (Decision 5): old but used code is stable, not dead. */
export const buryOffered = (file: FileEntry): boolean => file.unused;

const ELLIPSIS = '…';

/**
 * A path shortened in the middle of its folder part to at most `maxChars` characters (code points), keeping the file name whole:
 * `app/components/…/ui/index.ts`. A path that fits is unchanged. When the name alone leaves no room for a folder, the result is
 * `…/` and the name, which can be longer than `maxChars`; the name is never cut.
 */
export function shortenPath(path: string, maxChars: number): string {
  const chars = Array.from(path);
  if (chars.length <= maxChars) return path;
  const cut = path.lastIndexOf('/');
  if (cut < 0) return path; // no folder to shorten
  const name = Array.from(path.slice(cut + 1));
  const folder = Array.from(path.slice(0, cut));
  const room = maxChars - name.length - 1 - 1; // the "/" before the name and the ellipsis
  if (room < 2) return `${ELLIPSIS}/${name.join('')}`;
  const head = Math.ceil(room / 2);
  const tail = room - head;
  return `${folder.slice(0, head).join('')}${ELLIPSIS}${tail > 0 ? folder.slice(folder.length - tail).join('') : ''}/${name.join('')}`;
}
