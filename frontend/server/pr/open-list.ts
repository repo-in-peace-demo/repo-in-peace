/**
 * Which graves of a demo have an open Repo In Peace pull request on its fork (bury-and-resurrect Req 10.4, revised): one GitHub call
 * per fork, `GET /pulls?state=open` (the cap of 50 open pull requests fits in one page of 100), cached for a minute so every visitor
 * does not cost a call. A pull request counts only if its branch is the one this function would make for a grave the data file still
 * offers (Bury on an unused file, Resurrect on a ghost), on the fork itself; so its action and path come from the data file, never
 * from a title. Closed and merged pull requests are not listed.
 */
import type { Graveyard } from '../../../shared/graveyard-schema.js';
import { branchName } from './branch.js';
import type { GitHubClient } from './github.js';
import type { Fork } from './open-pr.js';

export type Action = 'bury' | 'resurrect';
export interface OpenPull {
  action: Action;
  path: string;
  number: number;
  url: string;
}

interface Pull {
  number: number;
  html_url: string;
  state: string;
  head: { ref: string; repo: { full_name: string } | null };
}

export const OPEN_CACHE_MS = 60_000;

/** Each grave the data file offers an action on, by the branch that action's pull request would use. */
export function gravesByBranch(graveyard: Graveyard): Map<string, { action: Action; path: string }> {
  const out = new Map<string, { action: Action; path: string }>();
  for (const f of graveyard.files) if (f.unused) out.set(branchName('bury', f.path), { action: 'bury', path: f.path });
  for (const g of graveyard.ghosts) out.set(branchName('resurrect', g.path), { action: 'resurrect', path: g.path });
  return out;
}

/** The open pull requests among `pulls` that belong to a grave of `graveyard`, sorted by path. */
export function openPullsOf(pulls: readonly Pull[], graveyard: Graveyard, fullName: string): OpenPull[] {
  const graves = gravesByBranch(graveyard);
  const out: OpenPull[] = [];
  for (const p of pulls) {
    if (p.state !== 'open' || p.head.repo?.full_name.toLowerCase() !== fullName.toLowerCase()) continue;
    const grave = graves.get(p.head.ref);
    if (grave) out.push({ ...grave, number: p.number, url: p.html_url });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function listOpenPulls(gh: GitHubClient, fork: Fork, graveyard: Graveyard): Promise<OpenPull[]> {
  const q = new URLSearchParams({ state: 'open', per_page: '100' });
  const { data } = await gh.request<Pull[]>('GET', `/repos/${encodeURIComponent(fork.owner)}/${encodeURIComponent(fork.repo)}/pulls?${q}`);
  return openPullsOf(data, graveyard, `${fork.owner}/${fork.repo}`);
}

/** A minute's cache per fork, so a burst of visitors costs one call. A pull request this instance opens is added at once. */
export class OpenPullCache {
  private readonly entries = new Map<string, { at: number; pulls: OpenPull[] }>();
  constructor(private readonly now: () => number = () => Date.now(), private readonly ttlMs = OPEN_CACHE_MS) {}

  async get(key: string, load: () => Promise<OpenPull[]>): Promise<OpenPull[]> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.pulls;
    const pulls = await load();
    this.entries.set(key, { at: this.now(), pulls });
    return pulls;
  }

  /** A pull request just opened (or found open) by this instance: shown at once, without waiting for the cache to run out. */
  add(key: string, pull: OpenPull): void {
    const hit = this.entries.get(key);
    if (!hit || hit.pulls.some((p) => p.number === pull.number)) return;
    hit.pulls = [...hit.pulls, pull].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
