import { spawnSync } from 'node:child_process';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BRANCH_PREFIX, branchName, branchStem, isValidRefName } from './branch';
import { ACTIONS } from './request';

/** Paths like a repository's, plus anything at all. */
const pathArb = fc.oneof(
  fc.array(fc.stringMatching(/^[A-Za-z0-9._ ()[\]@~^:-]{1,12}$/), { minLength: 1, maxLength: 6 }).map((parts) => parts.join('/')),
  fc.string({ minLength: 1, maxLength: 120 }),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
);

describe('P2: branch names', () => {
  it('are deterministic, valid git ref names, and start with the prefix and the action', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACTIONS), pathArb, (action, path) => {
        const name = branchName(action, path);
        return name === branchName(action, path) && isValidRefName(name) && name.startsWith(`${BRANCH_PREFIX}${action}/`) && name.split('/').length === 3;
      }),
      { numRuns: 2000 },
    );
  });

  it('differ for different paths and for the two actions', () => {
    fc.assert(
      fc.property(pathArb, pathArb, (a, b) => {
        if (a === b) return true;
        return branchName('bury', a) !== branchName('bury', b) && branchName('bury', a) !== branchName('resurrect', a);
      }),
      { numRuns: 2000 },
    );
  });

  it('keep apart paths the readable stem cannot tell apart', () => {
    const lookAlikes = ['src/a-b.ts', 'src/a/b.ts', 'SRC/A/B.TS', 'src/a b.ts', 'src/a  b.ts', 'src/a//b.ts'];
    expect(new Set(lookAlikes.map((p) => branchStem(p))).size).toBeLessThan(lookAlikes.length);
    expect(new Set(lookAlikes.map((p) => branchName('bury', p))).size).toBe(new Set(lookAlikes).size);
  });

  it('read like the path', () => {
    expect(branchName('bury', 'app/lib/hooks/useUploadStatus.ts')).toMatch(/^rip\/bury\/app-lib-hooks-useuploadstatus\.ts-[0-9a-f]{8}$/);
    expect(branchName('resurrect', 'src/surface-placement.ts')).toMatch(/^rip\/resurrect\/src-surface-placement\.ts-[0-9a-f]{8}$/);
    expect(branchStem('app/app/(auth)/login/page.tsx')).toBe('app-app-auth-login-page.tsx');
    expect(branchStem('..//.env.lock')).toBe('env.lock');
    expect(branchStem('🕯️/👻')).toBe('file');
    expect(branchStem(`${'deep/'.repeat(30)}x.ts`).length).toBeLessThanOrEqual(60);
  });
});

describe('isValidRefName', () => {
  it.each(['main', 'rip/bury/a-1', 'release/2026.1', 'a@b', 'x.lockx'])('accepts %s', (n) => expect(isValidRefName(n)).toBe(true));
  it.each(['', '@', 'a..b', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '/a', 'a/', 'a//b', 'a.', 'a/.b', '.a', 'a.lock', 'a/b.lock/c', 'a@{b', 'a\tb', 'a\x7fb'])(
    'refuses %j',
    (n) => expect(isValidRefName(n)).toBe(false),
  );
});

describe('isValidRefName agrees with git', () => {
  const gitSays = (name: string): boolean => spawnSync('git', ['check-ref-format', '--branch', name], { stdio: 'ignore' }).status === 0;

  it('on the names this function makes, and on random near-miss names', () => {
    const nameArb = fc.oneof(
      fc.tuple(fc.constantFrom(...ACTIONS), pathArb).map(([a, p]) => branchName(a, p)),
      fc.stringMatching(/^[a-z./@{~^: *?[\\-]{1,10}$/),
    );
    fc.assert(
      fc.property(nameArb, (name) => {
        // git check-ref-format --branch also expands "@{-1}" and similar; leave those to git.
        if (name.startsWith('@{-') || name === '-' || name === '@') return true; // git reads "@" as HEAD here; as a ref name it is invalid, as isValidRefName says
        // A leading "-" is refused by --branch (it reads as an option), which isValidRefName need not know: no name made here starts with one.
        if (name.startsWith('-')) return true;
        return isValidRefName(name) === gitSays(name);
      }),
      { numRuns: 300 },
    );
  });
});
