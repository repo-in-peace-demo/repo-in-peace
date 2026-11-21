import { execFileSync } from 'node:child_process';
import fc from 'fast-check';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateGraveyard, type Ghost, type Graveyard, type Thresholds } from '../../shared/graveyard-schema';
import {
  PATH_POOL,
  thresholdsArb,
  episodeChoiceArb,
  fitEpisode,
  replay,
  toRepoPlan,
  wholeSecondScenarioArb,
} from '../test/arbitraries';
import { makeRepo } from '../test/make-repo';
import { MS_PER_DAY } from './core/decay';
import { countNonBlankLines, isTrackedSourcePath } from './core/files';
import { compareCodePoint } from './core/sort';
import type { KnipProcessResult } from './io/knip';
import { runPipeline, type PipelineDeps } from './pipeline';

/**
 * End-to-end properties. Each run builds a real git repository from a random history
 * (renames, deletes, re-adds, out-of-order commit dates, and sometimes a side branch merged back),
 * runs the whole pipeline on it, and checks the output against the independent model in
 * test/arbitraries.ts and against git itself.
 */

const ANALYSED_AT = '2026-03-02T09:30:00.000Z';
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

const knipResult = (unused: readonly string[]): KnipProcessResult => ({
  exitCode: unused.length > 0 ? 1 : 0,
  stdout: JSON.stringify({ issues: unused.map((file) => ({ file, files: [{ name: file }] })) }),
  stderr: '',
});

async function analyse(repoDir: string, outFile: string, unused: readonly string[], thresholds: Thresholds): Promise<string> {
  const deps: PipelineDeps = { log: () => {}, runKnip: async () => knipResult(unused) };
  const { outPath } = await runPipeline(
    { repoPath: repoDir, outPath: outFile, analysedAt: ANALYSED_AT, cwd: tmpdir(), thresholds },
    deps,
  );
  return readFileSync(outPath, 'utf8');
}

/** P5, checked with git alone: the last existing commit really holds the file, and the deletion really removed it. */
function expectGhostIsSound(repoDir: string, ghost: Ghost): void {
  // The last existing commit contains the file.
  expect(git(repoDir, 'ls-tree', '-r', '--name-only', ghost.lastExistingSha, '--', ghost.path).trim()).toBe(ghost.path);
  // It is the first parent of the deleting commit.
  expect(git(repoDir, 'rev-parse', `${ghost.deletedInSha}^1`).trim()).toBe(ghost.lastExistingSha);
  // The deleting commit's own change is a deletion of that path, and its tree no longer has the file.
  expect(git(repoDir, 'diff-tree', '--no-commit-id', '--name-status', '-r', ghost.deletedInSha).split('\n')).toContain(
    `D\t${ghost.path}`,
  );
  expect(git(repoDir, 'ls-tree', '-r', '--name-only', ghost.deletedInSha, '--', ghost.path).trim()).toBe('');
  // And the file is not in the snapshot.
  expect(git(repoDir, 'ls-tree', '-r', '--name-only', 'HEAD', '--', ghost.path).trim()).toBe('');
}

describe('end to end on random real repositories', () => {
  // How many generated repositories had each interesting feature, so the test cannot pass by only seeing boring ones.
  const seen = { runs: 0, ghosts: 0, renames: 0, sideBranches: 0, reAdds: 0 };

  it(
    'P2, P3, P5: identical output on a rerun; no ghost is a current file; every ghost restores from its last existing commit; and the whole output matches the model',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          wholeSecondScenarioArb,
          episodeChoiceArb,
          fc.subarray<string>([...PATH_POOL]),
          thresholdsArb,
          async (script, choice, unusedPaths, thresholds) => {
            const episode = fitEpisode(choice, script.length);
            const snapshotMs = script[script.length - 1]!.date;
            const model = replay(script, snapshotMs, thresholds.hotWindowDays);
            const plan = toRepoPlan(script, model, episode);
            const built = makeRepo(plan.steps);
            const outDir = mkdtempSync(join(tmpdir(), 'rip-e2e-'));

            try {
              seen.runs++;
              if ([...model.lastRemoval.values()].some((x) => x.kind === 'delete')) seen.ghosts++;
              if ([...model.lastRemoval.values()].some((x) => x.kind === 'rename')) seen.renames++;
              if (episode !== undefined) seen.sideBranches++;
              if ([...model.lastRemoval.keys()].some((p) => model.present.has(p))) seen.reAdds++;

              // P2 end to end: two runs on the same snapshot give the same bytes.
              const first = await analyse(built.dir, join(outDir, 'a.json'), unusedPaths, thresholds);
              const second = await analyse(built.dir, join(outDir, 'b.json'), unusedPaths, thresholds);
              expect(second).toBe(first);

              const g = JSON.parse(first) as Graveyard;
              expect(validateGraveyard(g)).toEqual({ ok: true });

              // The thresholds are recorded, and every file's decay agrees with them (P7), by formulas written out here.
              expect(g.meta.thresholds).toEqual(thresholds);
              for (const file of g.files) {
                const age = Math.max(0, Math.floor((snapshotMs - Date.parse(file.lastCommitDate)) / MS_PER_DAY));
                const state = age < thresholds.staleAfterDays ? 'fresh' : age <= thresholds.ancientAfterDays ? 'stale' : 'ancient';
                const score =
                  Math.round(
                    (0.4 * (Math.min(age, thresholds.decayCapDays) / thresholds.decayCapDays) + (file.unused ? 0.6 : 0)) * 10_000,
                  ) / 10_000;
                expect({ state: file.decayState, score: file.decayScore, hot: file.hot }).toEqual({
                  state,
                  score,
                  hot: file.recentCommits >= thresholds.hotCommits,
                });
              }

              const mainSha = (i: number): string => built.shas[plan.mainShaIndex[i]!]!;
              expect(g.meta.snapshotSha).toBe(mainSha(script.length - 1));
              expect(g.meta.snapshotDate).toBe(new Date(snapshotMs).toISOString());

              // Current files on the main line match the model: paths, history, unused flags, lines of code.
              const modelCurrent = [...model.present].filter(isTrackedSourcePath).sort(compareCodePoint);
              const poolFiles = g.files.filter((f) => !f.path.startsWith('side/'));
              expect(poolFiles.map((f) => f.path)).toEqual(modelCurrent);
              const finalContent = model.contentAfter[script.length - 1]!;
              for (const file of poolFiles) {
                // The data carries the date, author and count; the expected history also has the last subject, which is a eulogy's
                // input and never in the data.
                const { lastCommitSubject: _subject, ...expected } = model.expectedHistory.get(file.path)!;
                expect({
                  lastCommitDate: file.lastCommitDate,
                  lastCommitAuthor: file.lastCommitAuthor,
                  recentCommits: file.recentCommits,
                }).toEqual(expected);
                expect(file.unused).toBe(unusedPaths.includes(file.path));
                expect(file.linesOfCode).toBe(
                  countNonBlankLines(new TextEncoder().encode(finalContent.get(file.path))),
                );
              }

              // The side branch's files, when there is one.
              const sideFiles = g.files.filter((f) => f.path.startsWith('side/')).map((f) => f.path);
              const sideCount = episode?.commits.length ?? 0;
              const expectedSideFiles = sideCount === 0 ? [] : sideCount === 1 ? ['side/a.ts', 'side/b.ts'] : ['side/b.ts'];
              expect(sideFiles).toEqual(expectedSideFiles);

              // Ghosts on the main line match the model. After a merge, the next main commit's first parent is the merge.
              const firstParentSha = (i: number): string =>
                episode !== undefined && i - 1 === episode.mergeAfter
                  ? built.shas[plan.mergeShaIndex!]!
                  : mainSha(i - 1);
              const currentSet = new Set(modelCurrent);
              const expectedPoolGhosts: Ghost[] = [...model.lastRemoval]
                .filter(([path, removal]) => removal.kind === 'delete' && !currentSet.has(path) && isTrackedSourcePath(path))
                .map(([path, removal]) => ({
                  path,
                  deletedInSha: mainSha(removal.index),
                  deletedDate: new Date(script[removal.index]!.date).toISOString(),
                  deletedBy: script[removal.index]!.author,
                  lastExistingSha: firstParentSha(removal.index),
                }))
                .sort((a, b) => compareCodePoint(a.path, b.path));
              expect(g.ghosts.filter((x) => !x.path.startsWith('side/'))).toEqual(expectedPoolGhosts);

              // The side branch deletes side/a.ts in its second commit, which is a ghost with the side commits as parents.
              const sideGhosts = g.ghosts.filter((x) => x.path.startsWith('side/'));
              if (sideCount >= 2) {
                expect(sideGhosts).toHaveLength(1);
                expect(sideGhosts[0]).toMatchObject({
                  path: 'side/a.ts',
                  deletedInSha: built.shas[plan.sideShaIndex[1]!],
                  deletedBy: episode!.commits[1]!.author,
                  lastExistingSha: built.shas[plan.sideShaIndex[0]!],
                });
              } else {
                expect(sideGhosts).toEqual([]);
              }

              // P3: no ghost is also a current file, and ghost paths are unique.
              const filePaths = new Set(g.files.map((f) => f.path));
              expect(g.ghosts.every((x) => !filePaths.has(x.path))).toBe(true);
              expect(new Set(g.ghosts.map((x) => x.path)).size).toBe(g.ghosts.length);

              // P5: every ghost is sound according to git, and restoring from it gives the last content byte for byte.
              for (const ghost of g.ghosts) {
                expectGhostIsSound(built.dir, ghost);
                if (!ghost.path.startsWith('side/')) {
                  const removal = model.lastRemoval.get(ghost.path)!;
                  const lastContent = model.contentAfter[removal.index - 1]!.get(ghost.path);
                  expect(git(built.dir, 'show', `${ghost.lastExistingSha}:${ghost.path}`)).toBe(lastContent);
                }
              }
              return true;
            } finally {
              built.cleanup();
              rmSync(outDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 25 },
      );
    },
    240_000,
  );

  it('generated repositories with deletions, renames, side branches and re-added files', () => {
    expect(seen.ghosts).toBeGreaterThan(0);
    expect(seen.renames).toBeGreaterThan(0);
    expect(seen.sideBranches).toBeGreaterThan(0);
    expect(seen.reAdds).toBeGreaterThan(0);
  });
});
