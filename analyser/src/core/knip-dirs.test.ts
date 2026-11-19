import { describe, expect, it } from 'vitest';
import {
  describeKnipDir,
  missingPackageJsonMessage,
  normaliseKnipDir,
  packageJsonDirs,
  prefixKnipPaths,
  relativeToKnipDir,
} from './knip-dirs';

describe('normaliseKnipDir', () => {
  it.each([
    ['app', 'app'],
    ['app/', 'app'],
    ['./app', 'app'],
    ['./app/', 'app'],
    ['packages/web', 'packages/web'],
    ['packages//web/', 'packages/web'],
    ['packages\\web', 'packages/web'],
    ['a/./b', 'a/b'],
    ['sp ace/é', 'sp ace/é'],
    ['.', ''],
    ['./', ''],
    ['././', ''],
  ])('reads %j as %j', (input, expected) => {
    expect(normaliseKnipDir(input)).toBe(expected);
  });

  it.each([
    ['an empty value', ''],
    ['an absolute path', '/etc'],
    ['a Windows drive path', 'C:\\work\\app'],
    ['a parent folder', '..'],
    ['a path that climbs out', 'app/../../x'],
    ['a path that climbs out and back', '../clone/app'],
  ])('rejects %s', (_label, input) => {
    expect(normaliseKnipDir(input)).toBeUndefined();
  });
});

describe('packageJsonDirs', () => {
  it('lists every folder with a package.json, sorted, the clone root as ""', () => {
    expect(
      packageJsonDirs(['web/package.json', 'package.json', 'app/package.json', 'app/src/a.ts', 'README.md']),
    ).toEqual(['', 'app', 'web']);
  });

  it('lists nested folders and ignores node_modules', () => {
    expect(
      packageJsonDirs(['packages/web/package.json', 'node_modules/x/package.json', 'app/node_modules/y/package.json']),
    ).toEqual(['packages/web']);
  });

  it('ignores files that merely end in package.json', () => {
    expect(packageJsonDirs(['my-package.json', 'app/not-package.json', 'package.json.bak'])).toEqual([]);
  });

  it('lists each folder once', () => {
    expect(packageJsonDirs(['app/package.json', 'app/package.json'])).toEqual(['app']);
  });
});

describe('missingPackageJsonMessage', () => {
  const polyglot = ['pyproject.toml', 'app/package.json', 'app/src/index.ts', 'scripts/run.py'];

  it('is undefined when every folder has a package.json', () => {
    expect(missingPackageJsonMessage(['app'], polyglot)).toBeUndefined();
    expect(missingPackageJsonMessage([''], ['package.json'])).toBeUndefined();
    expect(missingPackageJsonMessage(['app', 'web'], ['app/package.json', 'web/package.json'])).toBeUndefined();
  });

  it('names the missing root, lists the folders that have a package.json, and suggests --knip-dir with one of them', () => {
    const message = missingPackageJsonMessage([''], polyglot);
    expect(message).toContain('the clone root');
    expect(message).toContain('"app"');
    expect(message).toContain('--knip-dir app');
  });

  it('lists every folder that has a package.json', () => {
    const message = missingPackageJsonMessage([''], ['app/package.json', 'tools/web/package.json', 'x.py']);
    expect(message).toContain('"app"');
    expect(message).toContain('"tools/web"');
  });

  it('names each missing folder when several are requested', () => {
    const message = missingPackageJsonMessage(['app', 'nope', 'also-nope'], ['app/package.json']);
    expect(message).toContain('"nope"');
    expect(message).toContain('"also-nope"');
    expect(message).not.toContain('No package.json found in "app"');
  });

  it('says there is nothing to analyse when the clone has no package.json at all', () => {
    const message = missingPackageJsonMessage([''], ['main.py', 'node_modules/x/package.json']);
    expect(message).toContain('nothing for Knip to analyse');
    expect(message).not.toContain('--knip-dir');
  });

  it('suggests "." when the root is the only folder with a package.json', () => {
    expect(missingPackageJsonMessage(['app'], ['package.json'])).toContain('--knip-dir .');
  });

  it('never suggests installing dependencies: the fix is choosing the folder', () => {
    for (const message of [
      missingPackageJsonMessage([''], polyglot),
      missingPackageJsonMessage([''], ['main.py']),
      missingPackageJsonMessage(['x'], ['app/package.json']),
    ]) {
      expect(message).not.toMatch(/install/i);
    }
  });
});

describe('prefixKnipPaths and relativeToKnipDir', () => {
  it('prefixes every path with the folder', () => {
    expect(prefixKnipPaths('app', ['src/a.ts', 'b.ts'])).toEqual(new Set(['app/src/a.ts', 'app/b.ts']));
  });

  it('leaves paths alone for the clone root', () => {
    expect(prefixKnipPaths('', ['src/a.ts'])).toEqual(new Set(['src/a.ts']));
  });

  it('gives the tree paths below a folder with the folder removed', () => {
    expect(relativeToKnipDir('app', ['app/knip.json', 'app/src/a.ts', 'application/x.ts', 'knip.json'])).toEqual([
      'knip.json',
      'src/a.ts',
    ]);
  });

  it('gives every tree path for the clone root', () => {
    expect(relativeToKnipDir('', ['a', 'b/c'])).toEqual(['a', 'b/c']);
  });
});

describe('describeKnipDir', () => {
  it('names the root in words and other folders in quotes', () => {
    expect(describeKnipDir('')).toBe('the clone root');
    expect(describeKnipDir('app')).toBe('"app"');
  });
});
