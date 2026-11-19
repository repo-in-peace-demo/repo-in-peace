import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRepo } from '../../test/make-repo';
import { GIT_LOG_ARGS, parseGitLog } from './git-log-parse';

// Round trip against whatever git is installed: build a real repo from a script,
// run the exact log command the analyser uses, and compare with what the script did.
// The static fixture test guards the byte layout; this guards against git-version drift.

const built = makeRepo([
  {
    kind: 'commit',
    message: 'one',
    author: 'Ann Author',
    date: '2026-01-01T10:00:00+05:30',
    ops: [
      { op: 'write', path: 'a.ts', content: 'export const a = 1;\nexport const a2 = 2;\n' },
      { op: 'write', path: 'sp ace.ts', content: 'export const s = 1;\n' },
      { op: 'write', path: 'src/é.ts', content: 'export const u = 1;\n' },
    ],
  },
  {
    kind: 'commit',
    message: 'two',
    author: 'Bob',
    date: '2026-01-02T10:00:00+00:00',
    ops: [{ op: 'write', path: 'a.ts', content: 'export const a = 1;\nexport const a2 = 3;\n' }],
  },
  {
    kind: 'commit',
    message: 'three: rename',
    author: 'Ann Author',
    date: '2026-01-03T10:00:00-08:00',
    ops: [{ op: 'rename', from: 'a.ts', to: 'b.ts' }],
  },
  {
    kind: 'commit',
    message: 'four: delete',
    author: 'Bob',
    date: '2026-01-04T10:00:00+00:00',
    ops: [{ op: 'delete', path: 'sp ace.ts' }],
  },
  { kind: 'branch', name: 'side' },
  {
    kind: 'commit',
    message: 'side',
    author: 'Cy',
    date: '2026-01-05T10:00:00+00:00',
    ops: [{ op: 'write', path: 'side.ts', content: 'export const side = 1;\n' }],
  },
  { kind: 'checkout', name: 'main' },
  {
    kind: 'commit',
    message: 'mainwork',
    author: 'Di',
    date: '2026-01-06T10:00:00+00:00',
    ops: [{ op: 'write', path: 'main.ts', content: 'export const m = 1;\n' }],
  },
  { kind: 'merge', name: 'side', message: 'merge side', author: 'Ed', date: '2026-01-07T10:00:00+00:00' },
  {
    kind: 'commit',
    message: 'empty',
    author: 'Fy',
    date: '2026-01-08T10:00:00+00:00',
    ops: [],
    allowEmpty: true,
  },
]);

afterAll(() => built.cleanup());

describe('parseGitLog on a live repository', () => {
  const output = execFileSync('git', [...GIT_LOG_ARGS, 'HEAD'], {
    cwd: built.dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const records = parseGitLog(output);
  const bySha = new Map(records.map((r) => [r.sha, r]));
  const [one, two, three, four, side, mainwork, merge, empty] = built.shas;

  it('returns exactly the commits the script made, each once', () => {
    expect(records).toHaveLength(8);
    expect([...bySha.keys()].sort()).toEqual([...built.shas].sort());
  });

  it('puts every commit after its parents (newest first)', () => {
    const position = new Map(records.map((r, i) => [r.sha, i]));
    for (const r of records) {
      for (const parent of r.parents) {
        expect(position.get(parent)).toBeGreaterThan(position.get(r.sha) ?? -1);
      }
    }
  });

  it('reads authors, UTC dates and parents', () => {
    expect(bySha.get(one!)).toMatchObject({
      author: 'Ann Author',
      date: '2026-01-01T04:30:00.000Z',
      parents: [],
    });
    expect(bySha.get(three!)).toMatchObject({ date: '2026-01-03T18:00:00.000Z', parents: [two] });
    expect(bySha.get(merge!)?.parents).toEqual([mainwork, side]);
    expect(bySha.get(empty!)?.parents).toEqual([merge]);
  });

  it('reads the changes each step made', () => {
    expect(bySha.get(one!)?.changes).toEqual([
      { kind: 'add', path: 'a.ts' },
      { kind: 'add', path: 'sp ace.ts' },
      { kind: 'add', path: 'src/é.ts' },
    ]);
    expect(bySha.get(two!)?.changes).toEqual([{ kind: 'modify', path: 'a.ts' }]);
    expect(bySha.get(three!)?.changes).toEqual([{ kind: 'rename', oldPath: 'a.ts', path: 'b.ts' }]);
    expect(bySha.get(four!)?.changes).toEqual([{ kind: 'delete', path: 'sp ace.ts' }]);
    expect(bySha.get(side!)?.changes).toEqual([{ kind: 'add', path: 'side.ts' }]);
    expect(bySha.get(mainwork!)?.changes).toEqual([{ kind: 'add', path: 'main.ts' }]);
    expect(bySha.get(merge!)?.changes).toEqual([]);
    expect(bySha.get(empty!)?.changes).toEqual([]);
  });
});
