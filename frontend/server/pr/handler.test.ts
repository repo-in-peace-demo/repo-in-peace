import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Graveyard } from '../../../shared/graveyard-schema';
import { makeSyntheticGraveyard } from '../../src/model/synthetic';
import { startFakeGitHub, type FakeGitHub } from '../../test/fake-github';
import { blobSha } from '../../test/git-trees';
import { readConfig, type Mode } from './config';
import { githubClient } from './github';
import { graveyardReader } from './graveyards';
import { clientKeyFromHeaders, createFakePrs, fakePrPage, handlePr, type PrDeps } from './handler';
import { Throttle } from './limits';

const OWNER = 'repo-in-peace-demo';
const NAME = 'demo.synthetic';
const SITE = 'https://repo-in-peace.example';

/** A synthetic graveyard, and a fake fork whose first commit has its files and ghosts and whose base head has its files. */
let fake: FakeGitHub;
let graveyard: Graveyard;
beforeAll(async () => {
  const g = makeSyntheticGraveyard({ files: 40, seed: 11, ghosts: 4 });
  const all = new Map([...g.files.map((f) => f.path), ...g.ghosts.map((x) => x.path)].map((p) => [p, { mode: '100644', sha: blobSha(p) }]));
  const now = new Map(g.files.map((f) => [f.path, { mode: '100644', sha: blobSha(f.path) }]));
  fake = await startFakeGitHub([{ owner: OWNER, repo: 'synthetic', base: 'main', history: [{ files: all, message: 'all' }, { files: now, message: 'ghosts gone' }] }]);
  const [first, second] = fake.history(OWNER, 'synthetic') as [string, string];
  graveyard = { ...g, ghosts: g.ghosts.map((x) => ({ ...x, lastExistingSha: first, deletedInSha: second })) };
});
afterAll(async () => fake?.close());

function deps(over: { env?: Record<string, string | undefined>; mode?: Mode; throttle?: Throttle; readGraveyard?: PrDeps['readGraveyard']; lines?: string[] } = {}): PrDeps {
  const env = over.env ?? { GITHUB_TOKEN: fake.token, RIP_DEMOS: JSON.stringify({ [NAME]: { repo: `${OWNER}/synthetic`, base: 'main' } }) };
  return {
    config: readConfig(env, over.mode ?? 'production'),
    github: (token) => githubClient(token, fake.url),
    readGraveyard: over.readGraveyard ?? (async (n) => {
      if (n !== NAME) throw new Error(`no ${n}`);
      return graveyard;
    }),
    listGraveyards: async () => [NAME],
    throttle: over.throttle ?? new Throttle([{ limit: 1_000_000, windowMs: 1000 }]),
    clientKey: clientKeyFromHeaders,
    log: (line) => over.lines?.push(line),
    fake: createFakePrs(),
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/pr`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = () => new Request(`${SITE}/api/pr`);
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown>, headers: r.headers });

describe('GET /api/pr', () => {
  it('lists the configured demos, and says whether pull requests are fake', async () => {
    expect((await json(await handlePr(get(), deps()))).body).toEqual({ available: true, demos: { [NAME]: { repo: `${OWNER}/synthetic`, base: 'main' } }, fake: false });
  });

  it('is unavailable in production without a token, with no demos, or with a broken configuration', async () => {
    for (const env of [{}, { GITHUB_TOKEN: 'x' }, { RIP_DEMOS: JSON.stringify({ [NAME]: { repo: 'a/b', base: 'main' } }) }, { GITHUB_TOKEN: 'x', RIP_DEMOS: '{broken' }]) {
      expect((await json(await handlePr(get(), deps({ env })))).body).toEqual({ available: false });
    }
  });

  it('in development without RIP_DEMOS, offers every demo file on a made-up fork, with fake pull requests', async () => {
    expect((await json(await handlePr(get(), deps({ env: {}, mode: 'development' })))).body).toEqual({
      available: true,
      demos: { [NAME]: { repo: `repo-in-peace-demo/${graveyard.meta.name}`, base: 'main' } },
      fake: true,
    });
  });

  it('says nothing is cached and the type is sniff-proof', async () => {
    const r = await handlePr(get(), deps());
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('P1 end to end: only eligible requests reach GitHub', () => {
  it('accepts exactly Bury on unused files and Resurrect on ghosts of the configured demo; nothing else calls GitHub', async () => {
    const unused = graveyard.files.filter((f) => f.unused).map((f) => f.path);
    const used = graveyard.files.filter((f) => !f.unused).map((f) => f.path);
    const ghosts = graveyard.ghosts.map((g) => g.path);
    expect(unused.length).toBeGreaterThan(0);
    const bodyArb = fc.oneof(
      fc.record({
        graveyard: fc.constantFrom(NAME, 'demo.other', 'bad name'),
        action: fc.constantFrom('bury', 'resurrect', 'delete'),
        path: fc.oneof(fc.constantFrom(...unused, ...used, ...ghosts), fc.constant('nowhere.ts'), fc.integer()),
        repo: fc.constant('attacker/repo'),
        eulogy: fc.constant('@everyone'),
      }),
      fc.constantFrom('not json', '[]', 'null', '{"graveyard":1}'),
    );
    const d = deps();
    await fc.assert(
      fc.asyncProperty(bodyArb, async (body) => {
        const before = fake.requests.length;
        const r = await handlePr(post(body), d);
        const b = typeof body === 'object' ? body : undefined;
        const eligible =
          b !== undefined && b.graveyard === NAME && typeof b.path === 'string' &&
          ((b.action === 'bury' && unused.includes(b.path)) || (b.action === 'resurrect' && ghosts.includes(b.path)));
        if (eligible) {
          expect([200, 201]).toContain(r.status);
          expect(fake.requests.length).toBeGreaterThan(before);
          const answer = (await r.json()) as { repo: string; url: string };
          expect(answer.repo).toBe(`${OWNER}/synthetic`); // never the repo the browser sent
          expect(answer.url).toMatch(new RegExp(`^https://github.com/${OWNER}/synthetic/pull/\\d+$`));
        } else {
          expect([400, 404, 409]).toContain(r.status);
          expect(fake.requests.length).toBe(before);
        }
      }),
      { numRuns: 150 },
    );
    // The pull requests opened carry nothing the browser sent.
    for (const p of fake.pulls(OWNER, 'synthetic')) expect(p.body).not.toContain('@everyone');
  });
});

describe('P5: the token never leaves', () => {
  it('not in responses, headers or log lines, whatever GitHub answers', async () => {
    const lines: string[] = [];
    const d = deps({ lines });
    const target = graveyard.files.filter((f) => f.unused).at(-1)!.path;
    for (const failure of [
      { status: 403, body: { message: `Resource not accessible by ${fake.token}` }, headers: { 'x-ratelimit-remaining': '0', 'x-echo': fake.token } },
      { status: 500, body: { message: fake.token } },
      { status: 422, body: { message: `Reference already exists ${fake.token}` } },
      { status: 401, body: { message: `Bad credentials: ${fake.token}` } },
    ]) {
      // P1 may have opened a pull request for this file already (its paths are random); an open one would be returned before any
      // tree is made, leaving the failure unused for the next test. Closing them makes every request here reach the failing call.
      for (const pull of fake.pulls(OWNER, 'synthetic')) pull.state = 'closed';
      fake.fail({ method: 'POST', path: /\/git\/trees$/, times: 1, ...failure });
      const r = await handlePr(post({ graveyard: NAME, action: 'bury', path: target }), d);
      expect(r.status).toBe(502);
      const text = await r.text();
      expect(text).not.toContain(fake.token);
      for (const [, v] of r.headers) expect(v).not.toContain(fake.token);
    }
    // A read failure whose message carries the token.
    const broken = deps({ lines, readGraveyard: async () => { throw new Error(`cannot read with ${fake.token}`); } });
    const r = await handlePr(post({ graveyard: NAME, action: 'bury', path: target }), broken);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain(fake.token);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) expect(line).not.toContain(fake.token);
  });
});

describe('P6 end to end: the throttle', () => {
  it('refuses over the limit with Retry-After, and a refused request calls nothing', async () => {
    let now = 0;
    const d = deps({ throttle: new Throttle([{ limit: 2, windowMs: 60_000 }], () => now) });
    const target = graveyard.files.find((f) => f.unused)!.path;
    const from = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    expect((await handlePr(post({ graveyard: NAME, action: 'bury', path: target }, from), d)).status).toBeLessThan(300);
    expect((await handlePr(post({ graveyard: NAME, action: 'bury', path: target }, from), d)).status).toBeLessThan(300);
    const before = fake.requests.length;
    const third = await handlePr(post({ graveyard: NAME, action: 'bury', path: target }, from), d);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('60');
    expect(((await third.json()) as { error: string }).error).toBe('Too many pull requests from here; try again in 60 seconds.');
    expect(fake.requests.length).toBe(before);
    // Another client is not held back.
    expect((await handlePr(post({ graveyard: NAME, action: 'bury', path: target }, { 'x-forwarded-for': '198.51.100.2' }), d)).status).toBeLessThan(300);
    now += 60_000;
    expect((await handlePr(post({ graveyard: NAME, action: 'bury', path: target }, from), d)).status).toBeLessThan(300);
  });
});

describe('the rest of the contract', () => {
  const target = () => graveyard.files.find((f) => f.unused)!.path;

  it('refuses every action in production without a token', async () => {
    const r = await json(await handlePr(post({ graveyard: NAME, action: 'bury', path: target() }), deps({ env: { RIP_DEMOS: JSON.stringify({ [NAME]: { repo: 'a/b', base: 'main' } }) } })));
    expect(r).toMatchObject({ status: 503, body: { error: "Pull requests aren't set up on this deployment." } });
  });

  it('makes up pull requests in development without a token, after the same checks, the same number for the same grave', async () => {
    const d = deps({ env: {}, mode: 'development' });
    const ghost = graveyard.ghosts[0]!.path;
    const a = await json(await handlePr(post({ graveyard: NAME, action: 'bury', path: target() }), d));
    const b = await json(await handlePr(post({ graveyard: NAME, action: 'resurrect', path: ghost }), d));
    const again = await json(await handlePr(post({ graveyard: NAME, action: 'bury', path: target() }), d));
    expect(a).toMatchObject({ status: 201, body: { number: 1, url: '/api/fake-pr/1', existing: false, fake: true } });
    expect(b).toMatchObject({ status: 201, body: { number: 2, url: '/api/fake-pr/2' } });
    expect(again).toMatchObject({ status: 200, body: { number: 1, existing: true } });
    expect((await json(await handlePr(post({ graveyard: NAME, action: 'bury', path: graveyard.files.find((f) => !f.unused)!.path }), d))).status).toBe(409);
    const page = fakePrPage(1, d.fake);
    expect(await page.text()).toBe(`This is a fake pull request #1 from local development: RIP ${target()}\nNo request was sent to GitHub.`);
    expect(page.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(fakePrPage(99, d.fake).status).toBe(404);
  });

  it.each([
    ['a wrong content type', () => new Request(`${SITE}/api/pr`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }), 415],
    ['too large a body', () => post(JSON.stringify({ graveyard: NAME, action: 'bury', path: 'x'.repeat(3000) })), 413],
    ['a cross-site origin', () => post({ graveyard: NAME, action: 'bury', path: 'x' }, { origin: 'https://evil.example' }), 403],
    ['a malformed origin', () => post({ graveyard: NAME, action: 'bury', path: 'x' }, { origin: 'null' }), 403],
    ['another method', () => new Request(`${SITE}/api/pr`, { method: 'DELETE' }), 405],
    ['an unknown demo', () => post({ graveyard: 'demo.other', action: 'bury', path: 'x' }), 404],
  ])('answers %s with %i', async (_label, request, status) => {
    expect((await handlePr(request(), deps())).status).toBe(status);
  });

  it('accepts a request with no Origin header (same-site fetches may omit it)', async () => {
    const r = await handlePr(new Request(`${SITE}/api/pr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ graveyard: NAME, action: 'bury', path: target() }) }), deps());
    expect(r.status).toBeLessThan(300);
  });

  it('logs one line per request, with no body from GitHub', async () => {
    const lines: string[] = [];
    await handlePr(post({ graveyard: NAME, action: 'bury', path: target() }), deps({ lines }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^pr bury ${NAME} ${target().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -> #\\d+ \\((new|existing)\\)$`));
  });
});

describe('the demo data files', () => {
  it('reads and validates the real demo files, and refuses unknown or odd names', async () => {
    const reader = graveyardReader();
    expect((await reader.list()).sort()).toEqual(['demo.oikosledger', 'demo.spatialql']);
    expect((await reader.read('demo.spatialql')).meta.name).toBe('spatialql');
    await expect(reader.read('demo.nope')).rejects.toThrow(/no data file/);
    await expect(reader.read('../secrets')).rejects.toThrow(/not a graveyard name/);
  });
});
