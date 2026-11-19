import { describe, expect, it, vi } from 'vitest';
import { USAGE, normaliseAnalysedAt, parseCliArgs } from './cli-args';

const NOW = '2030-01-01T00:00:00.000Z';
const parse = (...argv: string[]) => parseCliArgs(argv, () => NOW);

describe('parseCliArgs', () => {
  it('reads a path and fills in the clock for the analysis time', () => {
    expect(parse('/some/clone')).toEqual({
      kind: 'run',
      options: { repoPath: '/some/clone', analysedAt: NOW },
    });
  });

  it('reads every option', () => {
    expect(parse('repo', '--out', 'out/g.json', '--analysed-at', '2026-03-01T12:00:00Z', '--knip-config', 'k.json')).toEqual({
      kind: 'run',
      options: {
        repoPath: 'repo',
        outPath: 'out/g.json',
        analysedAt: '2026-03-01T12:00:00.000Z',
        knipConfigPath: 'k.json',
      },
    });
  });

  it('accepts options before the path and --option=value', () => {
    expect(parse('--out=g.json', 'repo')).toMatchObject({ kind: 'run', options: { repoPath: 'repo', outPath: 'g.json' } });
  });

  it('reads the clock only when --analysed-at is absent', () => {
    const now = vi.fn(() => NOW);
    parseCliArgs(['repo', '--analysed-at', '2026-03-01T12:00:00Z'], now);
    expect(now).not.toHaveBeenCalled();
    parseCliArgs(['repo'], now);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it.each([['--help'], ['-h'], ['repo', '--help']])('shows help for %s', (...argv) => {
    expect(parse(...argv)).toEqual({ kind: 'help' });
  });

  it.each([
    ['no arguments', []],
    ['two paths', ['a', 'b']],
    ['an empty path', ['']],
    ['an unknown option', ['repo', '--bogus']],
    ['an option with no value', ['repo', '--out']],
  ])('rejects %s as a usage error', (_label, argv) => {
    expect(parse(...argv).kind).toBe('usage-error');
  });

  it.each(['yesterday', '2026-03-01', '2026-03-01T12:00:00', '2026-13-45T12:00:00Z', ''])(
    'rejects --analysed-at %j',
    (value) => {
      const result = parse('repo', '--analysed-at', value);
      expect(result.kind).toBe('usage-error');
      if (result.kind === 'usage-error' && value !== '') expect(result.message).toContain(value);
    },
  );
});

describe('parseCliArgs --knip-dir', () => {
  it('is absent from the options when not given, meaning the clone root', () => {
    const result = parse('repo');
    expect(result.kind === 'run' && 'knipDirs' in result.options).toBe(false);
  });

  it('reads one folder', () => {
    expect(parse('repo', '--knip-dir', 'app')).toMatchObject({ kind: 'run', options: { knipDirs: ['app'] } });
  });

  it('can be repeated, keeping the order', () => {
    expect(parse('repo', '--knip-dir', 'app', '--knip-dir', 'tools/web')).toMatchObject({
      options: { knipDirs: ['app', 'tools/web'] },
    });
  });

  it('cleans each folder and drops repeats', () => {
    expect(parse('repo', '--knip-dir', './app/', '--knip-dir', 'app', '--knip-dir', '.')).toMatchObject({
      options: { knipDirs: ['app', ''] },
    });
  });

  it.each([['..'], ['/etc'], ['app/../../x'], ['']])('rejects %j and says what is expected', (value) => {
    const result = parse('repo', '--knip-dir', value);
    expect(result.kind).toBe('usage-error');
    if (result.kind === 'usage-error') expect(result.message).toContain('--knip-dir must be a folder inside the clone');
  });

  it('needs a value', () => {
    expect(parse('repo', '--knip-dir').kind).toBe('usage-error');
  });

  it('is documented in the usage text', () => {
    expect(USAGE).toContain('--knip-dir');
  });
});

describe('parseCliArgs decay threshold flags', () => {
  it('leaves thresholds out of the options when no threshold flag is given, so the defaults apply', () => {
    const result = parse('repo');
    expect(result.kind === 'run' && 'thresholds' in result.options).toBe(false);
  });

  it('reads all four flags and works out the decay cap', () => {
    expect(
      parse('repo', '--stale-after', '30', '--ancient-after', '200', '--hot-commits', '3', '--hot-window', '14'),
    ).toMatchObject({
      kind: 'run',
      options: {
        thresholds: { staleAfterDays: 30, ancientAfterDays: 200, decayCapDays: 400, hotCommits: 3, hotWindowDays: 14 },
      },
    });
  });

  it('fills in the defaults for the flags that are not given', () => {
    expect(parse('repo', '--hot-commits', '10')).toMatchObject({
      options: { thresholds: { staleAfterDays: 90, ancientAfterDays: 360, decayCapDays: 720, hotCommits: 10, hotWindowDays: 30 } },
    });
  });

  it('accepts --flag=value', () => {
    expect(parse('repo', '--stale-after=7', '--ancient-after=70')).toMatchObject({
      options: { thresholds: { staleAfterDays: 7, ancientAfterDays: 70, decayCapDays: 140 } },
    });
  });

  it.each([
    [['--stale-after', 'soon'], '--stale-after must be a positive whole number'],
    [['--ancient-after', '0'], '--ancient-after must be a positive whole number'],
    [['--hot-commits', '-1'], '--hot-commits must be a positive whole number'],
    [['--hot-window', '2.5'], '--hot-window must be a positive whole number'],
    [['--stale-after', '100', '--ancient-after', '100'], '--ancient-after (100) must be greater than --stale-after (100).'],
    [['--ancient-after', '50'], '--ancient-after (50) must be greater than --stale-after (90, the default).'],
    [['--stale-after', '400'], '--stale-after (400) must be less than --ancient-after (360, the default).'],
  ])('rejects %j with a message that names the flag', (flags, expected) => {
    const result = parse('repo', ...flags);
    expect(result.kind).toBe('usage-error');
    if (result.kind === 'usage-error') expect(result.message).toContain(expected);
  });

  it('needs a value after each flag', () => {
    for (const flag of ['--stale-after', '--ancient-after', '--hot-commits', '--hot-window']) {
      expect(parse('repo', flag).kind).toBe('usage-error');
    }
  });

  it('does not read the clock for the thresholds, and still reads it once for the analysis time', () => {
    const now = vi.fn(() => NOW);
    parseCliArgs(['repo', '--stale-after', '5', '--ancient-after', '9'], now);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('documents each flag with its default in the usage text', () => {
    for (const text of ['--stale-after <days>', '--ancient-after <days>', '--hot-commits <n>', '--hot-window <days>', 'Default 90', 'Default 360', 'Default 5', 'Default 30']) {
      expect(USAGE).toContain(text);
    }
  });
});

describe('normaliseAnalysedAt', () => {
  it.each([
    ['2026-03-01T12:00:00Z', '2026-03-01T12:00:00.000Z'],
    ['2026-03-01T12:00:00.5Z', '2026-03-01T12:00:00.500Z'],
    ['2026-03-01T12:00Z', '2026-03-01T12:00:00.000Z'],
    ['2026-03-01T17:30:00+05:30', '2026-03-01T12:00:00.000Z'],
    ['2026-03-01T04:00:00-08:00', '2026-03-01T12:00:00.000Z'],
  ])('reads %s as %s', (input, expected) => {
    expect(normaliseAnalysedAt(input)).toBe(expected);
  });
});

describe('USAGE', () => {
  it('documents every option', () => {
    for (const option of ['--out', '--analysed-at', '--knip-config', '--help']) {
      expect(USAGE).toContain(option);
    }
  });
});
