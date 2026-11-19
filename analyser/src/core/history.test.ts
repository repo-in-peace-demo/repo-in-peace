import { describe, expect, it } from 'vitest';
import type { Change, CommitRecord } from './commit-record';
import { MS_PER_DAY } from './decay';
import { HistoryError, analyseHistory } from './history';

const S = Date.parse('2026-03-01T12:00:00.000Z'); // snapshot
const ago = (days: number): number => S - days * MS_PER_DAY;
const iso = (ms: number): string => new Date(ms).toISOString();
const sha = (n: number): string => n.toString(16).padStart(40, '0');

interface Spec {
  at: number;
  author?: string;
  changes: Change[];
}

/** Specs oldest first. Returns CommitRecords newest first, in a straight line; commit k (1-based) has sha(k). */
function linear(...specs: Spec[]): CommitRecord[] {
  return specs
    .map((spec, i) => ({
      sha: sha(i + 1),
      parents: i === 0 ? [] : [sha(i)],
      date: iso(spec.at),
      author: spec.author ?? 'Ann',
      changes: spec.changes,
    }))
    .reverse();
}

const add = (path: string): Change => ({ kind: 'add', path });
const modify = (path: string): Change => ({ kind: 'modify', path });
const del = (path: string): Change => ({ kind: 'delete', path });
const rename = (oldPath: string, path: string): Change => ({ kind: 'rename', oldPath, path });

const run = (commits: CommitRecord[], ...current: string[]) =>
  analyseHistory({ commits, currentPaths: new Set(current), snapshotMs: S });

describe('last commit and the 30-day count', () => {
  it('takes the date and author of the latest commit that touched the file', () => {
    const { perFile } = run(
      linear(
        { at: ago(100), author: 'Ann', changes: [add('a.ts')] },
        { at: ago(50), author: 'Bob', changes: [modify('a.ts')] },
      ),
      'a.ts',
    );
    expect(perFile.get('a.ts')).toEqual({
      lastCommitDate: iso(ago(50)),
      lastCommitAuthor: 'Bob',
      commitsLast30Days: 0,
    });
  });

  it('counts commits after snapshot − 30 days and up to the snapshot', () => {
    const { perFile } = run(
      linear(
        { at: ago(200), changes: [add('a.ts')] },
        { at: ago(40), changes: [modify('a.ts')] }, // outside
        { at: ago(31), changes: [modify('a.ts')] }, // outside
        { at: ago(30), changes: [modify('a.ts')] }, // exactly 30 days before: outside
        { at: ago(30) + 1, changes: [modify('a.ts')] }, // 1 ms inside
        { at: ago(29), changes: [modify('a.ts')] },
        { at: ago(10), changes: [modify('a.ts')] },
        { at: ago(0), changes: [modify('a.ts')] }, // exactly at the snapshot: inside
        { at: S + MS_PER_DAY, changes: [modify('a.ts')] }, // after the snapshot: outside
      ),
      'a.ts',
    );
    expect(perFile.get('a.ts')?.commitsLast30Days).toBe(4);
  });

  it('still reports a commit dated after the snapshot as the last commit', () => {
    const { perFile } = run(
      linear(
        { at: ago(10), changes: [add('a.ts')] },
        { at: S + MS_PER_DAY, author: 'Bob', changes: [modify('a.ts')] },
      ),
      'a.ts',
    );
    expect(perFile.get('a.ts')).toMatchObject({ lastCommitDate: iso(S + MS_PER_DAY), lastCommitAuthor: 'Bob' });
  });

  it('counts a commit once even if it lists the file twice', () => {
    const { perFile } = run(
      linear({ at: ago(5), changes: [add('a.ts'), modify('a.ts')] }),
      'a.ts',
    );
    expect(perFile.get('a.ts')?.commitsLast30Days).toBe(1);
  });

  it('ignores commits with no changes, such as merges', () => {
    const base = linear({ at: ago(5), changes: [add('a.ts')] });
    const merge: CommitRecord = {
      sha: sha(9),
      parents: [sha(1), sha(8)],
      date: iso(ago(1)),
      author: 'Zed',
      changes: [],
    };
    const { perFile } = run([merge, ...base], 'a.ts');
    expect(perFile.get('a.ts')).toMatchObject({ lastCommitDate: iso(ago(5)), commitsLast30Days: 1 });
  });

  it('uses the latest date, not the log position, when branch commits are out of date order', () => {
    // Log order (newest first): the commit listed first is dated 20 days ago, the next 5 days ago.
    const commits: CommitRecord[] = [
      { sha: sha(3), parents: [sha(2)], date: iso(ago(20)), author: 'Bob', changes: [modify('a.ts')] },
      { sha: sha(2), parents: [sha(1)], date: iso(ago(5)), author: 'Cy', changes: [modify('a.ts')] },
      { sha: sha(1), parents: [], date: iso(ago(40)), author: 'Ann', changes: [add('a.ts')] },
    ];
    const { perFile } = run(commits, 'a.ts');
    expect(perFile.get('a.ts')).toEqual({
      lastCommitDate: iso(ago(5)),
      lastCommitAuthor: 'Cy',
      commitsLast30Days: 2,
    });
  });

  it('on equal dates picks the commit listed first in the log', () => {
    const commits: CommitRecord[] = [
      { sha: sha(3), parents: [sha(2)], date: iso(ago(5)), author: 'First', changes: [modify('a.ts')] },
      { sha: sha(2), parents: [sha(1)], date: iso(ago(5)), author: 'Second', changes: [modify('a.ts')] },
      { sha: sha(1), parents: [], date: iso(ago(40)), author: 'Ann', changes: [add('a.ts')] },
    ];
    expect(run(commits, 'a.ts').perFile.get('a.ts')?.lastCommitAuthor).toBe('First');
  });

  it('throws, naming the file, when a current file has no commit in the log', () => {
    expect(() => run([], 'x.ts')).toThrow(HistoryError);
    expect(() => run([], 'x.ts')).toThrow(/x\.ts/);
  });
});

describe('renames', () => {
  it('keeps earlier history with the file under its new name', () => {
    const { perFile, ghosts } = run(
      linear(
        { at: ago(20), changes: [add('a.ts')] },
        { at: ago(15), changes: [modify('a.ts')] },
        { at: ago(10), changes: [rename('a.ts', 'b.ts')] },
      ),
      'b.ts',
    );
    expect(perFile.get('b.ts')).toMatchObject({ lastCommitDate: iso(ago(10)), commitsLast30Days: 3 });
    expect(ghosts).toEqual([]); // a.ts moved, it did not die
  });

  it('counts only the commits inside the window when the rename is old', () => {
    const { perFile } = run(
      linear(
        { at: ago(100), changes: [add('a.ts')] },
        { at: ago(60), changes: [rename('a.ts', 'b.ts')] },
        { at: ago(5), changes: [modify('b.ts')] },
      ),
      'b.ts',
    );
    expect(perFile.get('b.ts')).toMatchObject({ lastCommitDate: iso(ago(5)), commitsLast30Days: 1 });
  });

  it('follows a chain of renames', () => {
    const { perFile } = run(
      linear(
        { at: ago(25), changes: [add('a.ts')] },
        { at: ago(20), changes: [rename('a.ts', 'b.ts')] },
        { at: ago(15), changes: [rename('b.ts', 'c.ts')] },
      ),
      'c.ts',
    );
    expect(perFile.get('c.ts')?.commitsLast30Days).toBe(3);
  });

  it('keeps both files right when a commit renames a.ts and creates a new a.ts', () => {
    const { perFile, ghosts } = run(
      linear(
        { at: ago(10), changes: [add('a.ts')] },
        { at: ago(5), changes: [rename('a.ts', 'b.ts'), add('a.ts')] },
      ),
      'a.ts',
      'b.ts',
    );
    expect(perFile.get('b.ts')?.commitsLast30Days).toBe(2); // the original add, then the rename
    expect(perFile.get('a.ts')?.commitsLast30Days).toBe(1); // only the new file's add
    expect(ghosts).toEqual([]);
  });

  it('follows history back through a name the graveyard would not show', () => {
    const { perFile } = run(
      linear(
        { at: ago(20), changes: [add('README.md')] },
        { at: ago(10), changes: [rename('README.md', 'src/readme.ts')] },
      ),
      'src/readme.ts',
    );
    expect(perFile.get('src/readme.ts')?.commitsLast30Days).toBe(2);
  });
});

describe('ghosts', () => {
  it('makes a ghost of a deleted file, with the deleting commit and its first parent', () => {
    const { ghosts } = run(
      linear(
        { at: ago(100), author: 'Ann', changes: [add('gone.ts')] },
        { at: ago(80), author: 'Bob', changes: [del('gone.ts')] },
      ),
    );
    expect(ghosts).toEqual([
      {
        path: 'gone.ts',
        deletedInSha: sha(2),
        deletedDate: iso(ago(80)),
        deletedBy: 'Bob',
        lastExistingSha: sha(1),
      },
    ]);
  });

  it('after a rename then a delete, makes a ghost of the new name only', () => {
    const { ghosts } = run(
      linear(
        { at: ago(100), changes: [add('a.ts')] },
        { at: ago(90), changes: [rename('a.ts', 'b.ts')] },
        { at: ago(80), changes: [del('b.ts')] },
      ),
    );
    expect(ghosts.map((g) => g.path)).toEqual(['b.ts']);
    expect(ghosts[0]).toMatchObject({ deletedInSha: sha(3), lastExistingSha: sha(2) });
  });

  it('makes no ghost of a file that was deleted and added back', () => {
    const { perFile, ghosts } = run(
      linear(
        { at: ago(25), changes: [add('a.ts')] },
        { at: ago(20), changes: [del('a.ts')] },
        { at: ago(5), author: 'Cy', changes: [add('a.ts')] },
      ),
      'a.ts',
    );
    expect(ghosts).toEqual([]);
    // Only the new life of the file counts, not the one before the deletion.
    expect(perFile.get('a.ts')).toMatchObject({ commitsLast30Days: 1, lastCommitAuthor: 'Cy' });
  });

  it('uses the most recent deletion when a path was deleted more than once', () => {
    const { ghosts } = run(
      linear(
        { at: ago(100), changes: [add('a.ts')] },
        { at: ago(90), changes: [del('a.ts')] },
        { at: ago(80), changes: [add('a.ts')] },
        { at: ago(70), changes: [del('a.ts')] },
      ),
    );
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ deletedInSha: sha(4), lastExistingSha: sha(3) });
  });

  it('picks the deletion listed first in the log even when its date is older', () => {
    // Chain: addX -> delX -> addY -> delY. Dates run backwards along the chain.
    const commits: CommitRecord[] = [
      { sha: sha(4), parents: [sha(3)], date: iso(ago(80)), author: 'Y', changes: [del('a.ts')] },
      { sha: sha(3), parents: [sha(2)], date: iso(ago(85)), author: 'Y', changes: [add('a.ts')] },
      { sha: sha(2), parents: [sha(1)], date: iso(ago(10)), author: 'X', changes: [del('a.ts')] },
      { sha: sha(1), parents: [], date: iso(ago(15)), author: 'X', changes: [add('a.ts')] },
    ];
    const { ghosts } = run(commits);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ deletedInSha: sha(4), lastExistingSha: sha(3) });
  });

  it('makes no ghost when the most recent removal was a rename away', () => {
    // add, delete, add again, then move to q.ts. p.ts lives on as q.ts.
    const { perFile, ghosts } = run(
      linear(
        { at: ago(28), changes: [add('p.ts')] },
        { at: ago(26), changes: [del('p.ts')] },
        { at: ago(24), changes: [add('p.ts')] },
        { at: ago(22), changes: [rename('p.ts', 'q.ts')] },
      ),
      'q.ts',
    );
    expect(ghosts).toEqual([]);
    expect(perFile.get('q.ts')?.commitsLast30Days).toBe(2); // the second add and the rename
  });

  it('never makes ghosts of paths the graveyard would not show alive', () => {
    const { ghosts } = run(
      linear(
        {
          at: ago(100),
          changes: [add('dist/x.js'), add('README.md'), add('types.d.ts'), add('src/ok.ts'), add('node_modules/p/i.js')],
        },
        {
          at: ago(90),
          changes: [del('dist/x.js'), del('README.md'), del('types.d.ts'), del('src/ok.ts'), del('node_modules/p/i.js')],
        },
      ),
    );
    expect(ghosts.map((g) => g.path)).toEqual(['src/ok.ts']);
  });

  it('never makes a ghost of a current path', () => {
    const { ghosts } = run(
      linear({ at: ago(10), changes: [add('a.ts')] }, { at: ago(5), changes: [modify('a.ts')] }),
      'a.ts',
    );
    expect(ghosts).toEqual([]);
  });

  it('records the first parent as the last existing commit', () => {
    const deleting: CommitRecord = {
      sha: sha(5),
      parents: [sha(4), sha(3)],
      date: iso(ago(10)),
      author: 'Bob',
      changes: [del('a.ts')],
    };
    expect(run([deleting]).ghosts[0]?.lastExistingSha).toBe(sha(4));
  });

  it('throws when a root commit claims to delete a file', () => {
    const impossible: CommitRecord = {
      sha: sha(1),
      parents: [],
      date: iso(ago(10)),
      author: 'Bob',
      changes: [del('a.ts')],
    };
    expect(() => run([impossible])).toThrow(HistoryError);
  });
});
