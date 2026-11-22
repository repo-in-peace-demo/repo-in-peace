/**
 * Closes every open Repo In Peace pull request on the demo forks and deletes every `rip/` branch (bury-and-resurrect Req 8). Nothing
 * else is touched. Reads GITHUB_TOKEN and RIP_DEMOS from the environment or frontend/.env.local.
 *
 *   npm run reset-demo-prs -- --dry-run     # lists what it would close and delete
 *   npm run reset-demo-prs                  # does it
 */
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { BRANCH_PREFIX } from '../server/pr/branch';
import { readConfig } from '../server/pr/config';
import { GitHubError, githubClient, githubProblem, type GitHubClient } from '../server/pr/github';
import { redact } from '../server/pr/redact';

interface Pull {
  number: number;
  title: string;
  head: { ref: string; repo: { full_name: string } | null };
}
export interface ResetReport {
  closed: number;
  deleted: number;
}

const MAX_PAGES = 10;

export async function resetDemoPrs(gh: GitHubClient, repos: readonly string[], options: { dryRun: boolean; log: (line: string) => void }): Promise<ResetReport> {
  const report: ResetReport = { closed: 0, deleted: 0 };
  const verb = (doing: string, would: string) => (options.dryRun ? would : doing);
  for (const repo of repos) {
    const [owner, name] = repo.split('/') as [string, string];
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = new URLSearchParams({ state: 'open', per_page: '100', page: String(page) });
      const { data, headers } = await gh.request<Pull[]>('GET', `${base}/pulls?${q}`);
      for (const p of data) {
        if (!p.head.ref.startsWith(BRANCH_PREFIX) || p.head.repo?.full_name.toLowerCase() !== repo.toLowerCase()) continue;
        options.log(`${repo}: ${verb('closed', 'would close')} #${p.number} ${p.title}`);
        if (!options.dryRun) await gh.request('PATCH', `${base}/pulls/${p.number}`, { state: 'closed' });
        report.closed++;
      }
      if (!/rel="next"/.test(headers.get('link') ?? '')) break;
    }
    const { data: refs } = await gh.request<Array<{ ref: string }>>('GET', `${base}/git/matching-refs/heads/${BRANCH_PREFIX}`);
    for (const r of refs) {
      const branch = r.ref.replace(/^refs\/heads\//, '');
      if (!branch.startsWith(BRANCH_PREFIX)) continue;
      options.log(`${repo}: ${verb('deleted', 'would delete')} branch ${branch}`);
      if (!options.dryRun) await gh.request('DELETE', `${base}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
      report.deleted++;
    }
  }
  options.log(`${verb('Closed', 'Would close')} ${report.closed} pull requests and ${verb('deleted', 'would delete')} ${report.deleted} branches on ${repos.length} forks.`);
  return report;
}

async function main(argv: readonly string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const files = loadEnv('development', process.cwd(), '');
  const env = { GITHUB_TOKEN: process.env['GITHUB_TOKEN'] ?? files['GITHUB_TOKEN'], RIP_DEMOS: process.env['RIP_DEMOS'] ?? files['RIP_DEMOS'] };
  const config = readConfig(env, 'production');
  if ('problem' in config) {
    console.error(`Error: ${config.problem}`);
    return 1;
  }
  if (config.token === undefined || config.demos.size === 0) {
    console.error('Error: set GITHUB_TOKEN and RIP_DEMOS (in the environment or frontend/.env.local).');
    return 1;
  }
  const repos = [...new Set([...config.demos.values()].map((d) => d.repo))];
  try {
    await resetDemoPrs(githubClient(config.token), repos, { dryRun, log: (line) => console.log(redact(line, [config.token])) });
    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof GitHubError ? githubProblem(error, repos.join(', ')) : 'the reset failed.'}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => (process.exitCode = code));
}
