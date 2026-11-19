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
