/**
 * Opening the pull request (bury-and-resurrect design, "Opening a pull request"): an existing open one is returned; otherwise, if the
 * fork is under its cap and the base branch head matches (Req 2.4, 3.4), one commit with a one-path tree change goes on a
 * deterministic branch, and a pull request is opened from it. Two requests at once give one pull request (P4).
 */
import type { Graveyard } from '../../../shared/graveyard-schema.js';
import { BRANCH_PREFIX, branchName } from './branch.js';
import type { Eligible } from './check.js';
import { GitHubError, type GitHubClient } from './github.js';
import { commitMessage, prBody, prTitle } from './pr-text.js';
import { buryChange, lookupPath, resurrectChange, type Change, type ReadTree, type TreeEntry } from './tree-change.js';

export interface Fork {
  owner: string;
  repo: string;
  base: string;
}
export type OpenResult = { number: number; url: string; existing: boolean } | { refused: string; status: 409 };

interface Pull {
  number: number;
  html_url: string;
  head: { ref: string; repo: { full_name: string } | null };
}

const MAX_PAGES = 10;
const segments = (ref: string): string => ref.split('/').map(encodeURIComponent).join('/');
const short = (sha: string): string => sha.slice(0, 7);

export const forkOf = (repo: string, base: string): Fork => {
  const [owner, name] = repo.split('/') as [string, string];
  return { owner, repo: name, base };
};

export async function openPullRequest(gh: GitHubClient, fork: Fork, eligible: Eligible, graveyard: Graveyard, cap: number): Promise<OpenResult> {
  const repoPath = `/repos/${encodeURIComponent(fork.owner)}/${encodeURIComponent(fork.repo)}`;
  const fullName = `${fork.owner}/${fork.repo}`;
  const path = eligible.action === 'bury' ? eligible.file.path : eligible.ghost.path;
  const branch = branchName(eligible.action, path);

  const findOpen = async (): Promise<OpenResult | undefined> => {
    const q = new URLSearchParams({ state: 'open', head: `${fork.owner}:${branch}`, per_page: '10' });
    const { data } = await gh.request<Pull[]>('GET', `${repoPath}/pulls?${q}`);
    const pull = data.find((p) => p.head.ref === branch);
    return pull ? { number: pull.number, url: pull.html_url, existing: true } : undefined;
  };

  // 2. An open one already: return it, even when the fork is full.
  const existing = await findOpen();
  if (existing) return existing;

  // 3. The cap, counted on GitHub so it holds across instances.
  let open = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ state: 'open', per_page: '100', page: String(page) });
    const { data, headers } = await gh.request<Pull[]>('GET', `${repoPath}/pulls?${q}`);
    open += data.filter((p) => p.head.ref.startsWith(BRANCH_PREFIX) && p.head.repo?.full_name.toLowerCase() === fullName.toLowerCase()).length;
    if (!/rel="next"/.test(headers.get('link') ?? '')) break;
  }
  if (open >= cap) {
    return { refused: `This demo has ${open} open Repo In Peace pull requests, the most it allows. It's reset regularly; try again later.`, status: 409 };
  }

  // 4. The base branch head and its tree.
  const baseRef = await gh.request<{ object: { sha: string } }>('GET', `${repoPath}/git/ref/heads/${segments(fork.base)}`);
  const baseSha = baseRef.data.object.sha;
  const baseCommit = await gh.request<{ tree: { sha: string } }>('GET', `${repoPath}/git/commits/${baseSha}`);
  const readTree: ReadTree = async (sha) => (await gh.request<{ tree: TreeEntry[] }>('GET', `${repoPath}/git/trees/${sha}`)).data.tree;

  // 5 and 6. The path on the base head, and for Resurrect the original blob.
  const onBase = await lookupPath(readTree, baseCommit.data.tree.sha, path);
  let change: Change;
  if (eligible.action === 'bury') {
    change = buryChange(path, onBase);
  } else {
    let original: Awaited<ReturnType<typeof lookupPath>> = { kind: 'absent' };
    if (onBase.kind === 'absent') {
      try {
        const old = await gh.request<{ tree: { sha: string } }>('GET', `${repoPath}/git/commits/${eligible.ghost.lastExistingSha}`);
        original = await lookupPath(readTree, old.data.tree.sha, path);
      } catch (error) {
        if (!(error instanceof GitHubError && error.kind === 'not-found')) throw error;
      }
    }
    change = resurrectChange(path, onBase, original);
  }
  if ('refused' in change) {
    const where = `${fork.base} in ${fullName}`;
    const refused = {
      'not-on-base': `${path} is no longer on ${where}, so there is nothing to bury.`,
      'not-a-file': `${path} on ${where} is not a file, so it can't be buried.`,
      'already-exists': `${path} already exists on ${where}, so there is nothing to resurrect.`,
      'original-missing': eligible.action === 'resurrect' ? `The fork doesn't have ${path} at ${short(eligible.ghost.lastExistingSha)}.` : `${path} can't be restored.`,
    }[change.refused];
    return { refused, status: 409 };
  }

  // 7 and 8. The tree and the commit.
  const tree = await gh.request<{ sha: string }>('POST', `${repoPath}/git/trees`, { base_tree: baseCommit.data.tree.sha, tree: [change.entry] });
  const commit = await gh.request<{ sha: string }>('POST', `${repoPath}/git/commits`, { message: commitMessage(eligible), tree: tree.data.sha, parents: [baseSha] });

  // 9. The branch: new, or an old one (its pull request closed) moved to the new commit.
  try {
    await gh.request('POST', `${repoPath}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.data.sha });
  } catch (error) {
    if (!(error instanceof GitHubError && error.kind === 'validation' && /already exists/i.test(error.githubMessage))) throw error;
    const raced = await findOpen();
    if (raced) return raced;
    await gh.request('PATCH', `${repoPath}/git/refs/heads/${segments(branch)}`, { sha: commit.data.sha, force: true });
  }

  // 10. The pull request; if one was opened meanwhile, that one.
  try {
    const pull = await gh.request<Pull>('POST', `${repoPath}/pulls`, {
      title: prTitle(eligible),
      body: prBody(eligible, graveyard.meta),
      head: branch,
      base: fork.base,
      maintainer_can_modify: false,
    });
    return { number: pull.data.number, url: pull.data.html_url, existing: false };
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'validation' && /pull request already exists/i.test(error.githubMessage)) {
      const raced = await findOpen();
      if (raced) return raced;
    }
    throw error;
  }
}
