import fc from 'fast-check';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnalyserError } from '../errors';
import {
  KNIP_ADVICE,
  buildKnipArgs,
  findKnipBin,
  knipFailure,
  readKnipResult,
  type KnipProcessResult,
} from './knip';

const SAMPLE = JSON.stringify({ issues: [{ file: 'src/legacy.ts', files: [{ name: 'src/legacy.ts' }] }] });

const result = (overrides: Partial<KnipProcessResult>): KnipProcessResult => ({
  exitCode: 0,
  stdout: SAMPLE,
  stderr: '',
  ...overrides,
});

/** Runs readKnipResult and returns the error it threw, failing the test if it did not throw. */
function failureOf(r: KnipProcessResult): AnalyserError {
  try {
    readKnipResult(r);
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyserError);
    return error as AnalyserError;
  }
  throw new Error('readKnipResult did not throw');
}

describe('readKnipResult', () => {
  it('reads the unused files when Knip exits 0', () => {
    expect(readKnipResult(result({ exitCode: 0 }))).toEqual(new Set(['src/legacy.ts']));
  });

  it('reads the unused files when Knip exits 1, which means it found issues', () => {
    expect(readKnipResult(result({ exitCode: 1 }))).toEqual(new Set(['src/legacy.ts']));
  });

  it('accepts an empty report', () => {
    expect(readKnipResult(result({ stdout: '{"issues":[]}' }))).toEqual(new Set());
  });

  it('fails on exit code 2 and shows the end of Knip\'s error output', () => {
    const error = failureOf(result({ exitCode: 2, stdout: '', stderr: 'noise\nCannot find module "typescript"\n' }));
    expect(error.message).toContain('exited with code 2');
    expect(error.message).toContain('Cannot find module "typescript"');
  });

  it('fails when Knip was stopped by a signal', () => {
    expect(failureOf(result({ exitCode: null })).message).toContain('stopped');
  });

  it('fails when Knip could not be started', () => {
    expect(failureOf(result({ exitCode: null, spawnError: 'spawn ENOENT' })).message).toContain('spawn ENOENT');
  });

  it.each([
    ['empty output', ''],
    ['text instead of JSON', 'Error: something broke'],
    ['JSON of the wrong shape', '{"nope":1}'],
  ])('fails when Knip exits 0 with %s', (_label, stdout) => {
    expect(failureOf(result({ exitCode: 0, stdout })).message).toContain('Knip failed');
  });

  it('keeps only the last 15 lines of Knip\'s error output', () => {
    const stderr = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const message = failureOf(result({ exitCode: 2, stderr })).message;
    expect(message).toContain('line 39');
    expect(message).toContain('line 25');
    expect(message).not.toContain('line 24');
  });
});

describe('every Knip failure carries the install advice (Req 6.5)', () => {
  it('holds for each kind of failure', () => {
    const failures: KnipProcessResult[] = [
      result({ exitCode: 2 }),
      result({ exitCode: 127, stdout: '' }),
      result({ exitCode: null }),
      result({ exitCode: null, spawnError: 'boom' }),
      result({ stdout: '' }),
      result({ stdout: 'garbage' }),
    ];
    for (const failure of failures) {
      expect(failureOf(failure).message).toContain(KNIP_ADVICE);
    }
    expect(knipFailure('anything').message).toContain(KNIP_ADVICE);
  });

  it('holds for any exit code outside 0 and 1, and any stderr', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 255 }),
        fc.string({ maxLength: 200 }),
        (exitCode, stderr) => failureOf(result({ exitCode, stderr })).message.includes(KNIP_ADVICE),
      ),
    );
  });

  it('says dependencies are probably not installed, that the user installs them, and that the analyser never does', () => {
    expect(KNIP_ADVICE).toMatch(/dependencies are not installed/);
    expect(KNIP_ADVICE).toMatch(/Install them yourself/);
    expect(KNIP_ADVICE).toMatch(/never installs anything/);
  });
});

describe('buildKnipArgs', () => {
  it('asks only for unused files, as JSON, run from the clone', () => {
    expect(buildKnipArgs('/k/knip.js', { clonePath: '/repo' })).toEqual([
      '/k/knip.js',
      '--directory',
      '/repo',
      '--reporter',
      'json',
      '--include',
      'files',
      '--no-progress',
    ]);
  });

  it('adds the config as an absolute path when one is given', () => {
    const args = buildKnipArgs('/k/knip.js', { clonePath: '/repo', configPath: 'conf/knip.json' });
    expect(args.slice(-2)).toEqual(['--config', resolve('conf/knip.json')]);
  });

  it('passes a path with spaces as one argument', () => {
    const args = buildKnipArgs('/k/knip.js', { clonePath: '/my repo/x y' });
    expect(args[2]).toBe('/my repo/x y');
  });
});

describe('findKnipBin', () => {
  it('finds the Knip script installed for the analyser', () => {
    expect(existsSync(findKnipBin())).toBe(true);
  });

  it('fails with the install advice when Knip is not installed', () => {
    expect(() => findKnipBin('/')).toThrow(/Knip is not installed/);
    expect(() => findKnipBin('/')).toThrow(KNIP_ADVICE);
  });
});
