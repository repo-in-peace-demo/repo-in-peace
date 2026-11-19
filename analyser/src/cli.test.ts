import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { makeRepo } from '../test/make-repo';
import { main, type CliEnv } from './cli';
import { USAGE } from './cli-args';
import type { KnipProcessResult } from './io/knip';

const NOW = '2030-05-05T05:05:05.000Z';
const scratch: string[] = [];
const repo = makeRepo([
  {
    kind: 'commit',
    message: 'one',
    author: 'Ann',
    date: '2026-01-01T10:00:00+00:00',
    ops: [
      { op: 'write', path: 'src/a.ts', content: 'export const a = 1;\n' },
      { op: 'write', path: 'package.json', content: '{"name":"x"}\n' },
      { op: 'write', path: 'knip.json', content: '{}\n' },
    ],
  },
]);
afterAll(() => {
  repo.cleanup();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-cli-'));
  scratch.push(dir);
  return dir;
};

const knipStub = (result: KnipProcessResult = { exitCode: 0, stdout: '{"issues":[]}', stderr: '' }) => ({
  runKnip: vi.fn(async () => result),
});

function env(cwd: string) {
  const written: string[] = [];
  const now = vi.fn(() => NOW);
  const cliEnv: CliEnv = { stderr: (text) => void written.push(text), cwd, now };
  return { cliEnv, text: () => written.join(''), now };
}

describe('main: exit codes and messages', () => {
  it('exits 0, prints a summary to stderr, and writes the file', async () => {
    const cwd = tempDir();
    const { cliEnv, text } = env(cwd);
    const code = await main([repo.dir, '--out', 'g.json'], cliEnv, knipStub());
    expect(code).toBe(0);
    expect(text()).toMatch(/Wrote .*g\.json: 1 files, 0 ghosts, 2 folders/);
    expect(existsSync(join(cwd, 'g.json'))).toBe(true);
  });

  it('uses the injected clock for the analysis time when --analysed-at is absent', async () => {
    const cwd = tempDir();
    const { cliEnv, now } = env(cwd);
    await main([repo.dir, '--out', 'g.json'], cliEnv, knipStub());
    expect(now).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(join(cwd, 'g.json'), 'utf8')).meta.analysedAt).toBe(NOW);
  });

  it('uses --analysed-at and never reads the clock', async () => {
    const cwd = tempDir();
    const { cliEnv, now } = env(cwd);
    await main([repo.dir, '--out', 'g.json', '--analysed-at', '2026-03-01T12:00:00Z'], cliEnv, knipStub());
    expect(now).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(cwd, 'g.json'), 'utf8')).meta.analysedAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('exits 0 and prints the usage for --help, without analysing anything', async () => {
    const { cliEnv, text } = env(tempDir());
    const knip = knipStub();
    expect(await main(['--help'], cliEnv, knip)).toBe(0);
    expect(text()).toBe(USAGE);
    expect(knip.runKnip).not.toHaveBeenCalled();
  });

  it.each([
    ['no arguments', []],
    ['an unknown option', ['repo', '--nope']],
    ['a bad timestamp', ['repo', '--analysed-at', 'tomorrow']],
  ])('exits 2 with the usage for %s', async (_label, argv) => {
    const cwd = tempDir();
    const { cliEnv, text } = env(cwd);
    expect(await main(argv, cliEnv, knipStub())).toBe(2);
    expect(text()).toMatch(/^Error: /);
    expect(text()).toContain(USAGE);
  });

  it.each([
    ['--stale-after', 'abc'],
    ['--hot-window', '0'],
  ])('exits 2 before reading the clone when %s is %s', async (flag, value) => {
    const cwd = tempDir();
    const { cliEnv, text } = env(cwd);
    const knip = knipStub();
    expect(await main([repo.dir, '--out', 'g.json', flag, value], cliEnv, knip)).toBe(2);
    expect(text()).toContain(`Error: ${flag} must be a positive whole number`);
    expect(text()).not.toContain('Analysing'); // nothing was read
    expect(knip.runKnip).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, 'g.json'))).toBe(false);
  });

  it('exits 2 with a clear message when --ancient-after is not greater than --stale-after', async () => {
    const { cliEnv, text } = env(tempDir());
    expect(await main([repo.dir, '--stale-after', '200', '--ancient-after', '100'], cliEnv, knipStub())).toBe(2);
    expect(text()).toContain('Error: --ancient-after (100) must be greater than --stale-after (200).');
  });

  it('passes the thresholds to the output file', async () => {
    const cwd = tempDir();
    const { cliEnv } = env(cwd);
    const code = await main(
      [repo.dir, '--out', 'g.json', '--stale-after', '30', '--ancient-after', '200', '--hot-commits', '3', '--hot-window', '14'],
      cliEnv,
      knipStub(),
    );
    expect(code).toBe(0);
    const meta = JSON.parse(readFileSync(join(cwd, 'g.json'), 'utf8')).meta;
    expect(meta.schemaVersion).toBe(2);
    expect(meta.thresholds).toEqual({ staleAfterDays: 30, ancientAfterDays: 200, decayCapDays: 400, hotCommits: 3, hotWindowDays: 14 });
  });

  it('writes the default thresholds when no threshold flag is given', async () => {
    const cwd = tempDir();
    const { cliEnv } = env(cwd);
    await main([repo.dir, '--out', 'g.json'], cliEnv, knipStub());
    expect(JSON.parse(readFileSync(join(cwd, 'g.json'), 'utf8')).meta.thresholds).toEqual({
      staleAfterDays: 90,
      ancientAfterDays: 360,
      decayCapDays: 720,
      hotCommits: 5,
      hotWindowDays: 30,
    });
  });

  it('exits 1 with a one-line message and no stack trace when the path is not a repository', async () => {
    const { cliEnv, text } = env(tempDir());
    const code = await main([tempDir()], cliEnv, knipStub());
    expect(code).toBe(1);
    expect(text()).toMatch(/^Error: ".*" is not a git repository/);
    expect(text()).not.toMatch(/\n\s+at /);
  });

  it('exits 1 and writes nothing when Knip fails, with the install advice', async () => {
    const cwd = tempDir();
    const { cliEnv, text } = env(cwd);
    const code = await main(
      [repo.dir, '--out', 'g.json'],
      cliEnv,
      knipStub({ exitCode: 2, stdout: '', stderr: 'boom' }),
    );
    expect(code).toBe(1);
    expect(text()).toContain('Knip failed');
    expect(text()).toContain('dependencies are not installed');
    expect(existsSync(join(cwd, 'g.json'))).toBe(false);
  });

  it('exits 1 before running Knip when --knip-config does not exist', async () => {
    const { cliEnv, text } = env(tempDir());
    const knip = knipStub();
    const code = await main([repo.dir, '--knip-config', 'missing.json'], cliEnv, knip);
    expect(code).toBe(1);
    expect(text()).toContain('missing.json');
    expect(knip.runKnip).not.toHaveBeenCalled();
  });

  it('exits 1 with the stack for an unexpected error', async () => {
    const { cliEnv, text } = env(tempDir());
    const broken = { runKnip: vi.fn(async (): Promise<KnipProcessResult> => { throw new TypeError('kaboom'); }) };
    const code = await main([repo.dir, '--out', 'g.json'], cliEnv, broken);
    expect(code).toBe(1);
    expect(text()).toMatch(/Unexpected error: TypeError: kaboom\n\s+at /);
  });

  it('keeps all progress on stderr: nothing is written to stdout', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { cliEnv } = env(tempDir());
      await main([repo.dir, '--out', 'g.json'], cliEnv, knipStub());
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
    }
  });
});
