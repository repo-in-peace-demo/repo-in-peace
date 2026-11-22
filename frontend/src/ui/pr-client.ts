import type { Source } from '../model/app-flow';

/**
 * The browser side of the PR function (bury-and-resurrect Req 1.2 to 1.4, 9.5): which graveyards have working actions, opening a pull
 * request, and the only links the page will open. Everything the function says is used as text; a link only if it is a pull request
 * on the expected fork (P8).
 */

export type Action = 'bury' | 'resurrect';
export type PrConfigAnswer = { available: true; demos: Record<string, { repo: string; base: string }>; fake: boolean } | { available: false };

export type PrAvailability =
  | { kind: 'available'; repo: string; fake: boolean }
  | { kind: 'local-file' }
  | { kind: 'not-configured' }
  | { kind: 'unavailable' };

export const PR_NOTES: Record<Exclude<PrAvailability['kind'], 'available'>, string> = {
  'local-file': 'Pull requests are only available on the demo graveyards.',
  'not-configured': 'Pull requests are only available on the demo graveyards.',
  unavailable: "Pull requests aren't available right now.",
};

export const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
export const NOT_UNDERSTOOD = "The server sent an answer this page doesn't understand. Try again.";
const MAX_MESSAGE = 300;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The configuration answer, checked; anything malformed counts as unreachable. */
export function parseConfigAnswer(value: unknown): PrConfigAnswer | 'unreachable' {
  if (!isRecord(value)) return 'unreachable';
  if (value['available'] === false) return { available: false };
  if (value['available'] !== true || !isRecord(value['demos']) || typeof value['fake'] !== 'boolean') return 'unreachable';
  const demos: Record<string, { repo: string; base: string }> = {};
  for (const [name, d] of Object.entries(value['demos'])) {
    if (!isRecord(d) || typeof d['repo'] !== 'string' || typeof d['base'] !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(d['repo'])) return 'unreachable';
    demos[name] = { repo: d['repo'], base: d['base'] };
  }
  return { available: true, demos, fake: value['fake'] };
}

export function availability(source: Source, config: PrConfigAnswer | 'unreachable'): PrAvailability {
  // Only a graveyard loaded by its demo name; a file opened from disk never, even with a demo's contents (Req 1.3).
  if (source.kind !== 'demo') return { kind: 'local-file' };
  if (config === 'unreachable' || !config.available) return { kind: 'unavailable' };
  const demo = config.demos[source.name];
  if (demo === undefined) return { kind: 'not-configured' };
  return { kind: 'available', repo: demo.repo, fake: config.fake };
}

export async function fetchPrConfig(fetchImpl: typeof fetch = fetch): Promise<PrConfigAnswer | 'unreachable'> {
  try {
    const response = await fetchImpl('/api/pr', { headers: { accept: 'application/json' } });
    if (!response.ok) return 'unreachable';
    return parseConfigAnswer(await response.json());
  } catch {
    return 'unreachable';
  }
}

const GITHUB_PULL = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9]\d{0,9})$/;
const FAKE_PULL = /^\/api\/fake-pr\/([1-9]\d{0,9})$/;

/** The link to open, or null: only `https://github.com/<repo>/pull/<n>` on the expected fork, or the fake page in development. */
export function safePrLink(url: unknown, repo: string, fake: boolean): string | null {
  if (typeof url !== 'string') return null;
  if (fake && FAKE_PULL.test(url)) return url;
  const m = GITHUB_PULL.exec(url);
  if (!m) return null;
  return `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase() ? url : null;
}

export type PrOutcome =
  | { kind: 'opened'; number: number; url: string | null; existing: boolean; fake: boolean }
  | { kind: 'error'; message: string };

/** A message from the server, as text, kept short; or the fallback. */
const messageFrom = (body: unknown, fallback: string): string =>
  isRecord(body) && typeof body['error'] === 'string' && body['error'].trim() !== '' ? body['error'].trim().slice(0, MAX_MESSAGE) : fallback;

export async function openPr(graveyard: string, action: Action, path: string, expected: { repo: string; fake: boolean }, fetchImpl: typeof fetch = fetch): Promise<PrOutcome> {
  let response: Response;
  try {
    response = await fetchImpl('/api/pr', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ graveyard, action, path }),
    });
  } catch {
    return { kind: 'error', message: UNREACHABLE };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'error', message: response.ok ? NOT_UNDERSTOOD : UNREACHABLE };
  }
  if (!response.ok) return { kind: 'error', message: messageFrom(body, NOT_UNDERSTOOD) };
  if (!isRecord(body) || !Number.isSafeInteger(body['number']) || (body['number'] as number) < 1) return { kind: 'error', message: NOT_UNDERSTOOD };
  return {
    kind: 'opened',
    number: body['number'] as number,
    url: safePrLink(body['url'], expected.repo, expected.fake),
    existing: body['existing'] === true,
    fake: expected.fake,
  };
}
