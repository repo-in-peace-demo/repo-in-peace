import type { FileEntry, Ghost, RepoMeta } from '@shared/graveyard-schema';
import { ageDays } from './age';
import { ghostTagText } from './ghost-tag';

/**
 * The words about a grave, shared by the detail panel and the hover label so the two never disagree (interface spec, Req 4.3 to
 * 4.9 and 4b). Pure. Ages are measured to the data file's snapshot, never to today; dates are calendar days in UTC, with fixed
 * English month names, so the words do not depend on the viewer's time zone or language settings.
 */

export type StateName = 'Fresh' | 'Stale' | 'Ancient';

const STATE_NAMES: Record<FileEntry['decayState'], StateName> = { fresh: 'Fresh', stale: 'Stale', ancient: 'Ancient' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const stateName = (file: FileEntry): StateName => STATE_NAMES[file.decayState];

/**
 * The state in a sentence, from the file's state, its age and the data file's thresholds. The analyser's rule: fresh under
 * `staleAfterDays`, stale from it up to and including `ancientAfterDays`, ancient above that.
 *   "Fresh: last touched 3 days before the snapshot"
 *   "Stale: untouched 30 days before the snapshot (stale from 21 days)"
 *   "Ancient: untouched 65 days before the snapshot (ancient after 45 days)"
 */
export function stateSentence(file: FileEntry, meta: RepoMeta): string {
  const days = count(ageDays(file.lastCommitDate, meta.snapshotDate), 'day', 'days');
  const t = meta.thresholds;
  switch (file.decayState) {
    case 'fresh':
      return `Fresh: last touched ${days} before the snapshot`;
    case 'stale':
      return `Stale: untouched ${days} before the snapshot (stale from ${count(t.staleAfterDays, 'day', 'days')})`;
    case 'ancient':
      return `Ancient: untouched ${days} before the snapshot (ancient after ${count(t.ancientAfterDays, 'day', 'days')})`;
  }
}

/** A calendar day in UTC: "Jun 13", or "Jun 13, 2025" when the year is not the snapshot's. */
export function calendarDay(iso: string, snapshotIso: string): string {
  const d = new Date(iso);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(snapshotIso).getUTCFullYear() ? day : `${day}, ${d.getUTCFullYear()}`;
}

export const linesText = (n: number): string => count(n, 'line', 'lines');

/** "hot (7 commits)" for a hot file, null otherwise. */
export const hotText = (file: FileEntry): string | null => (file.hot ? `hot (${count(file.recentCommits, 'commit', 'commits')})` : null);

/** The detail panel's Hot row: "yes, 7 commits in the last 30 days" or "no, 1 commit in the last 30 days". */
export function hotDetail(file: FileEntry, meta: RepoMeta): string {
  return `${file.hot ? 'yes' : 'no'}, ${count(file.recentCommits, 'commit', 'commits')} in the last ${count(meta.thresholds.hotWindowDays, 'day', 'days')}`;
}

/** A deleted file's type, as on its toe tag: ".ts", or "·" for a file with no extension. */
export const fileType = (path: string): string => ghostTagText(path);

/** The hover line of a stone: "Ancient · last commit Jun 13 · 26 lines · unused · hot (7 commits)", with only the flags that apply. */
export function stoneSummary(file: FileEntry, meta: RepoMeta): string {
  const parts = [stateName(file), `last commit ${calendarDay(file.lastCommitDate, meta.snapshotDate)}`, linesText(file.linesOfCode)];
  if (file.unused) parts.push('unused');
  const hot = hotText(file);
  if (hot !== null) parts.push(hot);
  return parts.join(' · ');
}

/** The hover line of a ghost: "Ghost · deleted Oct 12 · .ts". */
export const ghostSummary = (ghost: Ghost, meta: RepoMeta): string => `Ghost · deleted ${calendarDay(ghost.deletedDate, meta.snapshotDate)} · ${fileType(ghost.path)}`;

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
