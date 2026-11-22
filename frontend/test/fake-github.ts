import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyTreeChange, type ChangeEntry, type FlatTree, type TreeEntry } from '../server/pr/tree-change';
import { buildTrees, flattenTree } from './git-trees';

/**
 * A fake GitHub REST API on 127.0.0.1 and a random port (bury-and-resurrect Req 11), for the PR function's tests. It holds in-memory
 * repositories (blobs, nested trees, commits, refs and pull requests) and answers the endpoints the function uses with GitHub's shapes
 * and status codes. It records every request, and can be told to fail chosen calls.
 */

export interface SeedCommit {
  files: FlatTree;
  message: string;
}
export interface RepoSeed {
  owner: string;
  repo: string;
  base: string;
  /** Oldest first; the base branch points at the last. */
  history: readonly SeedCommit[];
}

interface Commit {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
}
export interface FakePull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: 'open' | 'closed';
}
interface Repo {
  owner: string;
  repo: string;
  trees: Map<string, TreeEntry[]>;
  commits: Map<string, Commit>;
  refs: Map<string, string>; // "heads/main" -> commit sha
  pulls: FakePull[];
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface Failure {
  method?: string;
  /** Matched against the path without the query. */
  path?: RegExp;
  /** How many matching calls fail (default: every one). */
  times?: number;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Wait this long before answering (as a slow GitHub). */
  delayMs?: number;
}

export interface FakeGitHub {
  url: string;
  token: string;
  requests: RecordedRequest[];
  /** The commit SHAs of a seeded repository's history, oldest first. */
  history(owner: string, repo: string): string[];
  /** The files of a commit, flat. */
  filesAt(owner: string, repo: string, commitSha: string): Map<string, { mode: string; sha: string }>;
  ref(owner: string, repo: string, branch: string): string | undefined;
  commit(owner: string, repo: string, sha: string): Commit | undefined;
  pulls(owner: string, repo: string): FakePull[];
  /** Adds a pull request directly (for the cap and the reset). */
  addPull(owner: string, repo: string, pull: Omit<FakePull, 'number'>): FakePull;
  setRef(owner: string, repo: string, branch: string, sha: string): void;
  fail(failure: Failure): void;
  close(): Promise<void>;
}

const hash = (value: unknown): string => createHash('sha1').update(JSON.stringify(value)).digest('hex');

export async function startFakeGitHub(seeds: readonly RepoSeed[], token = 'github_pat_FAKE_test_token_0123456789'): Promise<FakeGitHub> {
  const repos = new Map<string, Repo>();
  const histories = new Map<string, string[]>();
  let counter = 0;
  for (const seed of seeds) {
    const repo: Repo = { owner: seed.owner, repo: seed.repo, trees: new Map(), commits: new Map(), refs: new Map(), pulls: [] };
    const shas: string[] = [];
    for (const step of seed.history) {
      const tree = buildTrees(step.files, new Map(), repo.trees).root;
      const commit: Commit = { tree, parents: shas.slice(-1), message: step.message, sha: '' };
      commit.sha = hash({ ...commit, n: counter++ });
      repo.commits.set(commit.sha, commit);
      shas.push(commit.sha);
    }
    repo.refs.set(`heads/${seed.base}`, shas[shas.length - 1]!);
    repos.set(`${seed.owner}/${seed.repo}`.toLowerCase(), repo);
    histories.set(`${seed.owner}/${seed.repo}`.toLowerCase(), shas);
  }

  const requests: RecordedRequest[] = [];
  const failures: Failure[] = [];
  let nextPull = 1;

  const send = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const error = (res: ServerResponse, status: number, message: string): void =>
    send(res, status, { message, documentation_url: 'https://docs.github.com/rest', status: String(status) });

  const pullJson = (r: Repo, p: FakePull) => ({
    number: p.number,
    state: p.state,
    title: p.title,
    body: p.body,
    html_url: `https://github.com/${r.owner}/${r.repo}/pull/${p.number}`,
    head: { ref: p.head, label: `${r.owner}:${p.head}`, repo: { full_name: `${r.owner}/${r.repo}` } },
    base: { ref: p.base },
  });

  async function handle(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const failure = failures.find((f) => (f.method === undefined || f.method === method) && (f.path === undefined || f.path.test(url.pathname)) && (f.times ?? 1) > 0);
    if (failure) {
      if (failure.times !== undefined) failure.times--;
      if (failure.delayMs) await new Promise((r) => setTimeout(r, failure.delayMs));
      if (failure.status !== undefined) return send(res, failure.status, failure.body ?? { message: 'Injected failure' }, failure.headers);
    }
    if (req.headers.authorization !== `Bearer ${token}`) return error(res, 401, 'Bad credentials');

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(url.pathname);
    const repo = m ? repos.get(`${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`.toLowerCase()) : undefined;
    if (!m || !repo) return error(res, 404, 'Not Found');
    const rest = m[3]!;
    const b = (body ?? {}) as Record<string, unknown>;

    // References
    let r: RegExpExecArray | null;
    if (method === 'GET' && (r = /^\/git\/ref\/(heads\/.+)$/.exec(rest))) {
      const sha = repo.refs.get(decodeURIComponent(r[1]!));
      return sha ? send(res, 200, { ref: `refs/${decodeURIComponent(r[1]!)}`, object: { sha, type: 'commit' } }) : error(res, 404, 'Not Found');
    }
    if (method === 'GET' && (r = /^\/git\/matching-refs\/(heads\/.*)$/.exec(rest))) {
      const prefix = decodeURIComponent(r[1]!);
      return send(res, 200, [...repo.refs].filter(([ref]) => ref.startsWith(prefix)).map(([ref, sha]) => ({ ref: `refs/${ref}`, object: { sha, type: 'commit' } })));
    }
    if (method === 'POST' && rest === '/git/refs') {
      const ref = String(b['ref'] ?? '');
      const sha = String(b['sha'] ?? '');
      if (!ref.startsWith('refs/heads/') || !repo.commits.has(sha)) return error(res, 422, 'Invalid request.');
      const key = ref.slice('refs/'.length);
      if (repo.refs.has(key)) return error(res, 422, 'Reference already exists');
      repo.refs.set(key, sha);
      return send(res, 201, { ref, object: { sha, type: 'commit' } });
    }
    if ((method === 'PATCH' || method === 'DELETE') && (r = /^\/git\/refs\/(heads\/.+)$/.exec(rest))) {
      const key = decodeURIComponent(r[1]!);
      if (!repo.refs.has(key)) return error(res, 422, 'Reference does not exist');
      if (method === 'DELETE') {
        repo.refs.delete(key);
        return send(res, 204);
      }
      const sha = String(b['sha'] ?? '');
      if (!repo.commits.has(sha)) return error(res, 422, 'Object does not exist');
      repo.refs.set(key, sha);
      return send(res, 200, { ref: `refs/${key}`, object: { sha, type: 'commit' } });
    }

    // Commits and trees
    if (method === 'GET' && (r = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest))) {
      const c = repo.commits.get(r[1]!);
      return c ? send(res, 200, { sha: c.sha, message: c.message, tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) }) : error(res, 404, 'Not Found');
    }
    if (method === 'POST' && rest === '/git/commits') {
      const tree = String(b['tree'] ?? '');
      const parents = Array.isArray(b['parents']) ? (b['parents'] as unknown[]).map(String) : [];
      if (!repo.trees.has(tree) || parents.some((p) => !repo.commits.has(p))) return error(res, 422, 'Invalid request.');
      const c: Commit = { tree, parents, message: String(b['message'] ?? ''), sha: '' };
      c.sha = hash({ ...c, n: counter++ });
      repo.commits.set(c.sha, c);
      return send(res, 201, { sha: c.sha, message: c.message, tree: { sha: tree }, parents: parents.map((sha) => ({ sha })) });
    }
    if (method === 'GET' && (r = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
      if (url.searchParams.has('recursive')) return error(res, 400, 'This fake answers folder by folder only');
      const t = repo.trees.get(r[1]!);
      return t ? send(res, 200, { sha: r[1], tree: t, truncated: false }) : error(res, 404, 'Not Found');
    }
    if (method === 'POST' && rest === '/git/trees') {
      const baseTree = String(b['base_tree'] ?? '');
      if (!repo.trees.has(baseTree)) return error(res, 422, 'Invalid base_tree');
      let files = flattenTree(repo.trees, baseTree);
      for (const e of (Array.isArray(b['tree']) ? b['tree'] : []) as ChangeEntry[]) {
        try {
          files = applyTreeChange(files, e);
        } catch {
          return error(res, 422, 'GitRPC::BadObjectState');
        }
      }
      const root = buildTrees(files, new Map(), repo.trees).root;
      return send(res, 201, { sha: root, tree: repo.trees.get(root), truncated: false });
    }

    // Pull requests
    if (method === 'GET' && rest === '/pulls') {
      const state = url.searchParams.get('state') ?? 'open';
      const head = url.searchParams.get('head');
      const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 30));
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
      const all = repo.pulls.filter((p) => (state === 'all' || p.state === state) && (head === null || head.toLowerCase() === `${repo.owner}:${p.head}`.toLowerCase()));
      const slice = all.slice((page - 1) * perPage, page * perPage);
      const headers: Record<string, string> = {};
      if (page * perPage < all.length) headers['link'] = `<https://api.github.com${url.pathname}?page=${page + 1}>; rel="next"`;
      return send(res, 200, slice.map((p) => pullJson(repo, p)), headers);
    }
    if (method === 'POST' && rest === '/pulls') {
      const head = String(b['head'] ?? '');
      const base = String(b['base'] ?? '');
      if (!repo.refs.has(`heads/${head}`) || !repo.refs.has(`heads/${base}`)) return error(res, 422, 'Validation Failed');
      if (repo.pulls.some((p) => p.state === 'open' && p.head === head && p.base === base)) {
        return send(res, 422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: `A pull request already exists for ${repo.owner}:${head}.` }] });
      }
      const p: FakePull = { number: nextPull++, title: String(b['title'] ?? ''), body: String(b['body'] ?? ''), head, base, state: 'open' };
      repo.pulls.push(p);
      return send(res, 201, pullJson(repo, p));
    }
    if (method === 'PATCH' && (r = /^\/pulls\/(\d+)$/.exec(rest))) {
      const p = repo.pulls.find((x) => x.number === Number(r![1]));
      if (!p) return error(res, 404, 'Not Found');
      if (b['state'] === 'closed') p.state = 'closed';
      return send(res, 200, pullJson(repo, p));
    }
    return error(res, 404, 'Not Found');
  }

  const server: Server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        return error(res, 400, 'Problems parsing JSON');
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, headers: req.headers, body });
      void handle(req, res, body).catch(() => error(res, 500, 'fake failed'));
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));

  const repoOf = (owner: string, name: string): Repo => {
    const r = repos.get(`${owner}/${name}`.toLowerCase());
    if (!r) throw new Error(`no repo ${owner}/${name}`);
    return r;
  };
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token,
    requests,
    history: (o, r) => histories.get(`${o}/${r}`.toLowerCase()) ?? [],
    filesAt: (o, r, sha) => flattenTree(repoOf(o, r).trees, repoOf(o, r).commits.get(sha)!.tree),
    ref: (o, r, branch) => repoOf(o, r).refs.get(`heads/${branch}`),
    commit: (o, r, sha) => repoOf(o, r).commits.get(sha),
    pulls: (o, r) => repoOf(o, r).pulls,
    addPull: (o, r, pull) => {
      const p = { ...pull, number: nextPull++ };
      repoOf(o, r).pulls.push(p);
      return p;
    },
    setRef: (o, r, branch, sha) => void repoOf(o, r).refs.set(`heads/${branch}`, sha),
    fail: (f) => void failures.push(f),
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
