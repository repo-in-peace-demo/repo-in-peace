import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRepo, type BuiltRepo } from '../../test/make-repo';
import { AnalyserError } from '../errors';
import {
  assertUsableRepo,
  listTree,
  mapBlobs,
  parseCatFileBatch,
  parseLsTree,
  readLog,
  resolveSnapshot,
} from './git';
import { parseGitLog } from './git-log-parse';

const scratch: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-io-'));
  scratch.push(dir);
  return dir;
};
const repos: BuiltRepo[] = [];
const build = (...args: Parameters<typeof makeRepo>): BuiltRepo => {
  const repo = makeRepo(...args);
  repos.push(repo);
  return repo;
};
afterAll(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const BIG = `${'export const x = 1;\n'.repeat(15_000)}`; // about 300 KB: spans many pipe chunks
const CRLF_TEXT = 'a\r\n\r\n  b\r\nconst é = "ü";\n';

const main = build([
  {
    kind: 'commit',
    message: 'one',
    author: 'Ann',
    date: '2026-01-01T10:00:00+05:30',
    ops: [
      { op: 'write', path: 'index.ts', content: 'export {};\n' },
      { op: 'write', path: 'sp ace.ts', content: CRLF_TEXT },
      { op: 'write', path: 'src/é.ts', content: 'export const u = 1;\n' },
      { op: 'write', path: 'src/copy-of-index.ts', content: 'export {};\n' }, // same blob as index.ts
      { op: 'write', path: 'src/big.ts', content: BIG },
      { op: 'write', path: 'package.json', content: '{"name":"x","knip":{}}\n' },
    ],
  },
  {
    kind: 'commit',
    message: 'two',
    author: 'Bob',
    date: '2026-01-02T10:00:00+00:00',
    ops: [{ op: 'delete', path: 'index.ts' }],
  },
]);

describe('assertUsableRepo', () => {
  it('accepts the root of a normal repository', async () => {
    const info = await assertUsableRepo(main.dir);
    expect(info.root).toBe(realpathSync(main.dir));
    expect(info.name).toBe(basename(realpathSync(main.dir)));
  });

  it('rejects a path that does not exist', async () => {
    await expect(assertUsableRepo(join(tempDir(), 'nope'))).rejects.toThrow(/does not exist/);
  });

  it('rejects a file', async () => {
    await expect(assertUsableRepo(join(main.dir, 'package.json'))).rejects.toThrow(/not a directory/);
  });

  it('rejects a directory that is not a git repository', async () => {
    await expect(assertUsableRepo(tempDir())).rejects.toThrow(/not a git repository/);
  });

  it('rejects a bare repository', async () => {
    const dir = tempDir();
    execFileSync('git', ['init', '--bare', '-q', dir]);
    await expect(assertUsableRepo(dir)).rejects.toThrow(/bare repository/);
  });

  it('rejects a shallow clone and says how to fix it', async () => {
    const target = join(tempDir(), 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${main.dir}`, target], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    await expect(assertUsableRepo(target)).rejects.toThrow(/shallow clone/);
    await expect(assertUsableRepo(target)).rejects.toThrow(/unshallow/);
  });

  it('rejects a subdirectory of a repository', async () => {
    await expect(assertUsableRepo(join(main.dir, 'src'))).rejects.toThrow(/repository root/);
  });

  it('throws AnalyserError, which the CLI reports without a stack trace', async () => {
    await expect(assertUsableRepo(tempDir())).rejects.toBeInstanceOf(AnalyserError);
  });
});

describe('resolveSnapshot', () => {
  it('returns the HEAD commit and its committer date in UTC', async () => {
    const snapshot = await resolveSnapshot(main.dir);
    expect(snapshot).toEqual({ sha: main.shas[1], date: '2026-01-02T10:00:00.000Z' });
  });

  it('rejects a repository with no commits', async () => {
    const empty = build([]);
    await expect(resolveSnapshot(empty.dir)).rejects.toThrow(/no commits/);
  });
});

describe('listTree', () => {
  it('lists every regular file in the snapshot tree, including odd names', async () => {
    const files = await listTree(main.dir, main.shas[1]!);
    expect(files.map((f) => f.path).sort()).toEqual(
      ['package.json', 'sp ace.ts', 'src/big.ts', 'src/copy-of-index.ts', 'src/é.ts'].sort(),
    );
  });

  it('lists the tree as it was at an earlier commit', async () => {
    const files = await listTree(main.dir, main.shas[0]!);
    expect(files.map((f) => f.path)).toContain('index.ts');
  });

  it('gives identical files the same blob', async () => {
    const files = await listTree(main.dir, main.shas[0]!);
    const blobOf = (path: string) => files.find((f) => f.path === path)?.blobSha;
    expect(blobOf('index.ts')).toBe(blobOf('src/copy-of-index.ts'));
  });
});

describe('parseLsTree', () => {
  const sha = 'a'.repeat(40);
  const entry = (mode: string, type: string, path: string) => `${mode} ${type} ${sha}\t${path}\0`;

  it('keeps regular and executable files', () => {
    const text = entry('100644', 'blob', 'a.ts') + entry('100755', 'blob', 'run.sh');
    expect(parseLsTree(text).map((f) => f.path)).toEqual(['a.ts', 'run.sh']);
  });

  it('skips symlinks and submodules', () => {
    const text = entry('120000', 'blob', 'link.ts') + entry('160000', 'commit', 'vendor/sub') + entry('100644', 'blob', 'ok.ts');
    expect(parseLsTree(text).map((f) => f.path)).toEqual(['ok.ts']);
  });

  it('keeps tabs, spaces and newlines inside a path', () => {
    expect(parseLsTree(entry('100644', 'blob', 'a b\tc\nd.ts')).map((f) => f.path)).toEqual(['a b\tc\nd.ts']);
  });

  it('accepts an empty tree and rejects garbage', () => {
    expect(parseLsTree('')).toEqual([]);
    expect(() => parseLsTree('not a tree entry\0')).toThrow(AnalyserError);
  });
});

describe('mapBlobs', () => {
  const decode = (content: Uint8Array): string => new TextDecoder().decode(content);

  it('reads file contents exactly, including CRLF, non-ASCII and a large blob', async () => {
    const files = await listTree(main.dir, main.shas[1]!);
    const texts = await mapBlobs(main.dir, files.map((f) => f.blobSha), decode);
    const textOf = (path: string) => texts.get(files.find((f) => f.path === path)!.blobSha);

    expect(textOf('sp ace.ts')).toBe(CRLF_TEXT);
    expect(textOf('src/big.ts')).toBe(BIG);
    expect(textOf('src/é.ts')).toBe('export const u = 1;\n');
  });

  it('reads identical blobs once', async () => {
    const files = await listTree(main.dir, main.shas[0]!);
    const same = files.filter((f) => f.path === 'index.ts' || f.path === 'src/copy-of-index.ts');
    const texts = await mapBlobs(main.dir, same.map((f) => f.blobSha), decode);
    expect(texts.size).toBe(1);
  });

  it('returns an empty map for no blobs without starting git', async () => {
    expect((await mapBlobs(main.dir, [], decode)).size).toBe(0);
  });

  it('keeps only what reduce returns', async () => {
    const files = await listTree(main.dir, main.shas[1]!);
    const lengths = await mapBlobs(main.dir, files.map((f) => f.blobSha), (c) => c.length);
    expect(lengths.get(files.find((f) => f.path === 'src/big.ts')!.blobSha)).toBe(BIG.length);
  });

  it('rejects an object that does not exist', async () => {
    await expect(mapBlobs(main.dir, ['0'.repeat(40)], decode)).rejects.toThrow(AnalyserError);
  });
});

describe('parseCatFileBatch', () => {
  const sha1 = '1'.repeat(40);
  const sha2 = '2'.repeat(40);
  const text = (s: string) => new TextEncoder().encode(s);
  const decode = (c: Uint8Array) => new TextDecoder().decode(c);

  it('reads consecutive objects, including empty ones and ones containing newlines', () => {
    const out = text(`${sha1} blob 5\nab\ncd\n${sha2} blob 0\n\n`);
    const map = parseCatFileBatch(out, [sha1, sha2], decode);
    expect(map.get(sha1)).toBe('ab\ncd');
    expect(map.get(sha2)).toBe('');
  });

  it('rejects a missing object, a mismatched answer, a non-blob and truncated output', () => {
    expect(() => parseCatFileBatch(text(`${sha1} missing\n`), [sha1], decode)).toThrow(/no object/);
    expect(() => parseCatFileBatch(text(`${sha2} blob 0\n\n`), [sha1], decode)).toThrow(AnalyserError);
    expect(() => parseCatFileBatch(text(`${sha1} tree 0\n\n`), [sha1], decode)).toThrow(AnalyserError);
    expect(() => parseCatFileBatch(text(`${sha1} blob 50\nshort\n`), [sha1], decode)).toThrow(/cut off/);
    expect(() => parseCatFileBatch(text(''), [sha1], decode)).toThrow(/ended early/);
  });
});

describe('readLog', () => {
  it('returns the log that parseGitLog reads, newest first', async () => {
    const records = parseGitLog(await readLog(main.dir, main.shas[1]!));
    expect(records.map((r) => r.sha)).toEqual([main.shas[1], main.shas[0]]);
    expect(records[0]?.changes).toEqual([{ kind: 'delete', path: 'index.ts' }]);
  });

  it('reads only history reachable from the given commit', async () => {
    const records = parseGitLog(await readLog(main.dir, main.shas[0]!));
    expect(records.map((r) => r.sha)).toEqual([main.shas[0]]);
  });
});

describe('read-only guarantee', () => {
  it('leaves the repository exactly as it was', async () => {
    const before = execFileSync('git', ['-C', main.dir, 'status', '--porcelain=v2', '--branch'], { encoding: 'utf8' });
    const headBefore = execFileSync('git', ['-C', main.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    await assertUsableRepo(main.dir);
    const snapshot = await resolveSnapshot(main.dir);
    const files = await listTree(main.dir, snapshot.sha);
    await mapBlobs(main.dir, files.map((f) => f.blobSha), (c) => c.length);
    await readLog(main.dir, snapshot.sha);
    expect(execFileSync('git', ['-C', main.dir, 'status', '--porcelain=v2', '--branch'], { encoding: 'utf8' })).toBe(before);
    expect(execFileSync('git', ['-C', main.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })).toBe(headBefore);
  });
});
