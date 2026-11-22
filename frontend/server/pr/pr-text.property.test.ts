import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry, Ghost, RepoMeta } from '../../../shared/graveyard-schema';
import type { Eligible } from './check';
import { OPENED_BY, codeSpan, commitMessage, neutralise, plain, prBody, prTitle } from './pr-text';

const meta: RepoMeta = {
  name: 'oikos_ledger',
  snapshotSha: '58b6eeeb6aa911e66bd29827016cfc98359b83c4',
  snapshotDate: '2026-08-18T00:38:17.000Z',
  analysedAt: '2026-11-19T15:15:20.926Z',
  schemaVersion: 2,
  thresholds: { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 },
};
const file = (over: Partial<FileEntry> = {}): FileEntry => ({
  path: 'app/lib/hooks/useUploadStatus.ts',
  folder: 'app/lib/hooks',
  linesOfCode: 30,
  lastCommitDate: '2026-07-03T10:00:00.000Z',
  lastCommitAuthor: 'sl2902',
  recentCommits: 0,
  unused: true,
  decayScore: 0.8,
  decayState: 'ancient',
  hot: false,
  eulogy: 'Here lies useUploadStatus.ts, once vibrant and full of promise. Now, only memories remain.',
  ...over,
});
const ghost = (over: Partial<Ghost> = {}): Ghost => ({
  path: 'src/surface-placement.ts',
  deletedInSha: '1a2b3c4d'.padEnd(40, '0'),
  deletedDate: '2026-08-12T08:00:00.000Z',
  deletedBy: 'Ann Author',
  lastExistingSha: '9f8e7d6c'.padEnd(40, '0'),
  ...over,
});
const bury = (f: FileEntry): Eligible => ({ action: 'bury', file: f });
const resurrect = (g: Ghost): Eligible => ({ action: 'resurrect', ghost: g });

/** The text with its code spans removed: what GitHub parses for mentions and references. */
const outsideCode = (md: string): string => md.replace(/\\`/g, ' ').replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, ' ');

describe('the pull request text', () => {
  it('reads as in the design for a Bury', () => {
    expect(prTitle(bury(file()))).toBe('RIP app/lib/hooks/useUploadStatus.ts');
    expect(prBody(bury(file()), meta)).toBe(
      [
        '> Here lies useUploadStatus.ts, once vibrant and full of promise. Now, only memories remain.',
        '',
        '**Why it was flagged** (snapshot 2026-08-18, `58b6eee`)',
        '- Unused: nothing in the project imports it (Knip).',
        '- Ancient: last changed Jul 3, over 45 days before the snapshot.',
        '',
        'This pull request deletes `app/lib/hooks/useUploadStatus.ts` and nothing else.',
        '',
        OPENED_BY,
      ].join('\n'),
    );
  });

  it('reads as in the design for a Resurrect, naming the deleter as plain text', () => {
    expect(prTitle(resurrect(ghost()))).toBe('Resurrect src/surface-placement.ts');
    expect(prBody(resurrect(ghost({ eulogy: 'Once it kept slabs in order.' })), meta)).toBe(
      [
        '> Once it kept slabs in order.',
        '',
        '**Deleted** Aug 12 by Ann Author in `1a2b3c4`.',
        'This pull request restores `src/surface-placement.ts` exactly as it was at `9f8e7d6`, its last commit before deletion, and nothing else.',
        '',
        OPENED_BY,
      ].join('\n'),
    );
  });

  it('leaves the quotation out when there is no eulogy', () => {
    expect(prBody(bury(file({ eulogy: '' })), meta).startsWith('**Why it was flagged**')).toBe(true);
    expect(prBody(resurrect(ghost()), meta).startsWith('**Deleted**')).toBe(true);
  });

  it('uses the age state and rule of the file, and the year when it differs from the snapshot\'s', () => {
    expect(prBody(bury(file({ decayState: 'fresh', lastCommitDate: '2026-08-10T00:00:00.000Z' })), meta)).toContain('- Fresh: last changed Aug 10, under 21 days before the snapshot.');
    expect(prBody(bury(file({ decayState: 'stale', lastCommitDate: '2026-07-20T00:00:00.000Z' })), meta)).toContain('- Stale: last changed Jul 20, 21–45 days before the snapshot.');
    expect(prBody(bury(file({ lastCommitDate: '2025-12-01T00:00:00.000Z' })), meta)).toContain('last changed Dec 1, 2025,');
  });

  it('names nobody in a Bury (not the last author)', () => {
    expect(prBody(bury(file({ lastCommitAuthor: 'Morticia Addams' })), meta)).not.toContain('Morticia');
  });

  it('escapes Markdown in the eulogy and the name, and neutralises mentions', () => {
    const body = prBody(resurrect(ghost({ deletedBy: '@octocat', eulogy: '> **Bold** [link](x) <b>hi</b> for @team and #12.' })), meta);
    expect(body).toContain('by @\u2060octocat in');
    expect(body).toContain('> \\> \\*\\*Bold\\*\\* \\[link\\](x) \\<b\\>hi\\</b\\> for @\u2060team and \\#\u206012.');
    expect(commitMessage(bury(file({ path: '@types/#1.ts' })))).toBe(`RIP @\u2060types/#\u20601.ts\n\n${OPENED_BY}`);
  });

  it('puts any path in a code span that holds it exactly', () => {
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`x`')).toBe('`` `x` ``');
    expect(codeSpan('plain.ts')).toBe('`plain.ts`');
  });
});

describe('P7: the text comes from the data and notifies nobody', () => {
  const textArb = fc.string({ maxLength: 80 }).map((s) => s.replace(/\r/g, ''));
  const tricky = fc.oneof(textArb, fc.constantFrom('@octocat', '@org/team', '#123', 'GH#7', 'x@y', '##1', 'a`b`c', '`', '``x'));
  const withTricks = fc.array(tricky, { maxLength: 4 }).map((parts) => parts.join(' '));
  const pathArb = fc.array(fc.oneof(fc.stringMatching(/^[A-Za-z0-9._@#` -]{1,10}$/), tricky.filter((t) => t !== '' && !t.includes('/'))), { minLength: 1, maxLength: 4 }).map((p) => p.join('/'));

  it('no @ or #<digit> from the data survives outside code; every path is in a code span; one quotation line at most', () => {
    fc.assert(
      fc.property(fc.boolean(), pathArb, withTricks, withTricks, (isBury, path, eulogy, name) => {
        const eligible = isBury ? bury(file({ path, eulogy })) : resurrect(ghost({ path, eulogy, deletedBy: name }));
        const body = prBody(eligible, meta);
        const title = prTitle(eligible);
        const commit = commitMessage(eligible);
        for (const text of [outsideCode(body), title, commit]) {
          expect(text).not.toMatch(/@(?!\u2060)/);
          expect(text).not.toMatch(/#(?!\u2060)\d/);
        }
        expect(body).toContain(codeSpan(path));
        expect(body.split('\n').filter((l) => l.startsWith('>')).length).toBeLessThanOrEqual(1);
        expect(neutralise(path).replace(/\u2060/g, '')).toBe(path);
      }),
      { numRuns: 500 },
    );
  });

  it('is the same for the same data, whatever else there is (the inputs are only the eligible grave and the meta)', () => {
    fc.assert(
      fc.property(withTricks, (eulogy) => {
        const a = prBody(bury(file({ eulogy })), meta);
        const b = prBody(bury(file({ eulogy })), { ...meta, analysedAt: '2030-01-01T00:00:00.000Z', name: 'other' });
        return a === b && prBody(bury(file({ eulogy })), meta) === a;
      }),
    );
  });

  it('plain keeps the words: removing the escapes and joiners gives the text back on one line', () => {
    fc.assert(fc.property(textArb, (t) => plain(t).replace(/\u2060/g, '').replace(/\\(.)/g, '$1') === t.replace(/\s+/g, ' ').trim()));
  });
});
