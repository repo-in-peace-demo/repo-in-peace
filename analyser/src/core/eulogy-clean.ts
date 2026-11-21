import type { EulogyInput } from './eulogy-input';
import type { People } from './history';
import { mentionsPerson } from './redact';
import { EULOGY_MAX_CHARS } from './eulogy-prompt';

/**
 * Cleaning and checking a model's answer (eulogies spec, Req 4.4 to 4.6). Pure. In this order:
 *   1. any reasoning block the model wrote (`<think>…</think>`, `<thinking>…`) is removed;
 *   2. the text left is checked: anything code-like, a URL, a secret-like string, an e-mail or a person of the repository rejects it
 *      (before cleaning, so removing markdown cannot hide code);
 *   3. it is cleaned: markdown and emoji go, broken lines are joined, a label and wrapping quotes go, whitespace becomes single spaces,
 *      and it keeps the whole sentences that fit (two at most);
 *   4. the cleaned text is checked again: unbalanced quotes, no whole sentence that fits, or a claim the grave's facts contradict
 *      (a used file called unused, a file that is not ancient called ancient, a living file called forgotten, a file under a year old
 *      said to be years old), and a copy of an example from an earlier prompt, reject it.
 * Strict on purpose: a harmless eulogy that looks like code is rejected (and retried once) rather than risk a leak.
 *
 * Raise CLEANING_VERSION whenever these rules change: it is part of the cache key, so cached eulogies are cleaned by the new rules.
 */
export const CLEANING_VERSION = 3;

export type RejectReason = 'empty' | 'code' | 'url' | 'secret' | 'email' | 'author' | 'quotes' | 'long' | 'facts' | 'example';
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

/** The sentences of a text: a sentence ends at . ! or ?, perhaps with a closing quote, followed by a space and a capital letter (so
 * "index.ts" does not end one). */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const end = /[.!?]+["”’»]?(?=\s+["“‘«]?\p{Lu})/gu;
  for (const m of text.matchAll(end)) {
    const stop = m.index! + m[0].length;
    out.push(text.slice(start, stop).trim());
    start = stop;
  }
  const rest = text.slice(start).trim();
  if (rest !== '') out.push(rest);
  return out;
}

/** Double quotes that open and close: straight ones come in pairs, curly and angled ones match. (Single quotes are left out: they are
 * also apostrophes.) */
export function quotesBalanced(text: string): boolean {
  const count = (c: string): number => text.split(c).length - 1;
  return count('"') % 2 === 0 && count('“') === count('”') && count('«') === count('»');
}

/** Wrapping quotes go: a pair around the whole, or one at either end that has no partner. A closing quote that ends a quotation
 * inside the text ("It whispered, "Fade."") stays. */
function stripWrappingQuotes(text: string): string {
  let t = text.trim();
  const isQuote = (c: string | undefined): boolean => c !== undefined && QUOTES.includes(c);
  for (;;) {
    const first = t[0];
    const last = t[t.length - 1];
    if (t.length >= 2 && isQuote(first) && isQuote(last)) t = t.slice(1, -1).trim();
    else if (isQuote(first) && (!quotesBalanced(t) || "'‘’".includes(first!))) t = t.slice(1).trimStart();
    else if (isQuote(last) && !quotesBalanced(t)) t = t.slice(0, -1).trimEnd();
    else return t;
  }
}

/**
 * A line break inside a sentence: the model wrapped its line, or wrote verse. Joined with a space, and the next word loses its capital
 * ("lies the router,\nMocking" becomes "lies the router, mocking") unless it is a name: a word with more capitals or digits, "I", or a
 * word that the file's path or contents spell the same way (Meta, Vite).
 */
function joinBrokenLines(text: string, input: EulogyInput | undefined): string {
  const known = input === undefined ? '' : `${input.path}\n${input.contents.text}`;
  return text.replace(/([\p{Ll},;:—–-])[ \t]*\r?\n\s*(\p{Lu}\p{Ll}+)(?![\p{L}\p{N}])/gu, (all, before: string, word: string, at: number) => {
    // A line ending in a file name ("ComparePanel.tsx") is a heading or a sentence of its own: the next word keeps its capital.
    if (SOURCE_FILE_AT_END.test(text.slice(0, at + 1))) return `${before} ${word}`;
    return known.includes(word) ? `${before} ${word}` : `${before} ${word.toLowerCase()}`;
  });
}

const SOURCE_FILE = String.raw`[\w@()[\]./-]*\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)`;
const SOURCE_FILE_AT_END = new RegExp(`${SOURCE_FILE}$`, 'i');
/** A file name (or path) the answer opens with as a heading: alone on its line, or before a colon or dash, or before a capital. */
const LEADING_FILE_NAME = new RegExp(String.raw`^\s*["“'‘]?${SOURCE_FILE}["”'’]?(?:\s*[:—–-]\s*|[ \t]*\r?\n\s*|[ \t]+(?=["“]?\p{Lu}))`, 'u');

/** The answer without a file name it wrote as a heading ("daily-flow.test.ts\nEvery dawn…" becomes "Every dawn…"). A name that is
 * the subject of the first sentence ("route.ts has marked paths") stays. */
function withoutLeadingFileName(text: string): string {
  const rest = text.replace(LEADING_FILE_NAME, '');
  return /[\p{L}\p{N}]/u.test(rest) ? rest : text;
}

/** The whole sentences that fit: the first two, or the first alone when two are too long; none when the first alone is. */
function wholeSentences(text: string, max: number): string | undefined {
  const sentences = sentencesOf(text);
  for (const take of [2, 1]) {
    const joined = sentences.slice(0, take).join(' ');
    if (Array.from(joined).length <= max) return joined;
  }
  return undefined;
}

// ---- 4. Checks against the grave's facts ----

/** Words that make "ancient" or "unused" about something other than the file ("ancient history", "it swept unused imports"). */
const NOT_ABOUT_THE_FILE_UNUSED =
  /^\s+(imports?|exports?|variables?|vars|code|dependenc(?:y|ies)|deps|parameters?|params|arguments?|files?|styles?|classes|keys?|fields?|types?|props|values?|entries|rows?|branches|columns?|tables?|bytes?|memory|space|slots?|cells?|items?)\b/i;
const NOT_ABOUT_THE_FILE_ANCIENT =
  /^\s+(history|arts?|rites?|rituals?|lore|traditions?|wisdom|tongues?|scrolls?|times|ways|texts?|runes|maps?|mariners?|ones|gods|stars|seas|ruins|tales?|days of)\b/i;
const NEGATED = /\b(not|never|hardly|nor|no|far from|anything but|less than)\s+(?:yet\s+|so\s+|quite\s+|at all\s+)?$/i;

/** Each occurrence of `word` that the text says of the file: not negated just before it, and not followed by a word that makes it
 * about something else. */
function claims(text: string, word: RegExp, notAboutTheFile: RegExp): boolean {
  for (const m of text.matchAll(word)) {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index! + m[0].length);
    if (NEGATED.test(before) || notAboutTheFile.test(after)) continue;
    return true;
  }
  return false;
}

/** Phrases that say a file is not used, besides "unused" itself. */
const NOT_USED = /\b(no longer (used|imported|called|needed)|never (used|imported|called)(?=[\s.,;!?]|$)|(nothing|nobody|no one|no file) (imports|uses|calls|needs) it)\b/i;
/** Words that call a file dead or gone: wrong for one that is fresh and in use. */
const DEAD_WORDS = /\b(forgotten|dormant|silent|silenced|abandoned|lifeless|dead|deceased|departed|buried)\b/gi;

/** Words that say a file has been around for years. Wrong for one under a year old (its age is in the prompt). */
const AGE_CLAIMS =
  /\b((for|over|across|through|in|after)\s+(many\s+|countless\s+|long\s+)?(years|decades|centuries|aeons|eons|ages|generations|millennia)|(years|decades|centuries|aeons|eons)\s+(old|ago)|since\s+(time\s+immemorial|ancient\s+times|the\s+dawn\s+of\s+time|days\s+of\s+old|time\s+began|the\s+beginning\s+of\s+time)|time\s+out\s+of\s+mind|from\s+time\s+immemorial|ages\s+past|of\s+yore)\b/i;
/** Days in a year, for the age claims. */
const YEAR_DAYS = 365;

/** Whether the eulogy says something the grave's facts contradict (Req 4.5). Ghosts have no state or flags to contradict. */
export function contradictsFacts(text: string, input: EulogyInput): boolean {
  if (input.kind !== 'file') return false;
  if (!input.unused && (claims(text, /\bunused\b/gi, NOT_ABOUT_THE_FILE_UNUSED) || NOT_USED.test(text))) return true;
  if (input.decayState !== 'ancient' && claims(text, /\bancient\b/gi, NOT_ABOUT_THE_FILE_ANCIENT)) return true;
  if (input.decayState === 'fresh' && !input.unused && claims(text, DEAD_WORDS, /^(?!)/)) return true; // "never forgotten" is allowed
  if (input.ageDays < YEAR_DAYS && AGE_CLAIMS.test(text)) return true;
  return false;
}

/**
 * The example eulogies of earlier prompts (versions 1 and 2), about the made-up lantern keeper. The model copied them, whole or in
 * part, onto graves they said nothing about; an answer sharing a run of five words with one is rejected.
 */
export const FORMER_EXAMPLES: readonly string[] = [
  'Here lies the lantern keeper, who lit every path at dusk and never once asked why. Its flame went out quietly, still waiting for travellers.',
  'Every dusk the lantern keeper still lights the paths, and travellers find their way because of it. No ghost has ever caught it napping.',
  'The lantern keeper has lit these paths since before the moss came, and it lights them still. Its glass is cloudy, its flame steady.',
  'Rest now, lantern keeper: no traveller comes this way any more. You lit every path at dusk and never once asked why.',
  'Once the lantern keeper lit every path at dusk. The paths are dark now, but the travellers remember the light.',
];
const COPY_RUN = 5;
const wordsOf = (text: string): string[] => text.toLowerCase().replace(/travelers/g, 'travellers').split(/[^\p{L}\p{N}']+/u).filter((w) => w !== '');
const runsOf = (words: readonly string[]): Set<string> => new Set(words.slice(0, Math.max(0, words.length - COPY_RUN + 1)).map((_, i) => words.slice(i, i + COPY_RUN).join(' ')));
const EXAMPLE_RUNS = new Set(FORMER_EXAMPLES.flatMap((e) => [...runsOf(wordsOf(e))]));

/** Whether the text copies an earlier example: "lantern keeper", or five words in a row from one. */
export function copiesExample(text: string): boolean {
  if (/\blantern[- ]keeper\b/i.test(text)) return true;
  return [...runsOf(wordsOf(text))].some((run) => EXAMPLE_RUNS.has(run));
}

export function cleanEulogy(raw: string, context: { people: People; input?: EulogyInput }): Cleaned {
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
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,!?;:]|$)/gm, '$1$2')
    .replace(/[*_]{2,}/g, '');
  text = joinBrokenLines(withoutLeadingFileName(text), context.input).replace(/\s+/g, ' ').trim();
  // What is left around the one line: markers, a label and wrapping quotes can wrap each other ("” > A"), so they are removed
  // together, again and again, until nothing changes.
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/^(?:#{1,6}|>|[-*+•]|\d+[.)])(\s+|$)/, '').trim();
    text = text.replace(/^(epitaph|eulogy|here is (?:the|an|your) epitaph)\s*[:\-—]\s*/i, '');
    text = stripWrappingQuotes(text);
  }
  if (text === '' || !/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'empty' };

  const fitted = wholeSentences(text, EULOGY_MAX_CHARS);
  if (fitted === undefined) return { ok: false, reason: 'long' };
  text = stripWrappingQuotes(fitted);
  if (!/[.!?]["”’»]?$/u.test(text)) text = `${text.replace(/[\s,;:—–\-…]+$/u, '')}.`;
  if (text === '' || !/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'empty' };
  // A quote left open, or one that opens the eulogy (a quotation it starts with reads as quotes around it): rejected.
  if (!quotesBalanced(text) || QUOTES.includes(text[0]!)) return { ok: false, reason: 'quotes' };
  if (copiesExample(text)) return { ok: false, reason: 'example' };
  if (context.input !== undefined && contradictsFacts(text, context.input)) return { ok: false, reason: 'facts' };
  return { ok: true, text };
}
