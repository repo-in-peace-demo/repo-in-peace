/**
 * The pull request's title, body and commit message (bury-and-resurrect Req 2.3, 3.3, 5.3), built on the server from the demo's data
 * file only. They notify nobody: every `@` and every `#` before a digit from the data is followed by a word joiner (U+2060), so GitHub
 * makes no mention, team mention or cross-reference; paths and SHAs are in code spans, where GitHub parses neither. Pure.
 */
import type { RepoMeta } from '../../../shared/graveyard-schema.js';
import { FACT_NAMES, calendarDay, factRule } from '../../../shared/vocabulary.js';
import type { Eligible } from './check.js';

const WORD_JOINER = '\u2060';
export const OPENED_BY = 'Opened by Repo In Peace from the demo graveyard.';

/** Breaks every `@mention` and `#123` reference: the text reads the same, but GitHub links and notifies nothing. */
export const neutralise = (text: string): string => text.replace(/@/g, `@${WORD_JOINER}`).replace(/#(?=\d)/g, `#${WORD_JOINER}`);

/** A code span that holds any text exactly: a fence longer than any run of backticks inside, padded when the text starts or ends with one. */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') || text.endsWith(' ') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Plain text in Markdown: its own Markdown escaped, then neutralised, and on one line. */
export const plain = (text: string): string => neutralise(text.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>|~!#]/g, '\\$&'));

const short = (sha: string): string => sha.slice(0, 7);
const snapshotDay = (meta: RepoMeta): string => meta.snapshotDate.slice(0, 10); // ISO 8601 UTC, as the legend shows it

export function prTitle(eligible: Eligible): string {
  return eligible.action === 'bury' ? `RIP ${neutralise(eligible.file.path)}` : `Resurrect ${neutralise(eligible.ghost.path)}`;
}

export function commitMessage(eligible: Eligible): string {
  return `${prTitle(eligible)}\n\n${OPENED_BY}`;
}

const quote = (eulogy: string | undefined): string[] => (eulogy !== undefined && eulogy.trim() !== '' ? [`> ${plain(eulogy)}`, ''] : []);

export function prBody(eligible: Eligible, meta: RepoMeta): string {
  if (eligible.action === 'bury') {
    const { file } = eligible;
    const state = file.decayState;
    return [
      ...quote(file.eulogy),
      `**Why it was flagged** (snapshot ${snapshotDay(meta)}, ${codeSpan(short(meta.snapshotSha))})`,
      `- ${FACT_NAMES.unused}: ${factRule('unused', meta.thresholds)}.`,
      `- ${FACT_NAMES[state]}: last changed ${calendarDay(file.lastCommitDate, meta.snapshotDate)}, ${factRule(state, meta.thresholds)} before the snapshot.`,
      '',
      `This pull request deletes ${codeSpan(file.path)} and nothing else.`,
      '',
      OPENED_BY,
    ].join('\n');
  }
  const { ghost } = eligible;
  return [
    ...quote(ghost.eulogy),
    // The deleter's name as plain text: never an @mention, so nobody is notified (Req 3.3).
    `**Deleted** ${calendarDay(ghost.deletedDate, meta.snapshotDate)} by ${plain(ghost.deletedBy)} in ${codeSpan(short(ghost.deletedInSha))}.`,
    `This pull request restores ${codeSpan(ghost.path)} exactly as it was at ${codeSpan(short(ghost.lastExistingSha))}, its last commit before deletion, and nothing else.`,
    '',
    OPENED_BY,
  ].join('\n');
}
