import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Change } from '../core/commit-record';
import { GIT_LOG_ARGS, GitLogParseError, parseGitLog } from './git-log-parse';

// Real `git log` output, captured by test/fixtures/make-git-log-sample.sh.
// Commits, newest first (--topo-order):
//   0 empty commit            no changes
//   1 merge of side           no changes (plain git log shows no diff for merges)
//   2 side: add side.ts
//   3 mainwork: add main.ts
//   4 delete "sp ace.ts"
//   5 rename a.ts -> b.ts
//   6 modify a.ts
//   7 root: add a.ts, "sp ace.ts", "src/é.ts"
const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

const sample = readFileSync(fixturePath('git-log-sample.bin'), 'utf8');

interface ExpectedHeader {
  sha: string;
  parents: string[];
  date: string;
  author: string;
  authorEmail: string;
  subject: string;
}

function readExpectedHeaders(): ExpectedHeader[] {
  const tsv = readFileSync(fixturePath('git-log-sample.expected.tsv'), 'utf8');
  return tsv
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', parents = '', date = '', author = '', authorEmail = '', ...subject] = line.split('\t');
      return {
        sha,
        parents: parents === '' ? [] : parents.split(' '),
        date: new Date(date).toISOString(),
        author,
        authorEmail,
        subject: subject.join('\t'),
      };
    });
}

const expectedChanges: Change[][] = [
  [],
  [],
  [{ kind: 'add', path: 'side.ts' }],
  [{ kind: 'add', path: 'main.ts' }],
  [{ kind: 'delete', path: 'sp ace.ts' }],
  [{ kind: 'rename', oldPath: 'a.ts', path: 'b.ts' }],
  [{ kind: 'modify', path: 'a.ts' }],
  [
    { kind: 'add', path: 'a.ts' },
    { kind: 'add', path: 'sp ace.ts' },
    { kind: 'add', path: 'src/é.ts' },
  ],
];

describe('parseGitLog on real git output', () => {
  const records = parseGitLog(sample);
  const headers = readExpectedHeaders();

  it('sanity: the fixture has the eight commits this test describes', () => {
    expect(headers).toHaveLength(8);
    expect(records).toHaveLength(8);
  });

  it('reads sha, parents, author and date for every commit', () => {
    expect(records.map(({ sha, parents, date, author, authorEmail, subject }) => ({ sha, parents, date, author, authorEmail, subject }))).toEqual(
      headers,
    );
  });

  it('converts committer dates with any offset to UTC', () => {
    // Fixture dates: ...+05:30 (root), ...-08:00 (rename commit).
    expect(records[7]?.date).toBe('2026-01-01T04:30:00.000Z');
    expect(records[5]?.date).toBe('2026-01-03T18:00:00.000Z');
  });

  it('reads the file changes of every commit', () => {
    expect(records.map((r) => r.changes)).toEqual(expectedChanges);
  });

  it('reads merge and empty commits as having no changes, and the merge as having two parents', () => {
    expect(records[0]?.changes).toEqual([]);
    expect(records[1]?.changes).toEqual([]);
    expect(records[1]?.parents).toHaveLength(2);
  });

  it('reads the root commit as having no parents', () => {
    expect(records[7]?.parents).toEqual([]);
  });

  it('keeps spaces and non-ASCII characters in paths unescaped', () => {
    const paths = records.flatMap((r) => r.changes.map((c) => c.path));
    expect(paths).toContain('sp ace.ts');
    expect(paths).toContain('src/é.ts');
  });
});

describe('parseGitLog on hand-built input', () => {
  const sha = 'a'.repeat(40);
  const parent = 'b'.repeat(40);
  const header = `\x1e${sha}\x1f${parent}\x1f2026-02-01T10:00:00Z\x1fAnn\x1fann@example.com\x1fadd things`;

  it('returns an empty list for empty output', () => {
    expect(parseGitLog('')).toEqual([]);
  });

  it('maps type changes to modify and copies to add of the new path', () => {
    const text = `${header}\0\nT\0t.ts\0C75\0from.ts\0copy.ts\0`;
    expect(parseGitLog(text)[0]?.changes).toEqual([
      { kind: 'modify', path: 't.ts' },
      { kind: 'add', path: 'copy.ts' },
    ]);
  });

  it('accepts a header with no newline and no entries', () => {
    expect(parseGitLog(`${header}\0`)[0]?.changes).toEqual([]);
  });

  it('rejects output that does not start with a record separator', () => {
    expect(() => parseGitLog('hello')).toThrow(GitLogParseError);
  });

  it('reads the author e-mail and the subject, and a subject with a separator character in it whole', () => {
    expect(parseGitLog(`${header}\0`)[0]).toMatchObject({ author: 'Ann', authorEmail: 'ann@example.com', subject: 'add things' });
    const odd = `\x1e${sha}\x1f${parent}\x1f2026-02-01T10:00:00Z\x1fAnn\x1fann@example.com\x1fa\x1fb\0`;
    expect(parseGitLog(odd)[0]?.subject).toBe('a\x1fb');
    expect(parseGitLog(`\x1e${sha}\x1f${parent}\x1f2026-02-01T10:00:00Z\x1fAnn\x1f\x1f\0`)[0]).toMatchObject({ authorEmail: '', subject: '' });
  });

  it('rejects a header with the wrong number of fields', () => {
    expect(() => parseGitLog(`\x1e${sha}\x1f${parent}\x1fAnn\0`)).toThrow(GitLogParseError);
  });

  it('rejects a header that is never terminated', () => {
    expect(() => parseGitLog(header)).toThrow(GitLogParseError);
  });

  it('rejects a bad sha', () => {
    expect(() => parseGitLog(`\x1enot-a-sha\x1f\x1f2026-02-01T10:00:00Z\x1fAnn\x1fa@b.c\x1fs\0`)).toThrow(
      GitLogParseError,
    );
  });

  it('rejects an unparseable date', () => {
    expect(() => parseGitLog(`\x1e${sha}\x1f\x1fyesterday\x1fAnn\x1fa@b.c\x1fs\0`)).toThrow(GitLogParseError);
  });

  it('rejects an unknown status letter', () => {
    expect(() => parseGitLog(`${header}\0\nX\0x.ts\0`)).toThrow(GitLogParseError);
  });

  it('rejects a rename with a missing second path', () => {
    expect(() => parseGitLog(`${header}\0\nR100\0old.ts\0`)).toThrow(GitLogParseError);
  });

  it('rejects entries that are cut off before the final NUL', () => {
    expect(() => parseGitLog(`${header}\0\nA\0a.ts`)).toThrow(GitLogParseError);
  });
});

describe('GIT_LOG_ARGS', () => {
  it('matches the command used to capture the fixture', () => {
    // Keep in sync with test/fixtures/make-git-log-sample.sh.
    expect([...GIT_LOG_ARGS]).toEqual([
      'log',
      '--topo-order',
      '-z',
      '--name-status',
      '-M',
      '--format=%x1e%H%x1f%P%x1f%cI%x1f%an%x1f%ae%x1f%s',
    ]);
  });
});
