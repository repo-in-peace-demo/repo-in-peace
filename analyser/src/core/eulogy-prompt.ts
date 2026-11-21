import { createHash } from 'node:crypto';
import { CONTENTS_BUDGET_BYTES } from './eulogy-contents';
import type { EulogyInput } from './eulogy-input';

/**
 * The prompt for one grave's eulogy (eulogies spec, Req 3.5, 4). Pure. Raise PROMPT_VERSION whenever the words below, or what goes into
 * them, change: it is part of the cache key, so every eulogy is written again with the new prompt.
 *
 * Version 3 gives no example eulogy: with one, the model copied it word for word onto graves it said nothing about, and took its
 * opening for every grave. The tone and the opening are described in words instead.
 */
export const PROMPT_VERSION = 3;

/** The most characters a eulogy may have (Req 4.1); the prompt asks for less, to leave room. */
export const EULOGY_MAX_CHARS = 240;

/**
 * How a grave should sound, from its facts (eulogies spec, Req 3.5): a fresh, used file is alive; an older used file is old but still
 * at work; an unused file may be mourned; a ghost is gone.
 */
export type Tone = 'alive' | 'serving' | 'mourned' | 'departed';

export function toneOf(input: EulogyInput): Tone {
  if (input.kind === 'ghost') return 'departed';
  if (input.unused) return 'mourned';
  return input.decayState === 'fresh' ? 'alive' : 'serving';
}

export const TONE_TEXT: Record<Tone, string> = {
  alive:
    'Alive. It changed recently and other code uses it. Write of it as living and at work, keeping watch over the graveyard. Never call it forgotten, silent, dormant, dead, unused or ancient.',
  serving:
    'Old but still serving. It has not changed for a while, but other code still uses it. Write of it as weathered and long-standing, still at its post. Never call it unused, forgotten or gone.',
  mourned:
    'Mourned. Nothing uses it any more. It may be mourned like a real grave ("here lies" fits).',
  departed: 'Departed. The file was deleted. Write of it as gone, remembered for what it did.',
};

/** Ways to begin, one chosen per grave from its path, so a graveyard of eulogies does not all start the same way. */
export const OPENINGS: readonly string[] = [
  'Begin with what the file does.',
  'Begin with an image of the graveyard at night.',
  'Begin by speaking to the file directly.',
  'Begin with the name of the file.',
  'Begin with a time of day or a season.',
  'Begin with what it watches over or keeps.',
  'Begin with what it would say if it could speak.',
];

/** The same path always gets the same opening (a hash, not the clock or a random number), so the prompt and its cache key are stable. */
export function openingFor(path: string): string {
  const n = createHash('sha256').update(path).digest().readUInt32BE(0);
  return OPENINGS[n % OPENINGS.length]!;
}

const SYSTEM = [
  'You write epitaphs for files in a code graveyard.',
  'Rules:',
  `- At most two sentences, under ${EULOGY_MAX_CHARS - 40} characters in all.`,
  '- Atmospheric and lightly witty, like an old gravestone with a smile.',
  "- Accurate about what the file does or did, judged only from its name, path and contents. If you cannot tell, say so gently; never invent a fact.",
  '- Match the tone given for the grave. Call a file unused only if its flags say Unused, and ancient only if its state says Ancient.',
  '- Do not start with "Here lies" unless the tone allows it; follow the opening given.',
  "- Say how old it is only as the Age line says: never \"for years\", \"for decades\", \"for ages\" or \"since time immemorial\" for a file under a year old.",
  '- Do not begin with the file name on a line of its own.',
  '- Never mock or name its authors, or anyone.',
  '- Never quote code, strings, function calls, URLs, keys or tokens.',
  '- Plain text only: no quotes around it, no markdown, no emoji, no line breaks. Prose, not verse.',
  'Answer with the epitaph alone.',
].join('\n');

const RETRY =
  'Your last answer broke a rule (it quoted code or a name, said something the facts above contradict, left a quote open, or was too long). Write it again, following every rule.';

function contentsBlock(input: EulogyInput): string {
  const where = input.kind === 'file' ? 'Contents' : 'Contents at its last commit';
  const { contents } = input;
  if (contents.kind === 'binary') return `${where}: a binary file (not shown).`;
  if (contents.kind === 'empty') return `${where}: an empty file.`;
  const note = contents.cut ? ` (the first ${CONTENTS_BUDGET_BYTES} bytes; the rest is left out)` : '';
  return `${where}${note}:\n<<<\n${contents.text}\n>>>`;
}

export function buildPrompt(input: EulogyInput, retry = false): { system: string; prompt: string } {
  const facts =
    input.kind === 'file'
      ? [
          `File: ${input.name}`,
          `Path: ${input.path}`,
          `State: ${input.state}`,
          `Flags: ${input.flags.length === 0 ? 'none' : input.flags.join('; ')}`,
          `Age: last changed ${input.ageDays} ${input.ageDays === 1 ? 'day' : 'days'} before the snapshot`,
          `Lines of code: ${input.lines}`,
          `Last change: ${input.subject.trim() === '' ? '(no message)' : input.subject}`,
        ]
      : [
          `File: ${input.name} (deleted)`,
          `Path: ${input.path}`,
          `Deleted: ${input.deletedDay}`,
          `Deleting change: ${input.subject.trim() === '' ? '(no message)' : input.subject}`,
        ];
  const tone = toneOf(input);
  const parts = [
    `Write the epitaph for this ${input.kind === 'file' ? 'file' : 'deleted file'}.`,
    ...facts,
    `Tone: ${TONE_TEXT[tone]}`,
    `Opening: ${openingFor(input.path)}`,
    contentsBlock(input),
  ];
  if (retry) parts.push(RETRY);
  return { system: SYSTEM, prompt: parts.join('\n') };
}
