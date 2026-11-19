import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateGraveyard, type Graveyard } from '../../shared/graveyard-schema';
import { AssembleError, assembleGraveyard } from './core/assemble';
import { countNonBlankLines, isTrackedSourcePath } from './core/files';
import { HistoryError, analyseHistory } from './core/history';
import { hasKnipConfig } from './core/knip-config';
import { describeKnipDir, missingPackageJsonMessage, prefixKnipPaths, relativeToKnipDir } from './core/knip-dirs';
import { defaultOutputName, isInside } from './core/paths';
import { toJson } from './core/serialise';
import { AnalyserError } from './errors';
import { assertUsableRepo, listTree, mapBlobs, readLog, resolveSnapshot } from './io/git';
import { GitLogParseError, parseGitLog } from './io/git-log-parse';
import { readKnipResult, runKnipProcess, type KnipProcessResult, type KnipRunOptions } from './io/knip';
import { realPathOfFuture, writeFileAtomic } from './io/write-output';

/**
 * The whole run: read the clone, build the graveyard, check it, write it.
 * Everything that can fail happens before the single write at the end, so a
 * failed run leaves no output file.
 */

export interface PipelineOptions {
  repoPath: string;
  /** Output file. Default: `<repo-name>.graveyard.json` in `cwd`. */
  outPath?: string;
  /** ISO 8601 UTC. The only clock-derived value; read once by the CLI. */
  analysedAt: string;
  /** Knip config file to use instead of the clone's own. */
  knipConfigPath?: string;
  /**
   * Folders of the clone to run Knip in, normalised, "" for the clone root.
   * Default: the clone root only. Each needs a package.json.
   */
  knipDirs?: readonly string[];
  /** Base for relative `outPath` and `knipConfigPath`. */
  cwd: string;
}

/** Things the pipeline calls out to, replaceable in tests. */
export interface PipelineDeps {
  runKnip: (options: KnipRunOptions) => Promise<KnipProcessResult>;
  /** Progress and warnings. */
  log: (message: string) => void;
}

export const defaultDeps: PipelineDeps = { runKnip: runKnipProcess, log: () => {} };

export interface PipelineResult {
  outPath: string;
  graveyard: Graveyard;
}

export async function runPipeline(
  options: PipelineOptions,
  deps: PipelineDeps = defaultDeps,
): Promise<PipelineResult> {
  const { log } = deps;

  // Cheap checks first, before any slow work.
  const knipConfigPath = options.knipConfigPath === undefined ? undefined : resolve(options.cwd, options.knipConfigPath);
  if (knipConfigPath !== undefined && !(await isFile(knipConfigPath))) {
    throw new AnalyserError(`Knip config file "${options.knipConfigPath}" does not exist`);
  }

  const repo = await assertUsableRepo(resolve(options.cwd, options.repoPath));

  const outPath = resolve(options.cwd, options.outPath ?? defaultOutputName(repo.name));
  if (isInside(repo.root, await realPathOfFuture(outPath))) {
    throw new AnalyserError(
      `The output file "${outPath}" would be written inside the clone, and the analyser never modifies the clone. ` +
        'Choose another location with --out.',
    );
  }

  const snapshot = await resolveSnapshot(repo.root);
  log(`Analysing ${repo.name} at ${snapshot.sha.slice(0, 7)} (${snapshot.date})`);

  // What git tracks at the snapshot. Source files are the part the graveyard shows.
  const tree = await listTree(repo.root, snapshot.sha);
  const treePaths = tree.map((file) => file.path);

  // Fast check, before any slow work: Knip needs a package.json in each folder it runs in.
  const knipDirs = options.knipDirs === undefined || options.knipDirs.length === 0 ? [''] : [...new Set(options.knipDirs)];
  const missingMessage = missingPackageJsonMessage(knipDirs, treePaths);
  if (missingMessage !== undefined) throw new AnalyserError(missingMessage);

  const sourceFiles = tree.filter((file) => isTrackedSourcePath(file.path));
  log(`Found ${sourceFiles.length} source files`);

  const linesByBlob = await mapBlobs(repo.root, sourceFiles.map((f) => f.blobSha), countNonBlankLines);

  const packageJsonPaths = new Set(knipDirs.map((dir) => (dir === '' ? 'package.json' : `${dir}/package.json`)));
  const packageJsonBlobs = new Map<string, string>(
    tree.filter((file) => packageJsonPaths.has(file.path)).map((file): [string, string] => [file.path, file.blobSha]),
  );
  const packageJsonTexts = await mapBlobs(repo.root, packageJsonBlobs.values(), (c) => new TextDecoder().decode(c));

  // Knip runs once per folder. Its paths are relative to that folder, so each result is prefixed and the results merged.
  const unused = new Set<string>();
  for (const dir of knipDirs) {
    const packageJsonPath = dir === '' ? 'package.json' : `${dir}/package.json`;
    const blobSha = packageJsonBlobs.get(packageJsonPath);
    const packageJsonText = blobSha === undefined ? undefined : packageJsonTexts.get(blobSha);

    if (knipConfigPath === undefined && !hasKnipConfig(relativeToKnipDir(dir, treePaths), packageJsonText)) {
      const subject = dir === '' ? 'this repository' : describeKnipDir(dir);
      log(
        `Warning: ${subject} has no Knip configuration (knip.json, knip.ts, a "knip" key in package.json, ...). ` +
          'Knip may flag test files, scripts and tool configs as unused, so live files could be marked dead. ' +
          'Add a Knip config there, or pass --knip-config <file>.',
      );
    }

    log(dir === '' ? 'Running Knip (unused files)' : `Running Knip (unused files) in ${describeKnipDir(dir)}`);
    const result = await deps.runKnip({ clonePath: join(repo.root, dir), configPath: knipConfigPath });
    for (const path of prefixKnipPaths(dir, readKnipResult(result, dir))) unused.add(path);
  }

  log('Reading history');
  const logText = await readLog(repo.root, snapshot.sha);
  const commits = wrapExpected('could not read the git history', () => parseGitLog(logText));
  const history = wrapExpected('could not work out file history', () =>
    analyseHistory({
      commits,
      currentPaths: new Set(sourceFiles.map((f) => f.path)),
      snapshotMs: Date.parse(snapshot.date),
    }),
  );
  log(`Read ${commits.length} commits; ${history.ghosts.length} deleted files found`);

  const graveyard = wrapExpected('could not assemble the graveyard', () =>
    assembleGraveyard({
      repoName: repo.name,
      snapshotSha: snapshot.sha,
      snapshotDate: snapshot.date,
      analysedAt: options.analysedAt,
      files: sourceFiles.map((f) => ({ path: f.path, linesOfCode: linesByBlob.get(f.blobSha) ?? 0 })),
      history: history.perFile,
      unused,
      ghosts: history.ghosts,
    }),
  );

  const validation = validateGraveyard(graveyard);
  if (!validation.ok) {
    throw new AnalyserError(
      `The analyser built data that fails its own schema check. This is a bug in the analyser:\n  ${validation.errors.join('\n  ')}`,
    );
  }

  await writeFileAtomic(outPath, toJson(graveyard));
  return { outPath, graveyard };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Failures from the pure steps that mean "this repository's data is unusable" become user-facing errors. */
function wrapExpected<T>(what: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof GitLogParseError || error instanceof HistoryError || error instanceof AssembleError) {
      throw new AnalyserError(`${what}: ${error.message}`);
    }
    throw error;
  }
}
