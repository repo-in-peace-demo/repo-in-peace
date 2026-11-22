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
// The names and rules live in `shared/vocabulary.ts`, so the analyser uses the same words; they are re-exported here unchanged.
export {
  FACT_GROUPS,
  FACT_NAMES,
  INDEPENDENCE_NOTE,
  USED_RULE,
  factNameOne,
  factRule,
  factRuleSentence,
  factsOf,
  type FactGroup,
  type FactId,
  type GroupId,
} from '@shared/vocabulary';
import { FACT_NAMES, USED_RULE, factNameOne, factRule, type FactId } from '@shared/vocabulary';

/** How each fact looks in the scene, for the legend. */
export const FACT_LOOKS: Record<FactId, string> = {
  fresh: 'a clean, upright stone',
  stale: 'moss creeping up, more with age',
  ancient: 'leaning and heavily overgrown',
  unused: 'cracks and a faint red glow, and RIP carved on it',
  hot: 'a lit candle at its foot',
  ghost: "a translucent floating figure; its tag shows the deleted file's type",
};

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
export const usageDetail = (file: FileEntry, meta: RepoMeta): string => (file.unused ? `${FACT_NAMES.unused}: ${factRule('unused', meta.thresholds)}` : `Used: ${USED_RULE}`);

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
