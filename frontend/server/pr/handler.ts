/**
 * The PR function (bury-and-resurrect design, "The HTTP contract"). Everything it needs comes in as `deps`, so tests call it with
 * Request objects, a fake GitHub and their own clock. Order of work for a POST: method and content type, body, Origin, parse,
 * throttle, configuration, the demo's data file, then GitHub (or the fake in development). Nothing reaches GitHub until every local
 * check has passed (P1). Every body and log line goes through `redact` (P5).
 */
import type { Graveyard } from '../../../shared/graveyard-schema.js';
import { branchName } from './branch.js';
import { checkAgainstGraveyard } from './check.js';
import type { ForkConfig, PrConfig } from './config.js';
import { GitHubError, githubProblem, type GitHubClient } from './github.js';
import { forkOf, openPullRequest } from './open-pr.js';
import { prTitle } from './pr-text.js';
import { redact } from './redact.js';
import { MAX_BODY_BYTES, parseRequest } from './request.js';
import type { Throttle } from './limits.js';

/** Pull requests made up in development without a token: the same grave gets the same number (Req 7.3, Decision 7). */
export interface FakePrs {
  byKey: Map<string, number>;
  titles: Map<number, string>;
  next: number;
}
export const createFakePrs = (): FakePrs => ({ byKey: new Map(), titles: new Map(), next: 1 });
export const FAKE_PR_PATH = '/api/fake-pr/';

export interface PrDeps {
  config: PrConfig | { problem: string };
  github: (token: string) => GitHubClient;
  readGraveyard: (name: string) => Promise<Graveyard>;
  /** The demo files' names, for development without RIP_DEMOS. */
  listGraveyards: () => Promise<string[]>;
  throttle: Throttle;
  clientKey: (request: Request) => string;
  log: (line: string) => void;
  fake: FakePrs;
}

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function respond(deps: PrDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  const token = 'problem' in deps.config ? undefined : deps.config.token;
  return new Response(redact(JSON.stringify(body), [token]), { status, headers: { ...HEADERS, ...extra } });
}
const fail = (deps: PrDeps, status: number, error: string, extra?: Record<string, string>): Response => respond(deps, status, { error }, extra);

/** The demos with working actions: RIP_DEMOS, or in development without it, every demo file on a made-up fork. */
async function demosOf(deps: PrDeps, config: PrConfig): Promise<ReadonlyMap<string, ForkConfig>> {
  if (config.demos.size > 0 || config.mode === 'production') return config.demos;
  const demos = new Map<string, ForkConfig>();
  for (const name of await deps.listGraveyards()) {
    const g = await deps.readGraveyard(name).catch(() => undefined);
    if (g) demos.set(name, { repo: `repo-in-peace-demo/${g.meta.name}`, base: 'main' });
  }
  return demos;
}

/** Whether actions can work at all: a valid configuration, and in production a token and at least one demo. */
const usable = (config: PrDeps['config']): config is PrConfig => !('problem' in config) && (config.mode === 'development' || (config.token !== undefined && config.demos.size > 0));

export async function handlePr(request: Request, deps: PrDeps): Promise<Response> {
  const log = (line: string): void => deps.log(redact(line, ['problem' in deps.config ? undefined : deps.config.token]));
  if (request.method === 'GET') {
    if ('problem' in deps.config) log(`pr config: ${deps.config.problem}`);
    if (!usable(deps.config)) return respond(deps, 200, { available: false });
    const demos = await demosOf(deps, deps.config);
    return respond(deps, 200, { available: true, demos: Object.fromEntries(demos), fake: deps.config.token === undefined });
  }
  if (request.method !== 'POST') return fail(deps, 405, 'Only GET and POST.', { allow: 'GET, POST' });

  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(deps, 415, 'Send the request as JSON.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(deps, 413, 'The request is too large.');
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let same = false;
    try {
      same = new URL(origin).host === new URL(request.url).host;
    } catch {
      same = false;
    }
    if (!same) return fail(deps, 403, 'Requests must come from this site.');
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(deps, 400, 'The request is not valid JSON.');
  }
  const parsed = parseRequest(body);
  if ('error' in parsed) return fail(deps, parsed.status, parsed.error);
  const { graveyard: name, action, path } = parsed;

  const took = deps.throttle.take(deps.clientKey(request));
  if (!took.ok) {
    log(`pr ${action} ${name} ${path} -> throttled`);
    return fail(deps, 429, `Too many pull requests from here; try again in ${took.retryAfterSeconds} seconds.`, { 'retry-after': String(took.retryAfterSeconds) });
  }

  if (!usable(deps.config)) {
    if ('problem' in deps.config) log(`pr config: ${deps.config.problem}`);
    return fail(deps, 503, "Pull requests aren't set up on this deployment.");
  }
  const config = deps.config;
  const fork = (await demosOf(deps, config)).get(name);
  if (!fork) return fail(deps, 404, `${name} isn't a demo graveyard with pull requests.`);

  let graveyard: Graveyard;
  try {
    graveyard = await deps.readGraveyard(name);
  } catch (error) {
    log(`pr ${action} ${name} ${path} -> no data: ${error instanceof Error ? error.message : String(error)}`);
    return fail(deps, 503, "The server can't read this demo's graveyard right now.");
  }
  const eligible = checkAgainstGraveyard(graveyard, action, path);
  if ('error' in eligible) {
    log(`pr ${action} ${name} ${path} -> refused: ${eligible.status}`);
    return fail(deps, eligible.status, eligible.error);
  }

  // Development without a token: the same checks, a made-up pull request.
  if (config.token === undefined) {
    const key = `${fork.repo}#${branchName(action, path)}`;
    const known = deps.fake.byKey.get(key);
    const number = known ?? deps.fake.next++;
    if (known === undefined) {
      deps.fake.byKey.set(key, number);
      deps.fake.titles.set(number, prTitle(eligible));
    }
    log(`pr ${action} ${name} ${path} -> fake #${number} (${known === undefined ? 'new' : 'existing'})`);
    return respond(deps, known === undefined ? 201 : 200, { number, url: `${FAKE_PR_PATH}${number}`, repo: fork.repo, existing: known !== undefined, fake: true });
  }

  try {
    const result = await openPullRequest(deps.github(config.token), forkOf(fork.repo, fork.base), eligible, graveyard, config.cap);
    if ('refused' in result) {
      log(`pr ${action} ${name} ${path} -> refused: ${result.status}`);
      return fail(deps, result.status, result.refused);
    }
    log(`pr ${action} ${name} ${path} -> #${result.number} (${result.existing ? 'existing' : 'new'})`);
    return respond(deps, result.existing ? 200 : 201, { number: result.number, url: result.url, repo: fork.repo, existing: result.existing });
  } catch (error) {
    if (error instanceof GitHubError) {
      log(`pr ${action} ${name} ${path} -> github ${error.kind} ${error.status}`);
      return fail(deps, 502, githubProblem(error, fork.repo));
    }
    log(`pr ${action} ${name} ${path} -> error: ${error instanceof Error ? error.name : 'unknown'}`);
    return fail(deps, 500, 'Something went wrong on the server. Try again.');
  }
}

/** The dev-only page a fake pull request link opens. Plain text, so nothing from the data is ever HTML. */
export function fakePrPage(number: number, fake: FakePrs): Response {
  const title = fake.titles.get(number);
  const text = title === undefined
    ? `There is no fake pull request #${number}.`
    : `This is a fake pull request #${number} from local development: ${title}\nNo request was sent to GitHub.`;
  return new Response(text, { status: title === undefined ? 404 : 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

/** The client a throttle counts by: the first address in x-forwarded-for (set by Vercel), else x-real-ip, else one shared key. */
export function clientKeyFromHeaders(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}
