import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realPathOfFuture, writeFileAtomic } from './write-output';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rip-write-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes the text to the target', async () => {
    const target = join(dir, 'out.json');
    await writeFileAtomic(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
  });

  it('writes the text byte for byte, including non-ASCII and CRLF', async () => {
    const target = join(dir, 'out.json');
    const text = 'é\r\n\u{1F600}\n';
    await writeFileAtomic(target, text);
    expect(readFileSync(target, 'utf8')).toBe(text);
  });

  it('creates missing parent directories', async () => {
    const target = join(dir, 'a', 'b', 'c', 'out.json');
    await writeFileAtomic(target, 'x');
    expect(readFileSync(target, 'utf8')).toBe('x');
  });

  it('replaces an existing file', async () => {
    const target = join(dir, 'out.json');
    writeFileSync(target, 'old');
    await writeFileAtomic(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
  });

  it('leaves no temporary files behind after success', async () => {
    await writeFileAtomic(join(dir, 'out.json'), 'x');
    expect(readdirSync(dir)).toEqual(['out.json']);
  });

  it('leaves no temporary files and does not touch the target when the write fails', async () => {
    // A directory already sits at the target path, so the final rename cannot succeed.
    const target = join(dir, 'out.json');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep');

    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();

    expect(readdirSync(dir)).toEqual(['out.json']);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('rejects when the parent path is a file', async () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'file');
    await expect(writeFileAtomic(join(blocker, 'out.json'), 'x')).rejects.toThrow();
  });
});

describe('realPathOfFuture', () => {
  it('returns the real path of a file that exists', async () => {
    const file = join(dir, 'here.json');
    writeFileSync(file, 'x');
    expect(await realPathOfFuture(file)).toBe(realpathSync(file));
  });

  it('resolves the existing part and appends the part that does not exist yet', async () => {
    expect(await realPathOfFuture(join(dir, 'a', 'b', 'new.json'))).toBe(join(realpathSync(dir), 'a', 'b', 'new.json'));
  });

  it('follows a symlink in the existing part', async () => {
    const real = join(dir, 'real');
    mkdirSync(real);
    symlinkSync(real, join(dir, 'link'));
    expect(await realPathOfFuture(join(dir, 'link', 'sub', 'out.json'))).toBe(join(realpathSync(real), 'sub', 'out.json'));
  });

  it('makes a relative path absolute', async () => {
    const result = await realPathOfFuture('does-not-exist-here/out.json');
    expect(result.startsWith('/')).toBe(true);
    expect(result.endsWith(join('does-not-exist-here', 'out.json'))).toBe(true);
  });
});
