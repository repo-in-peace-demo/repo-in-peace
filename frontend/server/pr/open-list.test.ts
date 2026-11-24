import { afterEach, describe, expect, it } from 'vitest';
import type { FileEntry, Ghost, Graveyard } from '../../../shared/graveyard-schema';
import { startFakeGitHub, type FakeGitHub } from '../../test/fake-github';
import { blobSha } from '../../test/git-trees';
import { branchName } from './branch';
import { readConfig } from './config';
import { githubClient } from './github';
import { clientKeyFromHeaders, createFakePrs, handlePr, type PrDeps } from './handler';
import { Throttle } from './limits';
import { OPEN_CACHE_MS, OpenPullCache, listOpenPulls } from './open-list';

const OWNER = 'repo-in-peace-demo';
const REPO = 'oikos_ledger';
const NAME = 'demo.oikosledger';
const SITE = 'https://repo-in-peace.example';
const file = (path: string, unused: boolean): FileEntry => ({
  path, folder: 'src', linesOfCode: 3, lastCommitDate: '2026-07-01T00:00:00.000Z', lastCommitAuthor: 'Ann', recentCommits: 0, unused,
  decayScore: unused ? 0.8 : 0.2, decayState: 'stale', hot: false, eulogy: '',
});
const ghost: Ghost = { path: 'src/ghost.ts', deletedInSha: 'b'.repeat(40), deletedDate: '2026-08-01T00:00:00.000Z', deletedBy: 'Bob', lastExistingSha: 'a'.repeat(40) };
const graveyard: Graveyard = {
  meta: { name: REPO, snapshotSha: 'c'.repeat(40), snapshotDate: '2026-08-18T00:00:00.000Z', analysedAt: '2026-08-19T00:00:00.000Z', schemaVersion: 2,
    thresholds: { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 } },
  folders: [{ path: '', parent: null }, { path: 'src', parent: '' }],
  files: [file('src/a.ts', true), file('src/b.ts', true), file('src/used.ts', false)],
  ghosts: [ghost],
};

let fake: FakeGitHub;
afterEach(async () => fake?.close());

async function setUp(): Promise<FakeGitHub> {
  fake = await startFakeGitHub([{ owner: OWNER, repo: REPO, base: 'main', history: [{ files: new Map([['src/a.ts', { mode: '100644', sha: blobSha('a') }]]), message: 'one' }] }]);
  return fake;
}
const pull = (head: string, state: 'open' | 'closed') => ({ title: head, body: '', head, base: 'main', state });

function deps(gh: FakeGitHub, now = { t: 0 }): PrDeps {
  return {
    config: readConfig({ GITHUB_TOKEN: gh.token, RIP_DEMOS: JSON.stringify({ [NAME]: { repo: `${OWNER}/${REPO}`, base: 'main' } }) }, 'production'),
    github: (token) => githubClient(token, gh.url),
    readGraveyard: async () => graveyard,
    listGraveyards: async () => [NAME],
    throttle: new Throttle(),
    clientKey: clientKeyFromHeaders,
    log: () => {},
    fake: createFakePrs(),
    openCache: new OpenPullCache(() => now.t),
  };
}
const getOpen = async (d: PrDeps, name = NAME) => {
  const r = await handlePr(new Request(`${SITE}/api/pr?open=${encodeURIComponent(name)}`), d);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const pullCalls = (gh: FakeGitHub) => gh.requests.filter((r) => r.method === 'GET' && r.path.includes('/pulls')).length;

describe('GET /api/pr?open=<demo>', () => {
  it('lists the open pull requests of graves the data file offers, with their action, path and link; closed ones are not listed', async () => {
    const gh = await setUp();
    const a = gh.addPull(OWNER, REPO, pull(branchName('bury', 'src/a.ts'), 'open'));
    gh.addPull(OWNER, REPO, pull(branchName('bury', 'src/b.ts'), 'closed'));
    const g = gh.addPull(OWNER, REPO, pull(branchName('resurrect', 'src/ghost.ts'), 'open'));
    // Not ours: a branch no grave would use, a Bury on a file that is used, someone else's pull request.
    gh.addPull(OWNER, REPO, pull('feature/x', 'open'));
    gh.addPull(OWNER, REPO, pull(branchName('bury', 'src/used.ts'), 'open'));
    const { status, body } = await getOpen(deps(gh));
    expect(status).toBe(200);
    expect(body['open']).toEqual([
      { action: 'resurrect', path: 'src/ghost.ts', number: g.number, url: `https://github.com/${OWNER}/${REPO}/pull/${g.number}` },
      { action: 'bury', path: 'src/a.ts', number: a.number, url: `https://github.com/${OWNER}/${REPO}/pull/${a.number}` },
    ].sort((x, y) => (x.path < y.path ? -1 : 1)));
    expect(pullCalls(gh)).toBe(1); // one call for the fork
  });

  it('lists nothing when there are none, or only closed ones', async () => {
    const gh = await setUp();
    expect((await getOpen(deps(gh))).body['open']).toEqual([]);
    gh.addPull(OWNER, REPO, pull(branchName('bury', 'src/a.ts'), 'closed'));
    const d = deps(gh);
    expect((await getOpen(d)).body['open']).toEqual([]);
  });

  it('asks GitHub at most once a minute per fork; a pull request opened meanwhile is added at once', async () => {
    const gh = await setUp();
    const now = { t: 1_000 };
    const d = deps(gh, now);
    expect((await getOpen(d)).body['open']).toEqual([]);
    gh.addPull(OWNER, REPO, pull(branchName('bury', 'src/a.ts'), 'open'));
    now.t += OPEN_CACHE_MS - 1;
    expect((await getOpen(d)).body['open']).toEqual([]); // cached
    expect(pullCalls(gh)).toBe(1);
    d.openCache.add(`${OWNER}/${REPO}`, { action: 'bury', path: 'src/b.ts', number: 77, url: 'u' });
    expect(((await getOpen(d)).body['open'] as Array<{ path: string }>).map((p) => p.path)).toEqual(['src/b.ts']);
    now.t += 2;
    expect(((await getOpen(d)).body['open'] as Array<{ path: string }>).map((p) => p.path)).toEqual(['src/a.ts']); // fresh from GitHub
    expect(pullCalls(gh)).toBe(2);
  });

  it('refuses an unknown demo; says when GitHub cannot be asked', async () => {
    const gh = await setUp();
    expect((await getOpen(deps(gh), 'demo.nope')).status).toBe(404);
    const d = deps(gh);
    gh.fail({ method: 'GET', path: /\/pulls/, status: 500 });
    expect((await getOpen(d)).status).toBe(502);
  });

  it('in development without a token, lists the pull requests this server made up', async () => {
    const gh = await setUp();
    const d: PrDeps = { ...deps(gh), config: readConfig({}, 'development') };
    const demos = (await (await handlePr(new Request(`${SITE}/api/pr`), d)).json()) as { demos: Record<string, unknown> };
    expect(Object.keys(demos.demos)).toEqual([NAME]);
    const post = (action: string, path: string) =>
      handlePr(new Request(`${SITE}/api/pr`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE }, body: JSON.stringify({ graveyard: NAME, action, path }) }), d);
    expect((await getOpen(d)).body['open']).toEqual([]);
    const made = (await (await post('bury', 'src/b.ts')).json()) as { number: number };
    expect((await getOpen(d)).body).toEqual({ open: [{ action: 'bury', path: 'src/b.ts', number: made.number, url: `/api/fake-pr/${made.number}` }], fake: true });
  });
});

describe('listOpenPulls', () => {
  it('is one call to the open pulls of the fork', async () => {
    const gh = await setUp();
    await listOpenPulls(githubClient(gh.token, gh.url), { owner: OWNER, repo: REPO, base: 'main' }, graveyard);
    expect(gh.requests.map((r) => `${r.method} ${r.path}`)).toEqual([`GET /repos/${OWNER}/${REPO}/pulls?state=open&per_page=100`]);
  });
});
