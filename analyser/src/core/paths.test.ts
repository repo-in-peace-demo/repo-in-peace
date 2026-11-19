import fc from 'fast-check';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultOutputName, isInside } from './paths';

describe('defaultOutputName', () => {
  it.each([
    ['repo-in-peace', 'repo-in-peace.graveyard.json'],
    ['my.repo_2', 'my.repo_2.graveyard.json'],
    ['my repo', 'my-repo.graveyard.json'],
    ['a/b', 'a-b.graveyard.json'],
    ['é', '-.graveyard.json'],
    ['', 'repo.graveyard.json'],
    ['..', 'repo.graveyard.json'],
    ['.', 'repo.graveyard.json'],
  ])('names the file for %j as %s', (name, expected) => {
    expect(defaultOutputName(name)).toBe(expected);
  });

  it('always gives a plain file name: safe characters only, no slash, ends in .graveyard.json', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (name) => {
        const out = defaultOutputName(name);
        return /^[A-Za-z0-9._-]+\.graveyard\.json$/.test(out);
      }),
    );
  });
});

describe('isInside', () => {
  const root = resolve('/work/clone');

  it('is true for the directory itself and anything below it', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, 'out.json'))).toBe(true);
    expect(isInside(root, join(root, 'a', 'b', 'out.json'))).toBe(true);
  });

  it('is false for siblings, parents and other trees', () => {
    expect(isInside(root, resolve('/work/other/out.json'))).toBe(false);
    expect(isInside(root, resolve('/work'))).toBe(false);
    expect(isInside(root, resolve('/elsewhere'))).toBe(false);
  });

  it('is false for a sibling whose name starts with the clone name', () => {
    expect(isInside(root, resolve('/work/clone-2/out.json'))).toBe(false);
    expect(isInside(root, `${root}x${sep}out.json`)).toBe(false);
  });

  it('is true for a directory called ..foo below the clone', () => {
    expect(isInside(root, join(root, '..foo', 'out.json'))).toBe(true);
  });
});
