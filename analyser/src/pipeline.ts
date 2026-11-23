import { realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateGraveyard, type Graveyard, type Thresholds } from '../../shared/graveyard-schema';
import { AssembleError, assembleGraveyard } from './core/assemble';
import { countNonBlankLines, isTrackedSourcePath } from './core/files';
import { HistoryError, analyseHistory } from './core/history';
import { hasKnipConfig } from './core/knip-config';
import { describeKnipDir, missingPackageJsonMessage, prefixKnipPaths, relativeToKnipDir } from './core/knip-dirs';
import { defaultOutputName, isInside } from './core/paths';
import { toJson } from './core/serialise';
import type { EulogyOptions } from './cli-args';
import { DEFAULT_THRESHOLDS } from './core/thresholds';
import { AnalyserError } from './errors';
import { disagreementReport, disagreements } from './core/disagreements';
import { entryPointOf, htmlScriptsOf, packageEntriesOf } from './core/entry-points';
import { buildEdges, importedByOf } from './core/import-graph';
import { findImports, type ImportRef } from './core/imports';
import { snapshotResolver } from './io/resolve';
import { cutContents, type Contents } from './core/eulogy-contents';
import { fileInput, ghostInput } from './core/eulogy-input';
import { runEulogies, type EulogyClient, type EulogyJob } from './core/eulogy-run';
import type { HistoryResult } from './core/history';
import { readEulogyCache, writeEulogyCache, eulogiesOf } from './io/eulogy-cache';
import { assertUsableRepo, changedTrackedPaths, listTree, mapBlobs, readLog, resolveBlobNames, resolveSnapshot, type TreeFile } from './io/git';
import { checkOllama, ollamaClient } from './io/ollama';
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
  /** Decay thresholds. Default: DEFAULT_THRESHOLDS. */
  thresholds?: Thresholds;
  /** Eulogies by a local model (eulogies spec). Absent: none are written, and the output is unchanged. */
  eulogies?: EulogyOptions;
  /** Base for relative `outPath`, `knipConfigPath` and the eulogy cache path. */
  cwd: string;
}

/** Things the pipeline calls out to, replaceable in tests. */
export interface PipelineDeps {
  runKnip: (options: KnipRunOptions) => Promise<KnipProcessResult>;
  /** Progress and warnings. */
  log: (message: string) => void;
  /** The model client for eulogies. Default: Ollama over HTTP. */
  eulogyClient?: (url: string, model: string) => EulogyClient;
  /** Checks Ollama runs and has the model, or throws AnalyserError. Default: asks Ollama. */
  checkOllama?: (url: string, model: string) => Promise<void>;
}

export const defaultDeps: PipelineDeps = { runKnip: runKnipProcess, log: () => {} };

/** New eulogies between cache writes, so a stopped run keeps most of its work. */
const CACHE_WRITE_EVERY = 25;

export interface PipelineResult {
  outPath: string;
  graveyard: Graveyard;
}

export async function runPipeline(
  options: PipelineOptions,
  deps: PipelineDeps = defaultDeps,
): Promise<PipelineResult> {
  const { log } = deps;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

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

  const eulogyCachePath = options.eulogies === undefined ? undefined : resolve(options.cwd, options.eulogies.cachePath);
  if (eulogyCachePath !== undefined && isInside(repo.root, await realPathOfFuture(eulogyCachePath))) {
    throw new AnalyserError(
      `The eulogy cache "${eulogyCachePath}" would be written inside the clone, and the analyser never modifies the clone. ` +
        'Choose another location with --eulogy-cache.',
    );
  }

  // Ollama is asked before any slow work, so a stopped server or a missing model fails at once.
  if (options.eulogies !== undefined) await (deps.checkOllama ?? checkOllama)(options.eulogies.ollamaUrl, options.eulogies.model);

  const snapshot = await resolveSnapshot(repo.root);
  log(`Analysing ${repo.name} at ${snapshot.sha.slice(0, 7)} (${snapshot.date})`);
  if (JSON.stringify(thresholds) !== JSON.stringify(DEFAULT_THRESHOLDS)) {
    log(
      `Decay thresholds: stale after ${thresholds.staleAfterDays} days, ancient after ${thresholds.ancientAfterDays}, ` +
        `hot at ${thresholds.hotCommits} commits in ${thresholds.hotWindowDays} days`,
    );
  }

  // What git tracks at the snapshot. Source files are the part the graveyard shows.
  const tree = await listTree(repo.root, snapshot.sha);
  const treePaths = tree.map((file) => file.path);

  // Fast check, before any slow work: Knip needs a package.json in each folder it runs in.
  const knipDirs = options.knipDirs === undefined || options.knipDirs.length === 0 ? [''] : [...new Set(options.knipDirs)];
  const missingMessage = missingPackageJsonMessage(knipDirs, treePaths);
  if (missingMessage !== undefined) throw new AnalyserError(missingMessage);

  const sourceFiles = tree.filter((file) => isTrackedSourcePath(file.path));
  log(`Found ${sourceFiles.length} source files`);

  // One read of every source file: its line count, and its text for the import graph (importers spec).
  const byBlob = await mapBlobs(repo.root, sourceFiles.map((f) => f.blobSha), (c) => ({ lines: countNonBlankLines(c), text: new TextDecoder().decode(c) }));
  const linesByBlob = new Map([...byBlob].map(([sha, v]) => [sha, v.lines]));

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
      hotWindowDays: thresholds.hotWindowDays,
    }),
  );
  log(`Read ${commits.length} commits; ${history.ghosts.length} deleted files found`);

  const graveyard = wrapExpected('could not assemble the graveyard', () =>
    assembleGraveyard({
      repoName: repo.name,
      snapshotSha: snapshot.sha,
      snapshotDate: snapshot.date,
      analysedAt: options.analysedAt,
      thresholds,
      files: sourceFiles.map((f) => ({ path: f.path, linesOfCode: linesByBlob.get(f.blobSha) ?? 0 })),
      history: history.perFile,
      unused,
      ghosts: history.ghosts,
    }),
  );

  // The import graph (importers spec): who imports each file, and which files a framework or tool loads.
  const graph = await importGraph(repo.root, tree, sourceFiles, byBlob, log);
  graveyard.files = graveyard.files.map((f) => {
    const entry = graph.entries.get(f.path);
    return { ...f, importedBy: graph.importedBy.get(f.path) ?? [], ...(entry ? { entry } : {}) };
  });
  for (const line of disagreementReport(disagreements(graveyard.files.map((f) => ({ path: f.path, unused: f.unused, entry: f.entry !== undefined })), graph.importedBy))) log(line);

  const validation = validateGraveyard(graveyard);
  if (!validation.ok) {
    throw new AnalyserError(
      `The analyser built data that fails its own schema check. This is a bug in the analyser:\n  ${validation.errors.join('\n  ')}`,
    );
  }

  if (options.eulogies === undefined || eulogyCachePath === undefined) {
    await writeFileAtomic(outPath, toJson(graveyard));
    return { outPath, graveyard };
  }

  const withEulogies = await addEulogies(graveyard, {
    repoRoot: repo.root,
    sourceFiles,
    history,
    thresholds,
    analysedAt: options.analysedAt,
    eulogies: options.eulogies,
    cachePath: eulogyCachePath,
    deps,
  });
  const again = validateGraveyard(withEulogies);
  if (!again.ok) {
    throw new AnalyserError(`The analyser built eulogies that fail the schema check. This is a bug in the analyser:\n  ${again.errors.join('\n  ')}`);
  }
  await writeFileAtomic(outPath, toJson(withEulogies));
  return { outPath, graveyard: withEulogies };
}

/** Config and entry files the import graph reads: tsconfigs, jsconfigs, package.json files and index.html files. */
const GRAPH_TEXT_FILE = /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|package\.json|index\.html)$/;

/**
 * The import graph (importers spec, design "Overview"): each source file's imports from its snapshot text, resolved with TypeScript's
 * resolution on the snapshot tree, reversed into importedBy; entry points from the file names, index.html and package.json; and a
 * warning when the working tree differs from the snapshot, since Knip read the working tree.
 */
async function importGraph(
  root: string,
  tree: readonly TreeFile[],
  sourceFiles: readonly TreeFile[],
  byBlob: ReadonlyMap<string, { text: string }>,
  log: (message: string) => void,
) {
  const textFiles = tree.filter((f) => GRAPH_TEXT_FILE.test(f.path) && !f.path.split('/').includes('node_modules'));
  const textByBlob = await mapBlobs(root, textFiles.map((f) => f.blobSha), (c) => new TextDecoder().decode(c));
  const texts = new Map(textFiles.map((f) => [f.path, textByBlob.get(f.blobSha) ?? '']));
  const analysed = new Set(sourceFiles.map((f) => f.path));

  const imports = new Map<string, ImportRef[]>();
  let nonLiteral = 0;
  for (const f of sourceFiles) {
    const found = findImports(f.path, byBlob.get(f.blobSha)?.text ?? '');
    imports.set(f.path, found.refs);
    nonLiteral += found.nonLiteral;
  }
  const resolve = snapshotResolver({ root: await realpath(root), tracked: new Set(tree.map((f) => f.path)), texts, analysed });
  const { edges, ignored } = buildEdges(imports, resolve);
  const importedBy = importedByOf(edges, [...analysed]);

  const htmlScripts = new Set([...texts].filter(([p]) => p.endsWith('index.html')).flatMap(([p, t]) => htmlScriptsOf(p, t)));
  const packageEntries = new Set([...texts].filter(([p]) => p.endsWith('package.json')).flatMap(([p, t]) => packageEntriesOf(p, t)));
  const entries = new Map<string, { kind: 'framework' | 'config' | 'test' | 'package'; label: string }>();
  for (const path of analysed) {
    const entry = entryPointOf(path, { htmlScripts, packageEntries });
    if (entry) entries.set(path, entry);
  }

  log(
    `Import graph: ${edges.length} imports among ${analysed.size} files; ${ignored.package} to packages, ${ignored.outside} outside the ` +
      `analysed files, ${ignored.missing} unresolved, ${nonLiteral} non-literal; ${entries.size} entry points.`,
  );
  const changed = (await changedTrackedPaths(root)).filter((p) => analysed.has(p));
  if (changed.length > 0) {
    log(
      `Warning: ${changed.length} analysed files differ in the working tree from the snapshot (${changed.slice(0, 5).join(', ')}` +
        `${changed.length > 5 ? ', …' : ''}). The import graph reads the snapshot; Knip read the working tree.`,
    );
  }
  return { importedBy, entries };
}

/**
 * The eulogy step (eulogies spec, design "Pipeline"): every grave's contents in one cat-file batch, the inputs, the run with the
 * cache, then the eulogies set on the data. Nothing else in the data changes.
 */
async function addEulogies(
  graveyard: Graveyard,
  context: {
    repoRoot: string;
    sourceFiles: readonly TreeFile[];
    history: HistoryResult;
    thresholds: Thresholds;
    analysedAt: string;
    eulogies: EulogyOptions;
    cachePath: string;
    deps: PipelineDeps;
  },
): Promise<Graveyard> {
  const { repoRoot, history, thresholds, eulogies, cachePath, deps } = context;
  const { log } = deps;
  const people = history.people;

  // A ghost's contents are the file as it was in its last existing commit.
  const blobByPath = new Map(context.sourceFiles.map((f): [string, string] => [f.path, f.blobSha]));
  const rawGhosts = new Map(history.ghosts.map((g) => [g.path, g]));
  const ghostBlobs = await resolveBlobNames(repoRoot, graveyard.ghosts.map((g) => `${g.lastExistingSha}:${g.path}`));
  const contentsByBlob = await mapBlobs(repoRoot, [...blobByPath.values(), ...ghostBlobs.values()], (bytes) => cutContents(bytes));
  const contentsOf = (blob: string | undefined): Contents =>
    (blob === undefined ? undefined : contentsByBlob.get(blob)) ?? { text: '', cut: false, kind: 'empty' };

  const jobs: EulogyJob[] = [
    ...graveyard.files.map((file) => ({
      path: file.path,
      input: fileInput(file, history.perFile.get(file.path)!, thresholds, contentsOf(blobByPath.get(file.path)), people, graveyard.meta.snapshotDate),
    })),
    ...graveyard.ghosts.map((ghost) => ({
      path: ghost.path,
      input: ghostInput(rawGhosts.get(ghost.path)!, contentsOf(ghostBlobs.get(`${ghost.lastExistingSha}:${ghost.path}`)), people),
    })),
  ];

  const entries = await readEulogyCache(cachePath, log);
  let newSinceWrite = 0;
  let writing: Promise<void> = Promise.resolve();
  const save = (): Promise<void> => (writing = writing.then(() => writeEulogyCache(cachePath, entries)));

  log(`Writing eulogies with ${eulogies.model} for ${jobs.length} graves (${eulogies.concurrency} at a time)`);
  const result = await runEulogies(jobs, {
    client: (deps.eulogyClient ?? ollamaClient)(eulogies.ollamaUrl, eulogies.model),
    cache: eulogiesOf(entries),
    model: eulogies.model,
    concurrency: eulogies.concurrency,
    people,
    log,
    onNew: (key, eulogy) => {
      entries.set(key, { eulogy, model: eulogies.model, at: context.analysedAt });
      if (++newSinceWrite >= CACHE_WRITE_EVERY) {
        newSinceWrite = 0;
        save().catch(() => {}); // a failed write is reported by the final save below
      }
    },
  });
  await save();
  for (const { path, reason } of result.empty.slice(0, 20)) log(`  left empty: ${path} (${reason})`);
  if (result.empty.length > 20) log(`  ... and ${result.empty.length - 20} more`);

  const eulogyOf = (path: string): string => result.eulogies.get(path) ?? '';
  return {
    ...graveyard,
    meta: { ...graveyard.meta, eulogyModel: eulogies.model },
    files: graveyard.files.map((file) => ({ ...file, eulogy: eulogyOf(file.path) })),
    ghosts: graveyard.ghosts.map((ghost) => ({ ...ghost, eulogy: eulogyOf(ghost.path) })),
  };
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
