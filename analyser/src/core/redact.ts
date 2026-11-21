import type { People } from './history';

/**
 * Keeping the repository's people out of what the model sees (eulogies spec, Req 3.3) and out of what it writes (Req 4.5). Pure.
 * A person is known by their name, their e-mail address, and the handle in it (the part before the `@`; for GitHub's
 * `12345+alice@users.noreply.github.com` it is `alice`).
 */

/** What every mention of a person, and every e-mail address, is replaced with. */
export const SOMEONE = 'someone';

/** Words shorter than this are not treated as a person (a one-letter name would match "a"). */
const MIN_WORD = 2;
/** Handles that are not a person. */
const NOT_A_HANDLE = new Set(['noreply', 'no-reply', 'git', 'root', 'admin', 'bot', 'github', 'users']);

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

/** The handle in an e-mail address, or null. */
export function handleOf(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  const handle = local.includes('+') ? local.slice(local.lastIndexOf('+') + 1) : local;
  if (handle.length < 3 || /^\d+$/.test(handle) || NOT_A_HANDLE.has(handle.toLowerCase())) return null;
  return handle;
}

/** Every word or phrase that names a person of the repository: names, e-mails and handles, longest first. */
export function personWords(people: People): string[] {
  const words = new Set<string>();
  for (const name of people.names) if (name.trim().length >= MIN_WORD) words.add(name.trim());
  for (const email of people.emails) {
    if (email.trim().length >= MIN_WORD) words.add(email.trim());
    const handle = handleOf(email.trim());
    if (handle !== null) words.add(handle);
  }
  return [...words].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A pattern that finds any of the words as a whole word, in any case. */
export function personPattern(words: readonly string[]): RegExp | null {
  if (words.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

/** The text with every e-mail address and every mention of a person replaced by "someone". */
export function redact(text: string, people: People): string {
  let out = text.replace(EMAIL, SOMEONE);
  const pattern = personPattern(personWords(people));
  if (pattern !== null) out = out.replace(pattern, SOMEONE);
  return out;
}

/** True when the text mentions a person of the repository (or contains any e-mail address). */
export function mentionsPerson(text: string, people: People): boolean {
  EMAIL.lastIndex = 0;
  if (EMAIL.test(text)) return true;
  const pattern = personPattern(personWords(people));
  return pattern !== null && pattern.test(text);
}
