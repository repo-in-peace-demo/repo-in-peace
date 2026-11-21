import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry, Thresholds } from '../../../shared/graveyard-schema';
import type { Contents } from './eulogy-contents';
import { fileInput, ghostInput } from './eulogy-input';
import { FORMER_EXAMPLES } from './eulogy-clean';
import { OPENINGS, PROMPT_VERSION, TONE_TEXT, buildPrompt, openingFor, toneOf, type Tone } from './eulogy-prompt';
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
const SNAPSHOT = '2026-08-18T10:00:00.000Z'; // 20 days after the files' last commit

describe('the inputs', () => {
  it('describe a stone in the one vocabulary', () => {
    const input = fileInput(file(), history('drop the old voice hook'), T, text('export {};\n'), nobody, SNAPSHOT);
    expect(input).toMatchObject({ kind: 'file', name: 'index.ts', state: 'Stale (21–45 days)', flags: ['Unused (nothing imports it (Knip))'], lines: 2, subject: 'drop the old voice hook' });
    expect(fileInput(file({ unused: false, hot: true, decayState: 'fresh' }), history(''), T, text(''), nobody, SNAPSHOT)).toMatchObject({ state: 'Fresh (under 21 days)', flags: ['Hot (5+ commits in the 30 days before the snapshot)'] });
  });

  it('describe a ghost with its UTC day of deletion', () => {
    expect(ghostInput(ghost('remove surface placement'), text('x'), nobody)).toMatchObject({ kind: 'ghost', name: 'surface-placement.ts', deletedDay: '2026-10-12', subject: 'remove surface placement' });
  });
});

describe('the prompt', () => {
  const stone = fileInput(file(), history('drop the old voice hook'), T, text('export const voice = 1;\n'), nobody, SNAPSHOT);

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

  const tones: Array<[Tone, Partial<FileEntry> | 'ghost']> = [
    ['alive', { decayState: 'fresh', unused: false }],
    ['serving', { decayState: 'stale', unused: false }],
    ['serving', { decayState: 'ancient', unused: false }],
    ['mourned', { decayState: 'fresh', unused: true }],
    ['mourned', { decayState: 'ancient', unused: true }],
    ['departed', 'ghost'],
  ];

  it.each(tones)('gives the %s tone and an opening for %j, and no example', (tone, over) => {
    const input = over === 'ghost' ? ghostInput(ghost('x'), text('x'), nobody) : fileInput(file(over), history('x'), T, text('x'), nobody, SNAPSHOT);
    expect(toneOf(input)).toBe(tone);
    const { prompt } = buildPrompt(input);
    expect(prompt).toContain(`Tone: ${TONE_TEXT[tone]}`);
    expect(prompt).not.toMatch(/Example/i);
    expect(prompt).not.toMatch(/lantern/i);
    expect(prompt).toContain(`Opening: ${openingFor(input.path)}`);
  });

  it('tells a living file it is alive, an old used one that it still serves, and lets only the unused and the deleted be mourned', () => {
    expect(TONE_TEXT.alive).toMatch(/Never call it forgotten, silent, dormant/);
    expect(TONE_TEXT.serving).toMatch(/still uses it/);
    expect(TONE_TEXT.mourned).toMatch(/here lies/);
    expect(TONE_TEXT.departed).toMatch(/deleted/);
    expect(TONE_TEXT.alive).not.toMatch(/here lies/i);
    expect(TONE_TEXT.serving).not.toMatch(/here lies/i);
  });

  it('gives no example eulogy, which the model copied, and none of the earlier ones', () => {
    const { system, prompt } = buildPrompt(stone);
    for (const example of FORMER_EXAMPLES) expect(`${system}\n${prompt}`).not.toContain(example.slice(0, 30));
    expect(system).not.toMatch(/lantern|example/i);
  });

  it('gives the real age in days, and forbids claiming years for a younger file', () => {
    expect(stone.kind === 'file' && stone.ageDays).toBe(20);
    expect(buildPrompt(stone).prompt).toContain('Age: last changed 20 days before the snapshot');
    expect(buildPrompt({ ...stone, ageDays: 1 } as typeof stone).prompt).toContain('Age: last changed 1 day before the snapshot');
    expect(buildPrompt(stone).system).toMatch(/since time immemorial/);
    expect(buildPrompt(stone).system).toMatch(/file name on a line of its own/);
  });

  it('chooses the opening from the path alone, the same every time, and spreads paths across the openings', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), (path) => openingFor(path) === openingFor(path) && OPENINGS.includes(openingFor(path))));
    const used = new Set(Array.from({ length: 200 }, (_, i) => openingFor(`src/file-${i}.ts`)));
    expect(used.size).toBe(OPENINGS.length);
    const counts = OPENINGS.map((o) => Array.from({ length: 700 }, (_, i) => openingFor(`app/f${i}.tsx`)).filter((x) => x === o).length);
    expect(Math.min(...counts)).toBeGreaterThan(50); // about 100 each
  });

  it('is prompt version 3', () => {
    expect(PROMPT_VERSION).toBe(3);
  });

  const FIXED_WORDS = new Set(
    [buildPrompt(stone).system, buildPrompt(stone, true).prompt, ...Object.values(TONE_TEXT), ...OPENINGS, 'File Path State Flags Lines Last Contents Deleted Deleting Write Someone Tone Opening Age']
      .join(' ')
      .split(/[^A-Za-z]+/),
  );
  const nameArb = fc.stringMatching(/^[A-Z][a-z]{2,9}$/).filter((n) => !FIXED_WORDS.has(n) && !FIXED_WORDS.has(n.toLowerCase()));

  it('P7: for any people and any subject and contents mentioning them, the prompt names none of them', () => {
    fc.assert(
      fc.property(fc.uniqueArray(nameArb, { minLength: 1, maxLength: 3 }), fc.array(fc.stringMatching(/^[a-z]{1,7}$/), { maxLength: 5 }), fc.boolean(), (names, words, isGhost) => {
        const emails = names.map((n) => `${n.toLowerCase()}q@example.com`);
        const people: People = { names: new Set(names), emails: new Set(emails) };
        const mention = [...words, ...names, ...emails, `by ${names[0]!.toUpperCase()}`].join(' ');
        const input = isGhost ? ghostInput(ghost(mention), text(`// Author: ${mention}\n`), people) : fileInput(file(), history(mention), T, text(`// Author: ${mention}\n`), people, SNAPSHOT);
        const pattern = personPattern(personWords(people))!;
        // The path and the fixed words are given as they are (the eulogy must be accurate about them): a name that is one of them is
        // not a mention to remove.
        const base = isGhost ? ghostInput(ghost(''), text(''), people) : fileInput(file(), history(''), T, text(''), people, SNAPSHOT);
        const fixed = buildPrompt(base, true);
        fc.pre(!personPattern(personWords(people))!.test(`${fixed.system}\n${fixed.prompt}`));
        const { system, prompt } = buildPrompt(input, true);
        return !pattern.test(prompt) && !pattern.test(system) && !prompt.includes('@');
      }),
      { numRuns: 200 },
    );
  });
});
