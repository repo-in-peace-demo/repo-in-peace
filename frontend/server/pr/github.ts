/**
 * The GitHub REST client the PR function uses (bury-and-resurrect design, "The GitHub client"). Node's own fetch; no dependency.
 * Failures become a GitHubError with a kind, and the message a user sees comes from the kind only, never from GitHub's body (Req 6.3),
 * so the token can't travel in an error (P5).
 */
import { redact } from './redact.js';

export const API_VERSION = '2026-03-10';
export const TIMEOUT_MS = 15_000;

export type GitHubErrorKind = 'unauthorized' | 'forbidden' | 'rate-limited' | 'not-found' | 'conflict' | 'validation' | 'server' | 'network' | 'timeout';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    readonly status: number,
    /** GitHub's own message, redacted, for the code to tell cases apart (an existing ref, an existing pull request). Never shown. */
    readonly githubMessage: string,
  ) {
    super(`GitHub ${kind} (${status})`);
    this.name = 'GitHubError';
  }
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}
export interface GitHubClient {
  request<T>(method: string, path: string, body?: unknown): Promise<GitHubResponse<T>>;
}

function kindOf(status: number, headers: Headers): GitHubErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 429 || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))) return 'rate-limited';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  return 'server';
}

/** GitHub's message and any validation error messages, as one line, for telling cases apart. */
function messageOf(data: unknown): string {
  const d = data as { message?: unknown; errors?: Array<{ message?: unknown }> } | null;
  const parts = [typeof d?.message === 'string' ? d.message : '', ...(Array.isArray(d?.errors) ? d!.errors.map((e) => (typeof e?.message === 'string' ? e.message : '')) : [])];
  return parts.filter((p) => p !== '').join(' ');
}

export function githubClient(token: string, baseUrl = 'https://api.github.com', fetchImpl: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): GitHubClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<GitHubResponse<T>> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': API_VERSION,
            'user-agent': 'repo-in-peace',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new GitHubError(timedOut ? 'timeout' : 'network', 0, '');
      }
      const text = await response.text().catch(() => '');
      let data: unknown;
      try {
        data = text === '' ? undefined : JSON.parse(text);
      } catch {
        data = undefined;
      }
      if (!response.ok) throw new GitHubError(kindOf(response.status, response.headers), response.status, redact(messageOf(data), [token]));
      return { status: response.status, data: data as T, headers: response.headers };
    },
  };
}

/** What a user is told about a GitHub failure: from the kind and the fork only. */
export function githubProblem(error: GitHubError, repo: string): string {
  switch (error.kind) {
    case 'unauthorized':
      return "GitHub didn't accept the server's token; it may have expired.";
    case 'forbidden':
      return `GitHub refused the request: the token can't write to ${repo}.`;
    case 'rate-limited':
      return "GitHub's rate limit was reached. Try again in a few minutes.";
    case 'not-found':
      return `GitHub couldn't find ${repo} or its base branch.`;
    case 'timeout':
      return "GitHub didn't answer in time. Try again.";
    case 'network':
      return "The server couldn't reach GitHub. Try again.";
    case 'conflict':
    case 'validation':
    case 'server':
      return "GitHub couldn't make the change. Try again.";
  }
}
