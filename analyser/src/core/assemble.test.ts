import { describe, expect, it } from 'vitest';
import { validateGraveyard } from '../../../shared/graveyard-schema';
import { AssembleError, assembleGraveyard, type AssembleInput } from './assemble';
import type { FileHistory } from './history';
import { DEFAULT_THRESHOLDS, thresholdsFrom } from './thresholds';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

function history(lastCommitDate: string, recentCommits = 0, lastCommitAuthor = 'Ann'): FileHistory {
  return { lastCommitDate, lastCommitAuthor, recentCommits, lastCommitSubject: 'fix the thing' };
}

function sampleInput(): AssembleInput {
  return {
    repoName: 'demo',
    snapshotSha: SHA_A,
    snapshotDate: '2026-03-01T12:00:00.000Z',
    analysedAt: '2026-03-02T15:00:00+05:30',
    thresholds: DEFAULT_THRESHOLDS,
    files: [
      { path: 'src/old.ts', linesOfCode: 100 },
      { path: 'index.ts', linesOfCode: 12 },
      { path: 'src/lib/mid.ts', linesOfCode: 40 },
    ],
    history: new Map([
      ['src/old.ts', history('2024-11-05T08:00:00.000Z', 0, 'Bob')], // 481 days old
      ['index.ts', history('2026-02-27T08:00:00.000Z', 6)], // 2 days old, 6 recent commits
      ['src/lib/mid.ts', history('2025-10-01T12:00:00.000Z')], // exactly 151 days old
    ]),
    unused: new Set(['src/old.ts', 'not/a/current/file.ts']),
    ghosts: [
      { path: 'z/gone.ts', deletedInSha: SHA_B, deletedDate: '2025-06-01T10:00:00.000Z', deletedBy: 'Bob', lastExistingSha: SHA_C, deletedSubject: 'remove gone' },
      { path: 'a/lost.js', deletedInSha: SHA_C, deletedDate: '2025-07-01T10:00:00.000Z', deletedBy: 'Cy', lastExistingSha: SHA_B, deletedSubject: 'remove lost' },
    ],
  };
}

describe('assembleGraveyard', () => {
  const g = assembleGraveyard(sampleInput());

  it('writes the metadata, with dates in UTC and the schema version', () => {
    expect(g.meta).toEqual({
      name: 'demo',
      snapshotSha: SHA_A,
      snapshotDate: '2026-03-01T12:00:00.000Z',
      analysedAt: '2026-03-02T09:30:00.000Z',
      schemaVersion: 2,
      thresholds: { staleAfterDays: 90, ancientAfterDays: 360, decayCapDays: 720, hotCommits: 5, hotWindowDays: 30 },
    });
  });

  it('sorts files by path', () => {
    expect(g.files.map((f) => f.path)).toEqual(['index.ts', 'src/lib/mid.ts', 'src/old.ts']);
  });

  it('scores a fresh, hot, used file', () => {
    expect(g.files[0]).toEqual({
      path: 'index.ts',
      folder: '',
      linesOfCode: 12,
      lastCommitDate: '2026-02-27T08:00:00.000Z',
      lastCommitAuthor: 'Ann',
      recentCommits: 6,
      unused: false,
      decayScore: 0.0011,
      decayState: 'fresh',
      hot: true,
      eulogy: '',
    });
  });

  it('scores a stale used file from its age at the snapshot', () => {
    expect(g.files[1]).toMatchObject({ decayState: 'stale', decayScore: 0.0839, unused: false, hot: false });
  });

  it('scores an ancient unused file with the unused weight', () => {
    expect(g.files[2]).toMatchObject({
      path: 'src/old.ts',
      folder: 'src',
      unused: true,
      decayState: 'ancient',
      decayScore: 0.8672,
      lastCommitAuthor: 'Bob',
    });
  });

  it('ignores unused paths that are not current files', () => {
    expect(g.files.filter((f) => f.unused).map((f) => f.path)).toEqual(['src/old.ts']);
  });

  it('derives the folders from the files', () => {
    expect(g.folders).toEqual([
      { path: '', parent: null },
      { path: 'src', parent: '' },
      { path: 'src/lib', parent: 'src' },
    ]);
  });

  it('sorts ghosts by path and keeps their fields', () => {
    expect(g.ghosts.map((x) => x.path)).toEqual(['a/lost.js', 'z/gone.ts']);
    expect(g.ghosts[1]).toEqual({
      path: 'z/gone.ts',
      deletedInSha: SHA_B,
      deletedDate: '2025-06-01T10:00:00.000Z',
      deletedBy: 'Bob',
      lastExistingSha: SHA_C,
    });
  });

  it('leaves every eulogy empty', () => {
    expect(g.files.every((f) => f.eulogy === '')).toBe(true);
  });

  it('produces data that passes the shared schema validator', () => {
    expect(validateGraveyard(g)).toEqual({ ok: true });
  });

  it('works for a repo with no files and no ghosts', () => {
    const empty = assembleGraveyard({ ...sampleInput(), files: [], history: new Map(), unused: new Set(), ghosts: [] });
    expect(empty.files).toEqual([]);
    expect(empty.folders).toEqual([{ path: '', parent: null }]);
    expect(validateGraveyard(empty)).toEqual({ ok: true });
  });

  it('measures age from the snapshot date, not from when the analyser ran', () => {
    const later = assembleGraveyard({ ...sampleInput(), analysedAt: '2030-01-01T00:00:00.000Z' });
    expect(later.files).toEqual(g.files);
    expect(later.folders).toEqual(g.folders);
    expect(later.ghosts).toEqual(g.ghosts);
    expect(later.meta.analysedAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('scores with the thresholds it is given, and records them in the metadata', () => {
    // Ages at the snapshot: index.ts 2 days, src/lib/mid.ts 151, src/old.ts 481.
    const t = thresholdsFrom({ staleAfterDays: 1, ancientAfterDays: 150, hotCommits: 7, hotWindowDays: 14 });
    const custom = assembleGraveyard({ ...sampleInput(), thresholds: t });

    expect(custom.meta.thresholds).toEqual({ staleAfterDays: 1, ancientAfterDays: 150, decayCapDays: 300, hotCommits: 7, hotWindowDays: 14 });
    expect(custom.files.map((f) => f.decayState)).toEqual(['stale', 'ancient', 'ancient']); // 2 days, 151, 481
    expect(custom.files[1]?.decayScore).toBe(0.2013); // 0.4 * 151 / 300
    expect(custom.files[2]?.decayScore).toBe(1); // unused, past the 300-day cap: 0.6 + 0.4
    expect(custom.files[0]?.hot).toBe(false); // 6 recent commits, but 7 are needed
    expect(validateGraveyard(custom)).toEqual({ ok: true });
  });

  it('marks a file hot by the configured number of commits', () => {
    const t = thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 6, hotWindowDays: 30 });
    expect(assembleGraveyard({ ...sampleInput(), thresholds: t }).files[0]?.hot).toBe(true);
  });

  it('does not change its input', () => {
    const input = sampleInput();
    const before = JSON.stringify({ ...input, history: [...input.history], unused: [...input.unused] });
    assembleGraveyard(input);
    expect(JSON.stringify({ ...input, history: [...input.history], unused: [...input.unused] })).toBe(before);
  });

  it('throws when a current file has no history', () => {
    const input = sampleInput();
    input.history = new Map([['index.ts', history('2026-02-27T08:00:00.000Z')]]);
    expect(() => assembleGraveyard(input)).toThrow(AssembleError);
    expect(() => assembleGraveyard(input)).toThrow(/src\/old\.ts|src\/lib\/mid\.ts/);
  });

  it.each(['snapshotDate', 'analysedAt'] as const)('throws on an invalid %s', (field) => {
    expect(() => assembleGraveyard({ ...sampleInput(), [field]: 'yesterday' })).toThrow(AssembleError);
  });

  it('treats a last commit dated after the snapshot as age 0', () => {
    const input = sampleInput();
    input.history = new Map(
      input.files.map((f) => [f.path, history('2026-04-01T00:00:00.000Z')] as [string, FileHistory]),
    );
    const result = assembleGraveyard(input);
    expect(result.files.map((f) => f.decayState)).toEqual(['fresh', 'fresh', 'fresh']);
    expect(result.files.find((f) => f.path === 'index.ts')?.decayScore).toBe(0);
  });
});

describe('the commit subjects (eulogies spec)', () => {
  it('never reach the data: neither a file\'s last subject nor a ghost\'s deleting subject is in the graveyard', () => {
    const text = JSON.stringify(assembleGraveyard(sampleInput()));
    expect(text).not.toContain('fix the thing');
    expect(text).not.toContain('remove gone');
    expect(text).not.toContain('Subject');
  });
});

