import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EULOGY_CACHE, USAGE, normaliseAnalysedAt, ollamaUrlProblem, parseCliArgs } from './cli-args';

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

describe('P8: the eulogy flags', () => {
  const run = (...argv: string[]) => {
    const result = parse('repo', ...argv);
    if (result.kind !== 'run') throw new Error(`expected a run, got ${JSON.stringify(result)}`);
    return result.options;
  };
  const usage = (...argv: string[]) => {
    const result = parse('repo', ...argv);
    if (result.kind !== 'usage-error') throw new Error(`expected a usage error, got ${JSON.stringify(result)}`);
    return result.message;
  };

  it('leaves eulogies out without --eulogies', () => {
    expect(run()).not.toHaveProperty('eulogies');
  });

  it('fills in the defaults: localhost, 2 at a time, the cache in the analyser folder', () => {
    expect(run('--eulogies', '--eulogy-model', 'qwen2.5:7b').eulogies).toEqual({
      model: 'qwen2.5:7b',
      ollamaUrl: 'http://localhost:11434',
      concurrency: 2,
      cachePath: DEFAULT_EULOGY_CACHE,
    });
  });

  it('puts the default cache in analyser/.cache, whatever the current folder', () => {
    expect(isAbsolute(DEFAULT_EULOGY_CACHE)).toBe(true);
    expect(DEFAULT_EULOGY_CACHE).toBe(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'eulogies.json'));
  });

  it('reads every eulogy flag, keeping --eulogy-cache as given', () => {
    expect(
      run('--eulogies', '--eulogy-model=llama3.2', '--ollama-url', 'http://127.0.0.1:9999/', '--eulogy-concurrency', '4', '--eulogy-cache', 'c.json').eulogies,
    ).toEqual({ model: 'llama3.2', ollamaUrl: 'http://127.0.0.1:9999', concurrency: 4, cachePath: 'c.json' });
  });

  it('needs --eulogy-model with --eulogies, and says how to choose one', () => {
    expect(usage('--eulogies')).toBe('Choose a model with --eulogy-model, for example qwen2.5:7b (see the README); install it with ollama pull <name>.');
    expect(usage('--eulogies', '--eulogy-model', '  ')).toMatch(/^Choose a model/);
  });

  it.each([
    [['--eulogy-model', 'm'], '--eulogy-model only works with --eulogies'],
    [['--ollama-url', 'http://localhost:1'], '--ollama-url only works with --eulogies'],
    [['--eulogy-concurrency', '2'], '--eulogy-concurrency only works with --eulogies'],
    [['--eulogy-cache', 'c.json'], '--eulogy-cache only works with --eulogies'],
    [['--eulogy-model', 'm', '--eulogy-cache', 'c.json'], '--eulogy-model, --eulogy-cache only work with --eulogies'],
  ])('refuses %j without --eulogies', (argv, message) => {
    expect(usage(...argv)).toContain(message);
  });

  it.each(['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434', 'https://localhost', 'http://LOCALHOST:11434'])(
    'accepts the local URL %s',
    (url) => {
      expect(ollamaUrlProblem(url)).toBeUndefined();
      expect(run('--eulogies', '--eulogy-model', 'm', '--ollama-url', url).eulogies?.model).toBe('m');
    },
  );

  it.each([
    ['http://192.168.1.5:11434', /must name this machine/],
    ['http://example.com', /must name this machine/],
    ['http://localhost.example.com:11434', /must name this machine/],
    ['http://127.0.0.2:11434', /must name this machine/],
    ['http://0.0.0.0:11434', /must name this machine/],
    ['http://user@example.com', /must name this machine/],
    ['ftp://localhost', /http:\/\/ or https:\/\//],
    ['localhost:11434', /http:\/\/ or https:\/\//],
    ['not a url', /must be a URL/],
  ])('refuses %s with the message', (url, message) => {
    expect(usage('--eulogies', '--eulogy-model', 'm', '--ollama-url', url)).toMatch(message);
  });

  it.each(['gemma4:cloud', 'gpt-oss:120b-cloud', 'qwen3-coder:480b-CLOUD'])('refuses the cloud model %s, which would run off this machine', (model) => {
    expect(usage('--eulogies', '--eulogy-model', model)).toMatch(/is an Ollama cloud model: .* would leave this machine/);
  });

  it.each(['qwen2.5:7b', 'llama3.2', 'cloudy:1b', 'mycloud'])('accepts the local model name %s', (model) => {
    expect(run('--eulogies', '--eulogy-model', model).eulogies?.model).toBe(model);
  });

  it('accepts any whole number of requests from 1 to 4, and nothing else', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -10, max: 20 }).map(String), fc.string({ maxLength: 4 }), fc.constantFrom('1.5', '2.0', '02', ' ', '1e0')), (value) => {
        const result = parse('repo', '--eulogies', '--eulogy-model', 'm', `--eulogy-concurrency=${value}`);
        const ok = /^\s*[1-4]\s*$/.test(value);
        if (ok) return result.kind === 'run' && result.options.eulogies?.concurrency === Number(value.trim());
        return result.kind === 'usage-error' && result.message.includes('from 1 to 4');
      }),
    );
  });

  it('lists the eulogy flags in the help', () => {
    for (const flag of ['--eulogies', '--eulogy-model', '--ollama-url', '--eulogy-concurrency', '--eulogy-cache']) expect(USAGE).toContain(flag);
  });
});

describe('--eulogies-from (importers spec, task 8)', () => {
  it('is kept as given, and is absent when not given', () => {
    const r = parseCliArgs(['repo', '--eulogies-from', 'old/g.json'], () => '2026-01-01T00:00:00.000Z');
    expect(r).toMatchObject({ kind: 'run', options: { eulogiesFrom: 'old/g.json' } });
    expect(r.kind === 'run' && 'eulogies' in r.options).toBe(false);
    const plain = parseCliArgs(['repo'], () => '2026-01-01T00:00:00.000Z');
    expect(plain.kind === 'run' && 'eulogiesFrom' in plain.options).toBe(false);
  });

  it('is refused with --eulogies, and without a file', () => {
    expect(parseCliArgs(['repo', '--eulogies-from', 'g.json', '--eulogies', '--eulogy-model', 'm'], () => 'x')).toEqual({
      kind: 'usage-error',
      message: '--eulogies and --eulogies-from both set the eulogies. Use one of them.',
    });
    expect(parseCliArgs(['repo', '--eulogies-from='], () => 'x')).toEqual({ kind: 'usage-error', message: '--eulogies-from needs a graveyard file.' });
  });

  it('is in the usage text', () => {
    expect(USAGE).toContain('--eulogies-from <file>');
  });
});
