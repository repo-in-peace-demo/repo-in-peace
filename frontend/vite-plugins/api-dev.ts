import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { readConfig } from '../server/pr/config';
import { githubClient } from '../server/pr/github';
import { graveyardReader } from '../server/pr/graveyards';
import { FAKE_PR_PATH, clientKeyFromHeaders, createFakePrs, fakePrPage, handlePr, type PrDeps } from '../server/pr/handler';
import { Throttle } from '../server/pr/limits';
import { OpenPullCache } from '../server/pr/open-list';

/**
 * The PR function in `npm run dev` (bury-and-resurrect Decision 1): `/api/pr` goes to the same handler Vercel runs, in development mode,
 * and `/api/fake-pr/<n>` shows a fake pull request. Configuration comes from `frontend/.env.local` (through Vite's loadEnv, unprefixed,
 * so it never reaches the browser bundle) and the environment. `RIP_FAKE_PRS=1` drops the token, so the e2e tests never open a real
 * pull request even when `.env.local` holds one.
 */
const KEYS = ['GITHUB_TOKEN', 'RIP_DEMOS', 'RIP_PR_CAP', 'RIP_FAKE_PRS'] as const;
const MAX_READ = 64 * 1024;

export function apiDev(): Plugin {
  return {
    name: 'repo-in-peace-api-dev',
    // The dev server only: not a build, and not Vitest's own server (which reads this config too).
    apply: (_config, env) => env.command === 'serve' && process.env['VITEST'] === undefined,
    configureServer(server) {
      const files = loadEnv(server.config.mode, server.config.root, '');
      const env: Record<string, string | undefined> = {};
      for (const key of KEYS) env[key] = process.env[key] ?? files[key];
      if (env['RIP_FAKE_PRS'] === '1') env['GITHUB_TOKEN'] = undefined;

      const graveyards = graveyardReader(server.config.root);
      const config = readConfig(env, 'development');
      const deps: PrDeps = {
        config,
        github: (token) => githubClient(token),
        readGraveyard: graveyards.read,
        listGraveyards: graveyards.list,
        // Looser than production, so trying the flow by hand and the browser tests aren't held back; still a throttle.
        throttle: new Throttle([{ limit: 120, windowMs: 60_000 }]),
        clientKey: clientKeyFromHeaders,
        log: (line) => server.config.logger.info(line, { timestamp: true }),
        fake: createFakePrs(),
        openCache: new OpenPullCache(),
      };
      if ('problem' in config) server.config.logger.warn(`PR function: ${config.problem}`);
      else server.config.logger.info(`PR function: ${config.token === undefined ? 'fake pull requests (no token)' : `real pull requests on ${[...config.demos.values()].map((d) => d.repo).join(', ') || 'no configured forks'}`}`);

      server.middlewares.use(apiMiddleware(deps));
    },
  };
}

/** Routes `/api/pr` and `/api/fake-pr/<n>` to the handler; anything else goes on to Vite. */
export function apiMiddleware(deps: PrDeps): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const fakeMatch = new RegExp(`^${FAKE_PR_PATH}(\\d+)$`).exec(path);
    if (path !== '/api/pr' && !fakeMatch) return next();
    void (async () => {
      try {
        const response = fakeMatch ? fakePrPage(Number(fakeMatch[1]), deps.fake) : await handlePr(await toRequest(req), deps);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'The dev server could not run the PR function.' }));
      }
    })();
  };
}

/** A Web Request from Node's request. The client address goes in x-forwarded-for, as Vercel sets it. */
export async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_READ) break;
      chunks.push(chunk as Buffer);
    }
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
  headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local');
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method: req.method ?? 'GET',
    headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}
