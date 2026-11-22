import { afterEach, describe, expect, it } from 'vitest';
import { blobSha } from './git-trees';
import { startFakeGitHub, type FakeGitHub } from './fake-github';

const OWNER = 'repo-in-peace-demo';
const REPO = 'oikos_ledger';
const file = (content: string, mode = '100644') => ({ mode, sha: blobSha(content) });
const v1 = new Map([
  ['src/a.ts', file('a')],
  ['src/ghost.ts', file('ghost')],
  ['tool.sh', file('#!', '100755')],
]);
const v2 = new Map([...v1].filter(([p]) => p !== 'src/ghost.ts'));

let fake: FakeGitHub;
afterEach(async () => fake?.close());

const call = async (method: string, path: string, body?: unknown, token = fake.token) => {
  const res = await fetch(`${fake.url}/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text === '' ? undefined : JSON.parse(text), headers: res.headers };
};

describe('the fake GitHub server', () => {
  it('serves a history, and a one-path tree change and commit read back as GitHub would return them', async () => {
    fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: v1, message: 'one' }, { files: v2, message: 'remove ghost' }] }]);
    const [first, second] = fake.history(OWNER, REPO) as [string, string];
    expect((await call('GET', '/git/ref/heads/main')).data.object.sha).toBe(second);
    const head = await call('GET', `/git/commits/${second}`);
    expect(head.data.parents).toEqual([{ sha: first }]);

    // Walk one folder, as the function does.
    const root = await call('GET', `/git/trees/${head.data.tree.sha}`);
    expect(root.data.tree.map((e: { path: string }) => e.path)).toEqual(['src', 'tool.sh']);
    expect((await call('GET', `/git/trees/${head.data.tree.sha}?recursive=1`)).status).toBe(400);

    // Restore the ghost with its old blob.
    const tree = await call('POST', '/git/trees', { base_tree: head.data.tree.sha, tree: [{ path: 'src/ghost.ts', mode: '100644', type: 'blob', sha: blobSha('ghost') }] });
    expect(tree.status).toBe(201);
    const commit = await call('POST', '/git/commits', { message: 'Resurrect src/ghost.ts', tree: tree.data.sha, parents: [second] });
    expect(commit.status).toBe(201);
    expect(fake.filesAt(OWNER, REPO, commit.data.sha)).toEqual(v1);

    // Deleting a missing path is refused, as on GitHub.
    expect((await call('POST', '/git/trees', { base_tree: head.data.tree.sha, tree: [{ path: 'nope.ts', mode: '100644', type: 'blob', sha: null }] })).status).toBe(422);
  });

  it('creates, refuses to recreate, force-updates and deletes references', async () => {
    fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: v1, message: 'one' }] }]);
    const [sha] = fake.history(OWNER, REPO) as [string];
    expect((await call('POST', '/git/refs', { ref: 'refs/heads/rip/bury/x', sha })).status).toBe(201);
    expect((await call('POST', '/git/refs', { ref: 'refs/heads/rip/bury/x', sha })).data.message).toBe('Reference already exists');
    expect((await call('PATCH', '/git/refs/heads/rip/bury/x', { sha, force: true })).status).toBe(200);
    expect((await call('GET', '/git/matching-refs/heads/rip/')).data).toHaveLength(1);
    expect((await call('DELETE', '/git/refs/heads/rip/bury/x')).status).toBe(204);
    expect(fake.ref(OWNER, REPO, 'rip/bury/x')).toBeUndefined();
  });

  it('opens pull requests once per head, lists them by head and in pages, and closes them', async () => {
    fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: v1, message: 'one' }] }]);
    const [sha] = fake.history(OWNER, REPO) as [string];
    await call('POST', '/git/refs', { ref: 'refs/heads/rip/bury/x', sha });
    const pr = await call('POST', '/pulls', { title: 'RIP x', body: 'b', head: 'rip/bury/x', base: 'main' });
    expect(pr.status).toBe(201);
    expect(pr.data.html_url).toBe(`https://github.com/${OWNER}/${REPO}/pull/1`);
    const again = await call('POST', '/pulls', { title: 'RIP x', body: 'b', head: 'rip/bury/x', base: 'main' });
    expect(again.status).toBe(422);
    expect(again.data.errors[0].message).toMatch(/A pull request already exists/);
    expect((await call('GET', `/pulls?state=open&head=${OWNER}:rip/bury/x`)).data.map((p: { number: number }) => p.number)).toEqual([1]);

    for (let i = 0; i < 120; i++) fake.addPull(OWNER, REPO, { title: 't', body: '', head: `rip/bury/n${i}`, base: 'main', state: 'open' });
    const page1 = await call('GET', '/pulls?state=open&per_page=100');
    expect(page1.data).toHaveLength(100);
    expect(page1.headers.get('link')).toMatch(/rel="next"/);
    expect((await call('GET', '/pulls?state=open&per_page=100&page=2')).data).toHaveLength(21);

    expect((await call('PATCH', '/pulls/1', { state: 'closed' })).data.state).toBe('closed');
    expect((await call('GET', `/pulls?state=open&head=${OWNER}:rip/bury/x`)).data).toEqual([]);
  });

  it('wants the token, records every request, and fails on demand', async () => {
    fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: v1, message: 'one' }] }]);
    expect((await call('GET', '/git/ref/heads/main', undefined, 'wrong')).status).toBe(401);
    fake.fail({ method: 'GET', path: /\/git\/ref\//, times: 1, status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: `API rate limit exceeded for ${fake.token}` } });
    const limited = await call('GET', '/git/ref/heads/main');
    expect(limited.status).toBe(403);
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    expect((await call('GET', '/git/ref/heads/main')).status).toBe(200);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /repos/${OWNER}/${REPO}/git/ref/heads/main`,
      `GET /repos/${OWNER}/${REPO}/git/ref/heads/main`,
      `GET /repos/${OWNER}/${REPO}/git/ref/heads/main`,
    ]);
    expect((await call('GET', '/nope')).status).toBe(404);
  });
});
