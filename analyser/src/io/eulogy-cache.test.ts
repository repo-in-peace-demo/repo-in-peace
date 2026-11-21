import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eulogiesOf, readEulogyCache, writeEulogyCache, type CacheEntries } from './eulogy-cache';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-eulogy-cache-'));
  dirs.push(dir);
  return dir;
};
const AT = '2026-03-02T09:30:00.000Z';

describe('the eulogy cache file', () => {
  it('reads a missing file as an empty cache, without a message', async () => {
    const lines: string[] = [];
    expect((await readEulogyCache(join(tempDir(), 'nope', 'eulogies.json'), (m) => lines.push(m))).size).toBe(0);
    expect(lines).toEqual([]);
  });

  it.each([
    ['not JSON', '{ not json'],
    ['another version', JSON.stringify({ version: 2, entries: {} })],
    ['entries as a list', JSON.stringify({ version: 1, entries: [] })],
    ['an entry of the wrong shape', JSON.stringify({ version: 1, entries: { k: { eulogy: 3, model: 'm', at: AT } } })],
    ['null', 'null'],
  ])('reports a malformed file (%s) and treats it as empty', async (_label, text) => {
    const path = join(tempDir(), 'eulogies.json');
    writeFileSync(path, text);
    const lines: string[] = [];
    expect((await readEulogyCache(path, (m) => lines.push(m))).size).toBe(0);
    expect(lines).toEqual([`The eulogy cache at ${path} could not be read; starting a new one.`]);
  });

  it('reports a path it cannot read (a folder) and treats it as empty', async () => {
    const path = join(tempDir(), 'eulogies.json');
    mkdirSync(path);
    const lines: string[] = [];
    expect((await readEulogyCache(path, (m) => lines.push(m))).size).toBe(0);
    expect(lines).toHaveLength(1);
  });

  it('writes atomically (creating the folder, leaving no temporary file) and reads back the same entries, for every model', async () => {
    const dir = join(tempDir(), '.cache');
    const path = join(dir, 'eulogies.json');
    const entries: CacheEntries = new Map([
      ['b', { eulogy: 'Here lies b. It slept.', model: 'qwen2.5:7b', at: AT }],
      ['a', { eulogy: 'Here lies a. It woke.', model: 'llama3.2', at: AT }],
    ]);
    await writeEulogyCache(path, entries);
    expect(readdirSync(dir)).toEqual(['eulogies.json']);
    const text = readFileSync(path, 'utf8');
    expect(Object.keys(JSON.parse(text).entries)).toEqual(['a', 'b']);
    expect(JSON.parse(text).version).toBe(1);
    const back = await readEulogyCache(path, () => {});
    expect(back).toEqual(entries);
    expect(eulogiesOf(back)).toEqual(new Map([['a', 'Here lies a. It woke.'], ['b', 'Here lies b. It slept.']]));
  });

  it('never stores an empty eulogy, and drops one found in a file', async () => {
    const path = join(tempDir(), 'eulogies.json');
    await writeEulogyCache(path, new Map([['e', { eulogy: '', model: 'm', at: AT }], ['f', { eulogy: 'Here lies f.', model: 'm', at: AT }]]));
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).entries)).toEqual(['f']);
    writeFileSync(path, JSON.stringify({ version: 1, entries: { e: { eulogy: '', model: 'm', at: AT } } }));
    expect((await readEulogyCache(path, () => {})).size).toBe(0);
  });
});
