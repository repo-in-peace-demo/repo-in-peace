import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../server/pr/config';
import { githubClient } from '../server/pr/github';
import { graveyardReader } from '../server/pr/graveyards';
import { clientKeyFromHeaders, createFakePrs, type PrDeps } from '../server/pr/handler';
import { Throttle } from '../server/pr/limits';
import { apiMiddleware } from './api-dev';

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
});

/** The middleware on a plain node:http server, with "next" answering 404 as Vite would pass the request on. */
async function serve(): Promise<string> {
  const reader = graveyardReader();
  const deps: PrDeps = {
    config: readConfig({}, 'development'),
    github: (t) => githubClient(t),
    readGraveyard: reader.read,
    listGraveyards: reader.list,
    throttle: new Throttle(),
    clientKey: clientKeyFromHeaders,
    log: () => {},
    fake: createFakePrs(),
  };
  const middleware = apiMiddleware(deps);
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('vite');
    }),
  );
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('the dev plugin', () => {
  it('serves /api/pr with the fake flow on the real demo files, and the fake pull request page', async () => {
    const base = await serve();
    const config = (await (await fetch(`${base}/api/pr`)).json()) as { available: boolean; fake: boolean; demos: Record<string, { repo: string }> };
    expect(config).toMatchObject({ available: true, fake: true });
    expect(Object.keys(config.demos).sort()).toEqual(['demo.oikosledger', 'demo.spatialql']);
    expect(config.demos['demo.spatialql']!.repo).toBe('repo-in-peace-demo/spatialql');

    const g = (await graveyardReader().read('demo.spatialql'));
    const ghost = g.ghosts[0]!.path;
    const opened = await fetch(`${base}/api/pr`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ graveyard: 'demo.spatialql', action: 'resurrect', path: ghost }) });
    expect(opened.status).toBe(201);
    const answer = (await opened.json()) as { number: number; url: string };
    expect(answer).toMatchObject({ number: 1, url: '/api/fake-pr/1' });
    const page = await fetch(`${base}${answer.url}`);
    expect(await page.text()).toBe(`This is a fake pull request #1 from local development: Resurrect ${ghost}\nNo request was sent to GitHub.`);
  });

  it('passes everything else on to Vite', async () => {
    const base = await serve();
    for (const p of ['/', '/api/other', '/api/pr/extra', '/api/fake-pr/x', '/graveyards/index.json']) expect(await (await fetch(`${base}${p}`)).text()).toBe('vite');
  });

  it('keeps the same-site check: a POST from another origin is refused', async () => {
    const base = await serve();
    const r = await fetch(`${base}/api/pr`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    expect(r.status).toBe(403);
  });
});
