import { describe, expect, it } from 'vitest';
import { DEFAULT_CAP, isPlainBranchName, isRepoName, modeFromVercelEnv, readConfig } from './config';

const DEMOS = JSON.stringify({
  'demo.oikosledger': { repo: 'repo-in-peace-demo/oikos_ledger', base: 'main' },
  'demo.spatialql': { repo: 'repo-in-peace-demo/spatialql', base: 'master' },
});

describe('readConfig', () => {
  it('reads the token, the demos and the cap', () => {
    const c = readConfig({ GITHUB_TOKEN: ' github_pat_abc ', RIP_DEMOS: DEMOS, RIP_PR_CAP: '20' }, 'production');
    if ('problem' in c) throw new Error(c.problem);
    expect(c.token).toBe('github_pat_abc');
    expect(c.cap).toBe(20);
    expect(c.mode).toBe('production');
    expect([...c.demos]).toEqual([
      ['demo.oikosledger', { repo: 'repo-in-peace-demo/oikos_ledger', base: 'main' }],
      ['demo.spatialql', { repo: 'repo-in-peace-demo/spatialql', base: 'master' }],
    ]);
  });

  it('treats missing values as unset, not as problems', () => {
    expect(readConfig({}, 'development')).toEqual({ mode: 'development', token: undefined, demos: new Map(), cap: DEFAULT_CAP });
    expect(readConfig({ GITHUB_TOKEN: '  ', RIP_DEMOS: '' }, 'production')).toMatchObject({ token: undefined, demos: new Map() });
  });

  it.each([
    ['{not json', /not valid JSON/],
    ['[]', /must be a JSON object/],
    ['"x"', /must be a JSON object/],
    [JSON.stringify({ 'bad name!': { repo: 'a/b', base: 'main' } }), /"bad name!" is not a graveyard name/],
    [JSON.stringify({ d: { repo: 'a/b' } }), /"d" needs "repo" and "base"/],
    [JSON.stringify({ d: 'a/b' }), /"d" needs "repo" and "base"/],
    [JSON.stringify({ d: { repo: 'nobody', base: 'main' } }), /not owner\/name/],
    [JSON.stringify({ d: { repo: 'a/b/c', base: 'main' } }), /not owner\/name/],
    [JSON.stringify({ d: { repo: '-a/b', base: 'main' } }), /not owner\/name/],
    [JSON.stringify({ d: { repo: 'a/b', base: '../main' } }), /not a branch name/],
    [JSON.stringify({ d: { repo: 'a/b', base: 'main.lock' } }), /not a branch name/],
  ])('names the problem in RIP_DEMOS %s', (raw, message) => {
    const c = readConfig({ RIP_DEMOS: raw }, 'production');
    expect(c).toHaveProperty('problem');
    if ('problem' in c) expect(c.problem).toMatch(message);
  });

  it('never quotes the token in a problem', () => {
    const token = 'github_pat_SECRET123';
    for (const env of [{ GITHUB_TOKEN: token, RIP_DEMOS: '{bad' }, { GITHUB_TOKEN: token, RIP_PR_CAP: 'x' }]) {
      const c = readConfig(env, 'production');
      expect('problem' in c && !c.problem.includes(token)).toBe(true);
    }
  });

  it.each(['0', '-1', '1.5', 'many', '1001'])('refuses the cap %s', (cap) => {
    expect(readConfig({ RIP_PR_CAP: cap }, 'production')).toHaveProperty('problem');
  });
});

describe('names', () => {
  it.each(['repo-in-peace-demo/oikos_ledger', 'a/b', 'A1-b/x.y_z'])('accepts the repo %s', (r) => expect(isRepoName(r)).toBe(true));
  it.each(['a', 'a/', '/b', 'a/b/c', 'a--/b', '-a/b', 'a-/b', 'a/..', 'a b/c', `${'a'.repeat(40)}/b`])('refuses the repo %s', (r) => expect(isRepoName(r)).toBe(false));
  it.each(['main', 'master', 'release/2026', 'v1.2'])('accepts the branch %s', (b) => expect(isPlainBranchName(b)).toBe(true));
  it.each(['', '/main', 'main/', 'a//b', 'a..b', 'x.lock', 'x.', '.hidden', 'a/-b', 'a b', 'a~1', 'a:b'])('refuses the branch %j', (b) => expect(isPlainBranchName(b)).toBe(false));
});

describe('modeFromVercelEnv', () => {
  it('is development only under vercel dev', () => {
    expect(modeFromVercelEnv('development')).toBe('development');
    for (const e of ['production', 'preview', undefined, '']) expect(modeFromVercelEnv(e)).toBe('production');
  });
});
