import { afterEach, describe, expect, it } from 'vitest';
import { githubClient } from '../server/pr/github';
import { startFakeGitHub, type FakeGitHub } from '../test/fake-github';
import { blobSha } from '../test/git-trees';
import { resetDemoPrs } from './reset-demo-prs';

const OWNER = 'repo-in-peace-demo';
let fake: FakeGitHub;
afterEach(async () => fake?.close());

async function setUp() {
  const files = new Map([['a.ts', { mode: '100644', sha: blobSha('a') }]]);
  fake = await startFakeGitHub([
    { owner: OWNER, repo: 'one', base: 'main', history: [{ files, message: 'x' }] },
    { owner: OWNER, repo: 'two', base: 'main', history: [{ files, message: 'x' }] },
  ]);
  for (const repo of ['one', 'two']) {
    const [sha] = fake.history(OWNER, repo) as [string];
    for (const b of ['rip/bury/a-1', 'rip/resurrect/b-2', 'feature/keep']) fake.setRef(OWNER, repo, b, sha);
    fake.addPull(OWNER, repo, { title: 'RIP a', body: '', head: 'rip/bury/a-1', base: 'main', state: 'open' });
    fake.addPull(OWNER, repo, { title: 'Resurrect b', body: '', head: 'rip/resurrect/b-2', base: 'main', state: 'closed' });
    fake.addPull(OWNER, repo, { title: 'Someone else', body: '', head: 'feature/keep', base: 'main', state: 'open' });
  }
  return githubClient(fake.token, fake.url);
}

describe('the reset command', () => {
  it('in a dry run, lists what it would close and delete, and changes nothing', async () => {
    const gh = await setUp();
    const lines: string[] = [];
    const before = fake.requests.length;
    expect(await resetDemoPrs(gh, [`${OWNER}/one`, `${OWNER}/two`], { dryRun: true, log: (l) => lines.push(l) })).toEqual({ closed: 2, deleted: 4 });
    expect(fake.requests.slice(before).every((r) => r.method === 'GET')).toBe(true);
    expect(lines).toContain(`${OWNER}/one: would close #1 RIP a`);
    expect(lines).toContain(`${OWNER}/two: would delete branch rip/resurrect/b-2`);
    expect(lines.at(-1)).toBe('Would close 2 pull requests and would delete 4 branches on 2 forks.');
    expect(fake.pulls(OWNER, 'one').filter((p) => p.state === 'open')).toHaveLength(2);
  });

  it('closes only Repo In Peace pull requests and deletes only rip/ branches', async () => {
    const gh = await setUp();
    expect(await resetDemoPrs(gh, [`${OWNER}/one`, `${OWNER}/two`], { dryRun: false, log: () => {} })).toEqual({ closed: 2, deleted: 4 });
    for (const repo of ['one', 'two']) {
      expect(fake.pulls(OWNER, repo).map((p) => [p.head, p.state])).toEqual([
        ['rip/bury/a-1', 'closed'],
        ['rip/resurrect/b-2', 'closed'],
        ['feature/keep', 'open'],
      ]);
      expect(fake.ref(OWNER, repo, 'rip/bury/a-1')).toBeUndefined();
      expect(fake.ref(OWNER, repo, 'rip/resurrect/b-2')).toBeUndefined();
      expect(fake.ref(OWNER, repo, 'feature/keep')).toBeDefined();
      expect(fake.ref(OWNER, repo, 'main')).toBeDefined();
    }
    // A second run finds nothing to do.
    expect(await resetDemoPrs(gh, [`${OWNER}/one`, `${OWNER}/two`], { dryRun: false, log: () => {} })).toEqual({ closed: 0, deleted: 0 });
  });
});
