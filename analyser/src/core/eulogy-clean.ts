import type { People } from './history';
import { mentionsPerson } from './redact';
import { EULOGY_MAX_CHARS } from './eulogy-prompt';

/**
 * Cleaning and checking a model's answer (eulogies spec, Req 4.4 to 4.6). Pure. In this order:
 *   1. any reasoning block the model wrote (`<think>…</think>`, `<thinking>…`) is removed;
 *   2. the text left is checked: anything code-like, a URL, a secret-like string, an e-mail or a person of the repository rejects it
 *      (before cleaning, so removing markdown cannot hide code);
 *   3. it is cleaned: markdown, emoji, a label and wrapping quotes go, whitespace becomes single spaces, and it is cut to two sentences
 *      and the length limit.
 * Strict on purpose: a harmless eulogy that looks like code is rejected (and retried once) rather than risk a leak.
 */

export type RejectReason = 'empty' | 'code' | 'url' | 'secret' | 'email' | 'author';
export type Cleaned = { ok: true; text: string } | { ok: false; reason: RejectReason };

// ---- 1. Reasoning blocks ----

const THINK_BLOCK = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const THINK_OPEN = /<(think|thinking)\b[^>]*>/i;
const THINK_CLOSE = /<\/(think|thinking)\s*>/gi;

/** The answer without any reasoning block: closed blocks go; an unclosed opening tag takes everything after it; a stray closing tag everything before it. */
export function stripReasoning(raw: string): string {
  let text = raw.replace(THINK_BLOCK, ' ');
  const closes = [...text.matchAll(THINK_CLOSE)];
  if (closes.length > 0) {
    const last = closes[closes.length - 1]!;
    text = text.slice(last.index! + last[0].length);
  }
  const open = THINK_OPEN.exec(text);
  if (open) text = text.slice(0, open.index);
  return text;
}

// ---- 2. Checks ----

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json)$/i;

const CODE: readonly RegExp[] = [
  /[`]/, // a code mark or fence
  /=>/,
  /;(\s|$)/,
  /[{}]/,
  /[A-Za-z_$][\w$]*\(/, // a call: a name straight before a bracket
  /\b(const|let|var)\s+[\w$]+\s*[=:]/,
  /\b(import|export)\s+[\w${*]+(\s+from\b|\s*[{;=]|\s*$)/,
  /\bfunction\s*[\w$]*\s*\(/,
  /\bclass\s+[\w$]+\s*[{(]/,
  /\breturn\s+[^\s.,!?]+;/,
  /\brequire\s*\(/,
];

const URL_PATTERNS: readonly RegExp[] = [/:\/\//, /\bwww\./i, /\b[\w-]+\.[a-z]{2,}\//i, /\b[\w-]+\.(com|org|net|io|dev|app|co|ai|gov|edu|sh|xyz)\b/i];

const SECRET: readonly RegExp[] = [
  /\b[0-9a-f]{24,}\b/i, // a long hexadecimal run (a hash, a key)
  /(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{32,}/, // a long base64-ish run with a digit in it (a key, not a word)
  /\beyJ[\w-]+\.[\w-]+/, // a JWT
  /\b(sk-|sk_live_|ghp_|gho_|ghs_|github_pat_|xox[abp]-|AKIA|AIza)/,
  /-----BEGIN/,
];

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Words in the text that look like source file names: they may name the file (and its neighbours) and are not URLs. */
const withoutFileNames = (text: string): string => text.replace(/[\w./-]+\.[a-z]{1,4}\b/gi, (word) => (SOURCE_EXTENSIONS.test(word) ? ' ' : word));

/** Why the text may not be a eulogy, or null when it may. */
export function rejectReason(text: string, people: People): RejectReason | null {
  if (text.trim() === '') return 'empty';
  if (CODE.some((p) => p.test(text))) return 'code';
  if (EMAIL.test(text)) return 'email'; // before URLs: an address's domain would look like one
  if (URL_PATTERNS.some((p) => p.test(withoutFileNames(text)))) return 'url';
  if (SECRET.some((p) => p.test(withoutFileNames(text)))) return 'secret';
  if (mentionsPerson(text, people)) return 'author';
  return null;
}

// ---- 3. Cleaning ----

const QUOTES = `"'“”‘’«»„‟‚‛`;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** The sentences of a text: a sentence ends at . ! or ? followed by a space and a capital letter (so "index.ts" does not end one). */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const end = /[.!?]+(?=\s+\p{Lu})/gu;
  for (const m of text.matchAll(end)) {
    const stop = m.index! + m[0].length;
    out.push(text.slice(start, stop).trim());
    start = stop;
  }
  const rest = text.slice(start).trim();
  if (rest !== '') out.push(rest);
  return out;
}

function stripWrappingQuotes(text: string): string {
  let t = text.trim();
  while (t.length > 0 && QUOTES.includes(t[0]!)) t = t.slice(1).trimStart();
  while (t.length > 0 && QUOTES.includes(t[t.length - 1]!)) t = t.slice(0, -1).trimEnd();
  return t;
}

/** Cut to `max` code points at the last space before it, ending with a full stop. */
function cutToLength(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let head = chars.slice(0, max - 1).join('');
  const space = head.lastIndexOf(' ');
  if (space > 0) head = head.slice(0, space);
  head = head.replace(/[\s,;:—–\-…]+$/u, '').replace(/[.!?]+$/u, '');
  return `${head}.`;
}

export function cleanEulogy(raw: string, context: { people: People }): Cleaned {
  const answer = stripReasoning(raw);
  const reason = rejectReason(answer, context.people);
  if (reason !== null) return { ok: false, reason };

  // Line markers (headings, blockquotes, list markers) can be stacked ("- # a"): removed until none is left.
  let text = answer.replace(EMOJI, '');
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text
      .replace(/^\s*#{1,6}(\s+|$)/gm, '') // headings
      .replace(/^\s*>\s?/gm, '') // blockquotes
      .replace(/^\s*(?:[-*+•]|\d+[.)])(\s+|$)/gm, ''); // list markers
  }
  text = text
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,!?;:]|$)/g, '$1$2')
    .replace(/[*_]{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // What is left around the one line: markers, a label and wrapping quotes can wrap each other ("” > A"), so they are removed
  // together, again and again, until nothing changes.
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/^(?:#{1,6}|>|[-*+•]|\d+[.)])(\s+|$)/, '').trim();
    text = text.replace(/^(epitaph|eulogy|here is (?:the|an|your) epitaph)\s*[:\-—]\s*/i, '');
    text = stripWrappingQuotes(text);
  }
  text = sentencesOf(text).slice(0, 2).join(' ');
  text = stripWrappingQuotes(cutToLength(text, EULOGY_MAX_CHARS));
  if (text === '' || !/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'empty' };
  return { ok: true, text };
}
