import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry, Thresholds } from '../../../shared/graveyard-schema';
import type { Contents } from './eulogy-contents';
import { fileInput, ghostInput } from './eulogy-input';
import { EULOGY_MAX_CHARS, EXAMPLE_FILE, buildPrompt } from './eulogy-prompt';
import type { FileHistory, People, RawGhost } from './history';
import { personPattern, personWords } from './redact';

const T: Thresholds = { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 };
const SHA = 'a'.repeat(40);
const file = (over: Partial<FileEntry> = {}): FileEntry => ({
  path: 'app/lib/voice/index.ts',
  folder: 'app/lib/voice',
  linesOfCode: 2,
  lastCommitDate: '2026-07-29T10:00:00.000Z',
  lastCommitAuthor: 'Ann',
  recentCommits: 1,
  unused: true,
  decayScore: 0.68,
  decayState: 'stale',
  hot: false,
  eulogy: '',
  ...over,
});
const history = (subject: string): FileHistory => ({ lastCommitDate: '2026-07-29T10:00:00.000Z', lastCommitAuthor: 'Ann', recentCommits: 1, lastCommitSubject: subject });
const ghost = (subject: string): RawGhost => ({ path: 'src/surface-placement.ts', deletedInSha: SHA, deletedDate: '2026-10-12T08:30:00.000Z', deletedBy: 'Bob', lastExistingSha: SHA, deletedSubject: subject });
const text = (t: string, cut = false): Contents => ({ text: t, cut, kind: 'text' });
const nobody: People = { names: new Set(), emails: new Set() };

describe('the inputs', () => {
  it('describe a stone in the one vocabulary', () => {
    const input = fileInput(file(), history('drop the old voice hook'), T, text('export {};\n'), nobody);
    expect(input).toMatchObject({ kind: 'file', name: 'index.ts', state: 'Stale (21–45 days)', flags: ['Unused (nothing imports it (Knip))'], lines: 2, subject: 'drop the old voice hook' });
    expect(fileInput(file({ unused: false, hot: true, decayState: 'fresh' }), history(''), T, text(''), nobody)).toMatchObject({ state: 'Fresh (under 21 days)', flags: ['Hot (5+ commits in the 30 days before the snapshot)'] });
  });

  it('describe a ghost with its UTC day of deletion', () => {
    expect(ghostInput(ghost('remove surface placement'), text('x'), nobody)).toMatchObject({ kind: 'ghost', name: 'surface-placement.ts', deletedDay: '2026-10-12', subject: 'remove surface placement' });
  });
});

describe('the prompt', () => {
  const stone = fileInput(file(), history('drop the old voice hook'), T, text('export const voice = 1;\n'), nobody);

  it('gives the facts, the contents between markers, and the rules', () => {
    const { system, prompt } = buildPrompt(stone);
    expect(prompt).toContain('File: index.ts');
    expect(prompt).toContain('State: Stale (21–45 days)');
    expect(prompt).toContain('Flags: Unused (nothing imports it (Knip))');
    expect(prompt).toContain('Last change: drop the old voice hook');
    expect(prompt).toContain('<<<\nexport const voice = 1;\n\n>>>');
    expect(system).toMatch(/two sentences/);
    expect(system).toMatch(/Never mock or name its authors/);
    expect(system).toMatch(/no markdown/);
  });

  it('adds the reminder only on a retry', () => {
    expect(buildPrompt(stone).prompt).not.toContain('broke a rule');
    expect(buildPrompt(stone, true).prompt).toContain('broke a rule');
  });

  it('says when the contents were cut, or are binary or empty, and when there is no message', () => {
    expect(buildPrompt({ ...stone, contents: text('a\n', true) }).prompt).toContain('the rest is left out');
    expect(buildPrompt({ ...stone, contents: { text: '', cut: false, kind: 'binary' } }).prompt).toContain('a binary file (not shown)');
    expect(buildPrompt({ ...stone, contents: { text: '', cut: false, kind: 'empty' } }).prompt).toContain('an empty file');
    expect(buildPrompt({ ...stone, subject: '' }).prompt).toContain('Last change: (no message)');
    expect(buildPrompt(ghostInput(ghost(''), text('x'), nobody)).prompt).toContain('Deleted: 2026-10-12');
  });

  it('shows the tone with an example about a made-up file, short enough for the rules', () => {
    const { system } = buildPrompt(stone);
    expect(system).toContain(EXAMPLE_FILE);
    const example = system.split('\n').at(-1)!;
    expect(example.length).toBeLessThan(EULOGY_MAX_CHARS);
    expect(example.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 1).length).toBeLessThanOrEqual(2);
  });

  const nameArb = fc.stringMatching(/^[A-Z][a-z]{2,9}$/).filter((n) => !['Someone', 'File', 'Path', 'State', 'Flags', 'Lines', 'Last', 'Contents', 'Deleted', 'Deleting', 'Write', 'Rules', 'Never', 'Plain', 'Answer', 'Example', 'Here', 'Its', 'If', 'At', 'Accurate', 'Atmospheric', 'Your'].includes(n));

  it('P7: for any people and any subject and contents mentioning them, the prompt names none of them', () => {
    fc.assert(
      fc.property(fc.uniqueArray(nameArb, { minLength: 1, maxLength: 3 }), fc.array(fc.stringMatching(/^[a-z]{1,7}$/), { maxLength: 5 }), fc.boolean(), (names, words, isGhost) => {
        const emails = names.map((n) => `${n.toLowerCase()}q@example.com`);
        const people: People = { names: new Set(names), emails: new Set(emails) };
        const mention = [...words, ...names, ...emails, `by ${names[0]!.toUpperCase()}`].join(' ');
        const input = isGhost ? ghostInput(ghost(mention), text(`// Author: ${mention}\n`), people) : fileInput(file(), history(mention), T, text(`// Author: ${mention}\n`), people);
        const pattern = personPattern(personWords(people))!;
        // The path and the fixed words are given as they are (the eulogy must be accurate about them): a name that is one of them is
        // not a mention to remove.
        const base = isGhost ? ghostInput(ghost(''), text(''), people) : fileInput(file(), history(''), T, text(''), people);
        const fixed = buildPrompt(base, true);
        fc.pre(!personPattern(personWords(people))!.test(`${fixed.system}\n${fixed.prompt}`));
        const { system, prompt } = buildPrompt(input, true);
        return !pattern.test(prompt) && !pattern.test(system) && !prompt.includes('@');
      }),
      { numRuns: 200 },
    );
  });
});
