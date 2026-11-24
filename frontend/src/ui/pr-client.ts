import type { Source } from '../model/app-flow';
import { TIMED_OUT } from './pr-progress';

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

/** A grave of the demo with an open Repo In Peace pull request on its fork (GET /api/pr?open=<demo>). */
export interface OpenPr {
  action: Action;
  path: string;
  number: number;
  /** Null when the link is not one the page may open (`safePrLink`): the number is then shown as text. */
  url: string | null;
}

/** The open pull requests answer, checked: anything malformed is dropped, and a bad answer is no list at all. */
export function parseOpenAnswer(value: unknown, expected: { repo: string; fake: boolean }): OpenPr[] {
  if (!isRecord(value) || !Array.isArray(value['open'])) return [];
  const out: OpenPr[] = [];
  for (const p of value['open']) {
    if (!isRecord(p) || (p['action'] !== 'bury' && p['action'] !== 'resurrect') || typeof p['path'] !== 'string') continue;
    if (!Number.isSafeInteger(p['number']) || (p['number'] as number) < 1) continue;
    out.push({ action: p['action'], path: p['path'], number: p['number'] as number, url: safePrLink(p['url'], expected.repo, expected.fake) });
  }
  return out;
}

/** The demo's open pull requests, or none when the function can't say (the page then shows the data file as it is). */
export async function fetchOpenPrs(graveyard: string, expected: { repo: string; fake: boolean }, fetchImpl: typeof fetch = fetch): Promise<OpenPr[]> {
  try {
    const response = await fetchImpl(`/api/pr?open=${encodeURIComponent(graveyard)}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    return parseOpenAnswer(await response.json(), expected);
  } catch {
    return [];
  }
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

/** @param signal aborts the wait (the page gives up after about 30 s); the server may still finish, and a retry then returns that pull request. */
export async function openPr(
  graveyard: string,
  action: Action,
  path: string,
  expected: { repo: string; fake: boolean },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PrOutcome> {
  let response: Response;
  try {
    response = await fetchImpl('/api/pr', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ graveyard, action, path }),
      signal,
    });
  } catch {
    return { kind: 'error', message: signal?.aborted ? TIMED_OUT : UNREACHABLE };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (signal?.aborted) return { kind: 'error', message: TIMED_OUT };
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
