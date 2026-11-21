import { CONTENTS_BUDGET_BYTES } from './eulogy-contents';
import type { EulogyInput } from './eulogy-input';

/**
 * The prompt for one grave's eulogy (eulogies spec, Req 3.5, 4). Pure. Raise PROMPT_VERSION whenever the words below, or what goes into
 * them, change: it is part of the cache key, so every eulogy is written again with the new prompt.
 */
export const PROMPT_VERSION = 1;

/** The most characters a eulogy may have (Req 4.1); the prompt asks for less, to leave room. */
export const EULOGY_MAX_CHARS = 240;

/** An example in the tone wanted, about a file that is made up (and named so it cannot be mistaken for a real one). */
export const EXAMPLE_FILE = 'lantern-keeper.example.ts';
const EXAMPLE_EULOGY = 'Here lies the lantern keeper, who lit every path at dusk and never once asked why. Its flame went out quietly, still waiting for travellers.';

const SYSTEM = [
  'You write epitaphs for files in a code graveyard.',
  'Rules:',
  `- At most two sentences, under ${EULOGY_MAX_CHARS - 40} characters in all.`,
  '- Atmospheric and lightly witty, like an old gravestone with a smile.',
  "- Accurate about what the file does or did, judged only from its name, path and contents. If you cannot tell, say so gently; never invent a fact.",
  '- Never mock or name its authors, or anyone.',
  '- Never quote code, strings, function calls, URLs, keys or tokens.',
  '- Plain text only: no quotes around it, no markdown, no emoji, no line breaks.',
  'Answer with the epitaph alone.',
  '',
  `Example, for a made-up file ${EXAMPLE_FILE}:`,
  EXAMPLE_EULOGY,
].join('\n');

const RETRY = 'Your last answer broke a rule (it quoted code or a name, or was too long). Write it again, following every rule.';

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
          `Lines of code: ${input.lines}`,
          `Last change: ${input.subject.trim() === '' ? '(no message)' : input.subject}`,
        ]
      : [
          `File: ${input.name} (deleted)`,
          `Path: ${input.path}`,
          `Deleted: ${input.deletedDay}`,
          `Deleting change: ${input.subject.trim() === '' ? '(no message)' : input.subject}`,
        ];
  const parts = [`Write the epitaph for this ${input.kind === 'file' ? 'file' : 'deleted file'}.`, ...facts, contentsBlock(input)];
  if (retry) parts.push(RETRY);
  return { system: SYSTEM, prompt: parts.join('\n') };
}
