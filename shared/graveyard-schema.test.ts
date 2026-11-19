import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, validateGraveyard, type Graveyard } from './graveyard-schema';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function validGraveyard(): Graveyard {
  return {
    meta: {
      name: 'demo',
      snapshotSha: SHA_A,
      snapshotDate: '2026-03-01T12:00:00.000Z',
      analysedAt: '2026-03-02T09:30:00.000Z',
      schemaVersion: SCHEMA_VERSION,
    },
    folders: [
      { path: '', parent: null },
      { path: 'src', parent: '' },
      { path: 'src/lib', parent: 'src' },
    ],
    files: [
      {
        path: 'src/lib/old.ts',
        folder: 'src/lib',
        linesOfCode: 120,
        lastCommitDate: '2024-11-05T08:00:00.000Z',
        lastCommitAuthor: 'Ann Author',
        commitsLast30Days: 0,
        unused: true,
        decayScore: 0.8,
        decayState: 'ancient',
        hot: false,
        eulogy: '',
      },
      {
        path: 'index.ts',
        folder: '',
        linesOfCode: 12,
        lastCommitDate: '2026-02-27T08:00:00.000Z',
        lastCommitAuthor: 'Bob',
        commitsLast30Days: 6,
        unused: false,
        decayScore: 0.0021,
        decayState: 'fresh',
        hot: true,
        eulogy: '',
      },
    ],
    ghosts: [
      {
        path: 'src/gone.ts',
        deletedInSha: SHA_A,
        deletedDate: '2025-06-01T10:00:00.000Z',
        deletedBy: 'Bob',
        lastExistingSha: SHA_B,
      },
    ],
  };
}

/** Applies a change to a fresh valid graveyard and returns the validator's errors. */
function errorsAfter(change: (g: Graveyard) => void): string[] {
  const g = validGraveyard();
  change(g);
  const result = validateGraveyard(g);
  return result.ok ? [] : result.errors;
}

describe('validateGraveyard', () => {
  it('accepts a valid graveyard', () => {
    expect(validateGraveyard(validGraveyard())).toEqual({ ok: true });
  });

  it('accepts an empty repo with only the root folder', () => {
    const g = validGraveyard();
    g.folders = [{ path: '', parent: null }];
    g.files = [];
    g.ghosts = [];
    expect(validateGraveyard(g)).toEqual({ ok: true });
  });

  it('accepts a 64-character (SHA-256) commit id', () => {
    const g = validGraveyard();
    g.meta.snapshotSha = 'c'.repeat(64);
    expect(validateGraveyard(g)).toEqual({ ok: true });
  });

  it.each([null, undefined, 42, 'text', [], true])('rejects %j as a graveyard', (value) => {
    expect(validateGraveyard(value).ok).toBe(false);
  });

  describe('meta', () => {
    it('rejects a missing meta', () => {
      expect(errorsAfter((g) => Reflect.deleteProperty(g, 'meta'))).toContain('meta must be an object');
    });

    it('rejects a wrong schema version', () => {
      expect(errorsAfter((g) => (g.meta.schemaVersion = SCHEMA_VERSION + 1))).toEqual([
        `meta.schemaVersion must be ${SCHEMA_VERSION}`,
      ]);
    });

    it('rejects a short or non-hex snapshot SHA', () => {
      expect(errorsAfter((g) => (g.meta.snapshotSha = 'abc123')).length).toBe(1);
      expect(errorsAfter((g) => (g.meta.snapshotSha = 'Z'.repeat(40))).length).toBe(1);
    });

    it.each([
      '2026-03-01',
      '2026-03-01T12:00:00Z',
      '2026-03-01T12:00:00.000+05:30',
      '2026-02-30T12:00:00.000Z',
      'yesterday',
    ])('rejects the date %s', (date) => {
      expect(errorsAfter((g) => (g.meta.snapshotDate = date))).toEqual([
        'meta.snapshotDate must be an ISO 8601 UTC date',
      ]);
    });
  });

  describe('folders', () => {
    it('rejects a file whose folder is not in the list', () => {
      const errors = errorsAfter((g) => (g.files[0]!.folder = 'nowhere'));
      expect(errors).toEqual(['files[0].folder "nowhere" is not in the folder list']);
    });

    it('rejects a parent that is not in the list', () => {
      const errors = errorsAfter((g) => (g.folders[2]!.parent = 'missing'));
      expect(errors.some((e) => e.includes('"missing"'))).toBe(true);
    });

    it('rejects a missing root', () => {
      const errors = errorsAfter((g) => (g.folders = g.folders.filter((f) => f.path !== '')));
      expect(errors.some((e) => e.includes('exactly one root'))).toBe(true);
    });

    it('rejects two roots', () => {
      const errors = errorsAfter((g) => g.folders.push({ path: 'other', parent: null }));
      expect(errors.some((e) => e.includes('exactly one root'))).toBe(true);
    });

    it('rejects a cycle between folders', () => {
      const errors = errorsAfter((g) => {
        g.folders[1]!.parent = 'src/lib';
      });
      expect(errors.some((e) => e.includes('cycle'))).toBe(true);
    });

    it('rejects a folder that is its own parent', () => {
      const errors = errorsAfter((g) => {
        g.folders[1]!.parent = 'src';
      });
      expect(errors.some((e) => e.includes('cycle'))).toBe(true);
    });

    it('rejects a duplicate folder path', () => {
      const errors = errorsAfter((g) => g.folders.push({ path: 'src', parent: '' }));
      expect(errors.some((e) => e.includes('duplicate folder path'))).toBe(true);
    });
  });

  describe('files', () => {
    it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects a decay score of %s', (score) => {
      expect(errorsAfter((g) => (g.files[0]!.decayScore = score))).toEqual([
        'files[0].decayScore must be a number from 0 to 1',
      ]);
    });

    it('accepts scores of exactly 0 and 1', () => {
      expect(errorsAfter((g) => (g.files[0]!.decayScore = 0))).toEqual([]);
      expect(errorsAfter((g) => (g.files[0]!.decayScore = 1))).toEqual([]);
    });

    it('rejects an unknown decay state', () => {
      const errors = errorsAfter((g) => Reflect.set(g.files[0]!, 'decayState', 'rotten'));
      expect(errors).toEqual(['files[0].decayState must be one of fresh, stale, ancient']);
    });

    it.each([-1, 1.5, Number.NaN])('rejects %s lines of code', (loc) => {
      expect(errorsAfter((g) => (g.files[0]!.linesOfCode = loc))).toEqual([
        'files[0].linesOfCode must be a whole number, 0 or more',
      ]);
    });

    it('rejects a negative commit count', () => {
      expect(errorsAfter((g) => (g.files[0]!.commitsLast30Days = -1)).length).toBe(1);
    });

    it('rejects non-boolean flags', () => {
      expect(errorsAfter((g) => Reflect.set(g.files[0]!, 'unused', 'yes'))).toEqual([
        'files[0].unused must be a boolean',
      ]);
      expect(errorsAfter((g) => Reflect.set(g.files[0]!, 'hot', 1))).toEqual([
        'files[0].hot must be a boolean',
      ]);
    });

    it('rejects a missing eulogy field', () => {
      expect(errorsAfter((g) => Reflect.deleteProperty(g.files[0]!, 'eulogy'))).toEqual([
        'files[0].eulogy must be a string',
      ]);
    });

    it('rejects a duplicate file path', () => {
      const errors = errorsAfter((g) => (g.files[1]!.path = g.files[0]!.path));
      expect(errors.some((e) => e.includes('duplicate file path'))).toBe(true);
    });
  });

  describe('ghosts', () => {
    it('rejects a path that is both a file and a ghost', () => {
      const errors = errorsAfter((g) => (g.ghosts[0]!.path = 'index.ts'));
      expect(errors).toEqual(['ghosts[0]: "index.ts" is both a current file and a ghost']);
    });

    it('rejects a duplicate ghost path', () => {
      const errors = errorsAfter((g) => g.ghosts.push({ ...g.ghosts[0]! }));
      expect(errors.some((e) => e.includes('duplicate ghost path'))).toBe(true);
    });

    it('rejects a bad last existing SHA', () => {
      expect(errorsAfter((g) => (g.ghosts[0]!.lastExistingSha = 'HEAD~1'))).toEqual([
        'ghosts[0].lastExistingSha must be a full commit SHA',
      ]);
    });

    it('rejects a bad deletion date', () => {
      expect(errorsAfter((g) => (g.ghosts[0]!.deletedDate = '2025-06-01')).length).toBe(1);
    });
  });

  it('reports every problem, not just the first', () => {
    const errors = errorsAfter((g) => {
      g.meta.schemaVersion = 99;
      g.files[0]!.decayScore = 2;
      Reflect.set(g.ghosts[0]!, 'deletedBy', 1);
    });
    expect(errors).toHaveLength(3);
  });

  it('stops collecting at 50 errors', () => {
    const g = validGraveyard();
    g.files = Array.from({ length: 100 }, (_, i) => ({
      ...g.files[0]!,
      path: `f${i}.ts`,
      decayScore: 5,
    }));
    const result = validateGraveyard(g);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(50);
  });
});
