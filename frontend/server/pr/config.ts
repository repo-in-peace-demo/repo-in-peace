/**
 * The PR function's configuration, from the environment (bury-and-resurrect design, "Configuration"). Pure: the environment comes in
 * as a plain object. Server code imports shared/ and src/ by relative paths, never through the `@shared` alias: Vercel's function
 * bundler doesn't apply tsconfig path mappings.
 */
import { GRAVEYARD_NAME_PATTERN } from '../../src/model/graveyard-load';

export type Mode = 'production' | 'development';

export interface ForkConfig {
  /** `owner/name` on GitHub. */
  repo: string;
  /** The branch pull requests target. */
  base: string;
}

export interface PrConfig {
  mode: Mode;
  /** The fine-grained GitHub token, or undefined when none is set. Never logged, never sent. */
  token: string | undefined;
  /** Demo name (as in `?graveyard=`) to its fork. Empty when RIP_DEMOS is not set. */
  demos: ReadonlyMap<string, ForkConfig>;
  /** The most open Repo In Peace pull requests a fork may have. */
  cap: number;
}

export const DEFAULT_CAP = 50;
const MAX_CAP = 1000;

/** GitHub's rules: an owner is 1 to 39 letters, digits and single hyphens, not at either end; a repository name 1 to 100 of `[A-Za-z0-9._-]`. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** A conservative branch name check for the configuration (git's full rules are in branch.ts, for the names this function makes). */
export function isPlainBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(name) &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.includes('//') &&
    !name.includes('..') &&
    !name.endsWith('.lock') &&
    !name.endsWith('.') &&
    !name.split('/').some((part) => part.startsWith('.') || part.startsWith('-'))
  );
}

export function isRepoName(repo: string): boolean {
  const parts = repo.split('/');
  return parts.length === 2 && OWNER.test(parts[0]!) && REPO_NAME.test(parts[1]!) && parts[1] !== '.' && parts[1] !== '..';
}

function parseDemos(raw: string): ReadonlyMap<string, ForkConfig> | { problem: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { problem: 'RIP_DEMOS is not valid JSON.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problem: 'RIP_DEMOS must be a JSON object of demo name to {"repo": "owner/name", "base": "branch"}.' };
  }
  const demos = new Map<string, ForkConfig>();
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!GRAVEYARD_NAME_PATTERN.test(name)) return { problem: `RIP_DEMOS: "${name}" is not a graveyard name (1 to 100 letters, digits, dots, underscores, hyphens).` };
    const e = entry as Partial<ForkConfig> | null;
    if (typeof e !== 'object' || e === null || typeof e.repo !== 'string' || typeof e.base !== 'string') {
      return { problem: `RIP_DEMOS: "${name}" needs "repo" and "base" strings.` };
    }
    if (!isRepoName(e.repo)) return { problem: `RIP_DEMOS: "${name}" has repo "${e.repo}", which is not owner/name.` };
    if (!isPlainBranchName(e.base)) return { problem: `RIP_DEMOS: "${name}" has base "${e.base}", which is not a branch name.` };
    demos.set(name, { repo: e.repo, base: e.base });
  }
  return demos;
}

/**
 * The configuration, or the problem with it. A problem never quotes the token. Missing values are not problems: no token means the
 * fake flow in development and "unavailable" in production; no RIP_DEMOS means no configured demos.
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>, mode: Mode): PrConfig | { problem: string } {
  const token = env['GITHUB_TOKEN']?.trim() || undefined;

  let demos: ReadonlyMap<string, ForkConfig> = new Map();
  const rawDemos = env['RIP_DEMOS']?.trim();
  if (rawDemos) {
    const parsed = parseDemos(rawDemos);
    if ('problem' in parsed) return parsed;
    demos = parsed;
  }

  let cap = DEFAULT_CAP;
  const rawCap = env['RIP_PR_CAP']?.trim();
  if (rawCap) {
    if (!/^\d+$/.test(rawCap) || Number(rawCap) < 1 || Number(rawCap) > MAX_CAP) return { problem: `RIP_PR_CAP must be a whole number from 1 to ${MAX_CAP}.` };
    cap = Number(rawCap);
  }

  return { mode, token, demos, cap };
}

/** The mode of a Vercel deployment: development only under `vercel dev`; Preview and Production are both production. */
export const modeFromVercelEnv = (vercelEnv: string | undefined): Mode => (vercelEnv === 'development' ? 'development' : 'production');
