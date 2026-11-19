import { describe, expect, it } from 'vitest';
import type { Graveyard } from '../../../shared/graveyard-schema';
import { toJson } from './serialise';

function sample(): Graveyard {
  return {
    meta: {
      name: 'demo',
      snapshotSha: 'a'.repeat(40),
      snapshotDate: '2026-03-01T12:00:00.000Z',
      analysedAt: '2026-03-02T09:30:00.000Z',
      schemaVersion: 2,
      thresholds: { staleAfterDays: 90, ancientAfterDays: 360, decayCapDays: 720, hotCommits: 5, hotWindowDays: 30 },
    },
    folders: [
      { path: '', parent: null },
      { path: 'src', parent: '' },
    ],
    files: [
      {
        path: 'src/a.ts',
        folder: 'src',
        linesOfCode: 5,
        lastCommitDate: '2026-02-01T00:00:00.000Z',
        lastCommitAuthor: 'Ann "the" Author',
        recentCommits: 1,
        unused: false,
        decayScore: 0.0222,
        decayState: 'fresh',
        hot: false,
        eulogy: '',
      },
    ],
    ghosts: [
      {
        path: 'gone.ts',
        deletedInSha: 'b'.repeat(40),
        deletedDate: '2025-01-01T00:00:00.000Z',
        deletedBy: 'Bob',
        lastExistingSha: 'c'.repeat(40),
      },
    ],
  };
}

/** The same object with the keys of every object in reverse insertion order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

describe('toJson', () => {
  const text = toJson(sample());

  it('ends with exactly one newline', () => {
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('indents with two spaces and uses LF line endings', () => {
    expect(text).toContain('\n  "meta": {\n    "name": "demo",');
    expect(text).not.toContain('\r');
    expect(text).not.toContain('\t');
  });

  it('writes the top-level keys in schema order', () => {
    const order = [...text.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    expect(order).toEqual(['meta', 'folders', 'files', 'ghosts']);
  });

  it('writes file keys in schema order', () => {
    const fileBlock = text.slice(text.indexOf('"files"'), text.indexOf('"ghosts"'));
    const keys = [...fileBlock.matchAll(/^ {6}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'path',
      'folder',
      'linesOfCode',
      'lastCommitDate',
      'lastCommitAuthor',
      'recentCommits',
      'unused',
      'decayScore',
      'decayState',
      'hot',
      'eulogy',
    ]);
  });

  it('writes the metadata keys in schema order, with the thresholds last', () => {
    const metaBlock = text.slice(text.indexOf('"meta"'), text.indexOf('"folders"'));
    const keys = [...metaBlock.matchAll(/^ {4}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual(['name', 'snapshotSha', 'snapshotDate', 'analysedAt', 'schemaVersion', 'thresholds']);
  });

  it('writes the threshold keys in schema order', () => {
    const block = text.slice(text.indexOf('"thresholds"'), text.indexOf('"folders"'));
    const keys = [...block.matchAll(/^ {6}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual(['staleAfterDays', 'ancientAfterDays', 'decayCapDays', 'hotCommits', 'hotWindowDays']);
  });

  it('writes the root folder parent as null, not omitted', () => {
    expect(text).toContain('"parent": null');
  });

  it('gives the same text whatever order the keys were added in', () => {
    expect(toJson(reverseKeys(sample()) as Graveyard)).toBe(text);
  });

  it('round-trips through JSON.parse', () => {
    expect(JSON.parse(text)).toEqual(sample());
  });

  it('escapes quotes in names', () => {
    expect(text).toContain('"lastCommitAuthor": "Ann \\"the\\" Author"');
  });

  it('writes an empty graveyard compactly but validly', () => {
    const empty: Graveyard = { ...sample(), folders: [{ path: '', parent: null }], files: [], ghosts: [] };
    const out = toJson(empty);
    expect(out).toContain('"files": []');
    expect(out).toContain('"ghosts": []');
    expect(JSON.parse(out)).toEqual(empty);
  });
});
