import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileEntry, Ghost, Graveyard } from '../../../shared/graveyard-schema';
import { startFakeGitHub, type FakeGitHub } from '../../test/fake-github';
import { blobSha } from '../../test/git-trees';
import { branchName } from './branch';
import type { Eligible } from './check';
import { GitHubError, githubClient, githubProblem } from './github';
import { openPullRequest, type Fork } from './open-pr';

const OWNER = 'repo-in-peace-demo';
const REPO = 'oikos_ledger';
const fork: Fork = { owner: OWNER, repo: REPO, base: 'main' };
const f = (content: string, mode = '100644') => ({ mode, sha: blobSha(content) });
// v1 has the ghost; v2 (the base head) deleted it.
const v1 = new Map([
  ['src/a.ts', f('a')],
  ['src/unused.ts', f('unused')],
  ['src/ghost.ts', f('ghost', '100755')],
  ['docs/readme.md', f('readme')],
]);
const v2 = new Map([...v1].filter(([p]) => p !== 'src/ghost.ts'));

let fake: FakeGitHub;
afterEach(async () => fake?.close());

async function setUp(timeoutMs?: number, baseFiles: Map<string, { mode: string; sha: string }> = v2) {
  fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: v1, message: 'one' }, { files: baseFiles, message: 'delete ghost' }] }]);
  const [first, second] = fake.history(OWNER, REPO) as [string, string];
  const file: FileEntry = {
    path: 'src/unused.ts', folder: 'src', linesOfCode: 3, lastCommitDate: '2026-07-01T00:00:00.000Z', lastCommitAuthor: 'Ann',
    recentCommits: 0, unused: true, decayScore: 0.8, decayState: 'ancient', hot: false, eulogy: 'It waited.',
  };
  const ghost: Ghost = { path: 'src/ghost.ts', deletedInSha: second, deletedDate: '2026-08-01T00:00:00.000Z', deletedBy: 'Bob', lastExistingSha: first };
  const graveyard: Graveyard = {
    meta: { name: REPO, snapshotSha: second, snapshotDate: '2026-08-18T00:00:00.000Z', analysedAt: '2026-08-19T00:00:00.000Z', schemaVersion: 2,
      thresholds: { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 } },
    folders: [{ path: '', parent: null }, { path: 'src', parent: '' }],
    files: [file],
    ghosts: [ghost],
  } as unknown as Graveyard;
  const gh = githubClient(fake.token, fake.url, fetch, timeoutMs);
  const bury: Eligible = { action: 'bury', file };
  const resurrect: Eligible = { action: 'resurrect', ghost };
  return { first, second, graveyard, gh, bury, resurrect, ghost, file };
}

const diff = (a: Map<string, unknown>, b: Map<string, unknown>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p))).sort();

describe('openPullRequest', () => {
  it('P3 end to end: a Bury commit removes exactly the file, on a branch from the base head, with the pull request text', async () => {
    const { gh, bury, graveyard, second } = await setUp();
    const r = await openPullRequest(gh, fork, bury, graveyard, 50);
    expect(r).toEqual({ number: 1, url: `https://github.com/${OWNER}/${REPO}/pull/1`, existing: false });
    const head = fake.ref(OWNER, REPO, branchName('bury', 'src/unused.ts'))!;
    expect(fake.commit(OWNER, REPO, head)!.parents).toEqual([second]);
    expect(diff(fake.filesAt(OWNER, REPO, second), fake.filesAt(OWNER, REPO, head))).toEqual(['src/unused.ts']);
    expect(fake.filesAt(OWNER, REPO, head).has('src/unused.ts')).toBe(false);
    const pull = fake.pulls(OWNER, REPO)[0]!;
    expect(pull).toMatchObject({ title: 'RIP src/unused.ts', head: branchName('bury', 'src/unused.ts'), base: 'main', state: 'open' });
    expect(pull.body).toContain('> It waited.');
    expect(fake.requests.some((q) => q.path.includes('recursive'))).toBe(false);
  });

  it('P3 end to end: a Resurrect commit adds exactly the file, with its original blob and mode', async () => {
    const { gh, resurrect, graveyard, second } = await setUp();
    const r = await openPullRequest(gh, fork, resurrect, graveyard, 50);
    expect(r).toMatchObject({ number: 1, existing: false });
    const head = fake.ref(OWNER, REPO, branchName('resurrect', 'src/ghost.ts'))!;
    const after = fake.filesAt(OWNER, REPO, head);
    expect(diff(fake.filesAt(OWNER, REPO, second), after)).toEqual(['src/ghost.ts']);
    expect(after.get('src/ghost.ts')).toEqual(v1.get('src/ghost.ts'));
    expect(fake.pulls(OWNER, REPO)[0]!.body).toContain('by Bob in');
    // No file content passed through the function: no blob was created or read.
    expect(fake.requests.some((q) => q.path.includes('/git/blobs'))).toBe(false);
  });

  it('P4: the same request again returns the same open pull request', async () => {
    const { gh, bury, graveyard } = await setUp();
    const a = await openPullRequest(gh, fork, bury, graveyard, 50);
    const b = await openPullRequest(gh, fork, bury, graveyard, 50);
    expect(b).toEqual({ ...a, existing: true });
    expect(fake.pulls(OWNER, REPO)).toHaveLength(1);
  });

  it('P4: requests at the same moment give one pull request, and every answer has its number', async () => {
    let raced = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), fc.constantFrom('bury', 'resurrect'), async (n, action) => {
        const s = await setUp();
        try {
          const eligible = action === 'bury' ? s.bury : s.resurrect;
          const results = await Promise.all(Array.from({ length: n }, () => openPullRequest(s.gh, fork, eligible, s.graveyard, 50)));
          const numbers = new Set(results.map((r) => ('number' in r ? r.number : -1)));
          expect(numbers.size).toBe(1);
          expect(fake.pulls(OWNER, REPO).filter((p) => p.state === 'open')).toHaveLength(1);
          expect(results.filter((r) => 'existing' in r && !r.existing).length).toBeLessThanOrEqual(1);
          // The requests overlapped: more than one reached the branch step.
          if (fake.requests.filter((q) => q.method === 'POST' && q.path.endsWith('/git/refs')).length > 1) raced++;
        } finally {
          await fake.close();
        }
      }),
      { numRuns: 12 },
    );
    expect(raced).toBeGreaterThan(6);
  });

  it('P4: after the earlier pull request was closed, a new one on the same branch, moved to a fresh commit', async () => {
    const { gh, bury, graveyard, second } = await setUp();
    await openPullRequest(gh, fork, bury, graveyard, 50);
    const branch = branchName('bury', 'src/unused.ts');
    const oldHead = fake.ref(OWNER, REPO, branch);
    fake.pulls(OWNER, REPO)[0]!.state = 'closed';
    const again = await openPullRequest(gh, fork, bury, graveyard, 50);
    expect(again).toMatchObject({ number: 2, existing: false });
    const newHead = fake.ref(OWNER, REPO, branch)!;
    expect(newHead).not.toBe(oldHead);
    expect(fake.commit(OWNER, REPO, newHead)!.parents).toEqual([second]);
    expect(fake.requests.some((q) => q.method === 'PATCH' && q.path.endsWith(branch) && (q.body as { force?: boolean }).force === true)).toBe(true);
  });

  it('refuses a Bury of a file no longer on the base branch, without a change', async () => {
    const { gh, bury, graveyard } = await setUp(undefined, new Map([...v2].filter(([p]) => p !== 'src/unused.ts')));
    const r = await openPullRequest(gh, fork, bury, graveyard, 50);
    expect(r).toEqual({ refused: 'src/unused.ts is no longer on main in repo-in-peace-demo/oikos_ledger, so there is nothing to bury.', status: 409 });
    expect(fake.requests.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('refuses a Resurrect onto a path that exists on the base branch', async () => {
    const { gh, resurrect, graveyard, first } = await setUp();
    fake.setRef(OWNER, REPO, 'main', first); // the base head still has the ghost's file
    const r = await openPullRequest(gh, fork, resurrect, graveyard, 50);
    expect(r).toEqual({ refused: 'src/ghost.ts already exists on main in repo-in-peace-demo/oikos_ledger, so there is nothing to resurrect.', status: 409 });
    expect(fake.requests.filter((q) => q.method !== 'GET')).toEqual([]);
  });

  it('refuses a Resurrect when the fork lacks the commit the file is restored from', async () => {
    const { gh, ghost, graveyard } = await setUp();
    const r = await openPullRequest(gh, fork, { action: 'resurrect', ghost: { ...ghost, lastExistingSha: 'f'.repeat(40) } }, graveyard, 50);
    expect(r).toEqual({ refused: "The fork doesn't have src/ghost.ts at fffffff.", status: 409 });
  });

  it('refuses a new one at the cap, but still returns an existing one', async () => {
    const { gh, bury, resurrect, graveyard } = await setUp();
    const existing = await openPullRequest(gh, fork, bury, graveyard, 50);
    for (let i = 0; i < 49; i++) fake.addPull(OWNER, REPO, { title: 't', body: '', head: `rip/bury/x${i}`, base: 'main', state: 'open' });
    fake.addPull(OWNER, REPO, { title: 'someone else', body: '', head: 'feature/x', base: 'main', state: 'open' }); // not counted
    expect(await openPullRequest(gh, fork, resurrect, graveyard, 50)).toEqual({
      refused: "This demo has 50 open Repo In Peace pull requests, the most it allows. It's reset regularly; try again later.",
      status: 409,
    });
    expect(await openPullRequest(gh, fork, bury, graveyard, 50)).toEqual({ ...existing, existing: true });
    expect(await openPullRequest(gh, fork, resurrect, graveyard, 51)).toMatchObject({ existing: false });
  });

  it.each([
    ['a rate limit', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, 'rate-limited', "GitHub's rate limit was reached. Try again in a few minutes."],
    ['a server error', { status: 500 }, 'server', "GitHub couldn't make the change. Try again."],
    ['a forbidden write', { status: 403 }, 'forbidden', "GitHub refused the request: the token can't write to repo-in-peace-demo/oikos_ledger."],
  ])('turns %s into a short message without GitHub\'s body or the token', async (_label, failure, kind, message) => {
    const { gh, bury, graveyard } = await setUp();
    fake.fail({ method: 'POST', path: /\/git\/trees$/, ...failure, body: { message: `Denied for token ${fake.token}` } });
    const error = await openPullRequest(gh, fork, bury, graveyard, 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe(kind);
    expect((error as GitHubError).githubMessage).not.toContain(fake.token);
    expect(githubProblem(error as GitHubError, 'repo-in-peace-demo/oikos_ledger')).toBe(message);
    expect(String(error)).not.toContain(fake.token);
  });

  it('times out a slow GitHub', async () => {
    const { bury, graveyard } = await setUp();
    fake.fail({ method: 'GET', path: /\/pulls$/, delayMs: 500, status: 200, body: [] });
    const error = await openPullRequest(githubClient(fake.token, fake.url, fetch, 50), fork, bury, graveyard, 50).catch((e: unknown) => e);
    expect((error as GitHubError).kind).toBe('timeout');
  });

  it('sends the token, the API version and a user agent, and nothing to GitHub that the data did not give', async () => {
    const { gh, bury, graveyard } = await setUp();
    await openPullRequest(gh, fork, bury, graveyard, 50);
    for (const q of fake.requests) {
      expect(q.headers['authorization']).toBe(`Bearer ${fake.token}`);
      expect(q.headers['x-github-api-version']).toBe('2026-03-10');
      expect(q.headers['user-agent']).toBe('repo-in-peace');
    }
    const post = fake.requests.find((q) => q.method === 'POST' && q.path.endsWith('/pulls'))!;
    expect(post.body).toMatchObject({ head: branchName('bury', 'src/unused.ts'), base: 'main', maintainer_can_modify: false });
  });
});
