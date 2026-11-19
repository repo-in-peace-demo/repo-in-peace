import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KnipOutputError, parseKnipOutput } from '../core/knip-parse';
import { AnalyserError } from '../errors';

/**
 * Runs Knip against the clone and reads its answer.
 * Knip's own exit codes: 0 = ran, nothing found; 1 = ran, issues found; 2 = did not run.
 * Only 2 (or not starting at all) is a failure. See https://knip.dev/reference/cli.
 */

export const KNIP_ADVICE =
  "The most likely cause is that the repository's dependencies are not installed in the clone. " +
  'Install them yourself (for example `npm install` inside the clone), then run the analyser again. ' +
  'The analyser never installs anything.';

/** Used instead of KNIP_ADVICE when Knip itself says it cannot find a package.json: installing would not help. */
export const KNIP_DIR_ADVICE =
  'Knip needs a package.json in the folder it runs in. If this repository keeps its JS/TS in a subfolder, ' +
  'run the analyser again with --knip-dir <folder> (repeat it for several folders).';

const NO_PACKAGE_JSON = /unable to find package\.json/i;

export interface KnipRunOptions {
  /** Real path of the folder Knip runs in: the clone root, or a folder inside it (--knip-dir). */
  clonePath: string;
  /** Knip config file to use instead of the clone's own. */
  configPath?: string;
}

export interface KnipProcessResult {
  /** null when Knip was ended by a signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Set when Knip could not be started. */
  spawnError?: string;
}

/**
 * An AnalyserError for any Knip problem. It ends with advice (Req 6.5): install the repository's
 * dependencies yourself, except when Knip says it found no package.json, where the fix is --knip-dir.
 * @param folder the --knip-dir folder Knip ran in, named in the message; "" for the clone root.
 */
export function knipFailure(reason: string, stderr = '', folder = ''): AnalyserError {
  const tail = stderrTail(stderr);
  const where = folder === '' ? '' : ` in "${folder}"`;
  const advice = NO_PACKAGE_JSON.test(`${reason}\n${stderr}`) ? KNIP_DIR_ADVICE : KNIP_ADVICE;
  return new AnalyserError(`Knip failed${where}: ${reason}${tail === '' ? '' : `\n${tail}`}\n\n${advice}`);
}

function stderrTail(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  return lines.slice(-15).map((l) => `  ${l}`).join('\n');
}

/** Arguments for `node`: Knip's script, then Knip's own options. Only unused files are asked for. */
export function buildKnipArgs(knipBin: string, options: KnipRunOptions): string[] {
  const args = [knipBin, '--directory', options.clonePath, '--reporter', 'json', '--include', 'files', '--no-progress'];
  if (options.configPath !== undefined) args.push('--config', resolve(options.configPath));
  return args;
}

/**
 * Finds the Knip script installed for the analyser itself, so the analysed repo
 * need not depend on Knip. Walks up from `startDir` looking for node_modules/knip.
 */
export function findKnipBin(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  for (;;) {
    const packageJson = join(dir, 'node_modules', 'knip', 'package.json');
    if (existsSync(packageJson)) {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as { bin?: string | Record<string, string> };
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['knip'];
      if (bin === undefined) throw knipFailure('the installed Knip package has no "knip" executable');
      return join(dirname(packageJson), bin);
    }
    const parent = dirname(dir);
    if (parent === dir) throw knipFailure('Knip is not installed for the analyser (run `npm install` in analyser/)');
    dir = parent;
  }
}

/** Runs Knip as a child process. Never rejects: problems are reported in the result. */
export function runKnipProcess(options: KnipRunOptions): Promise<KnipProcessResult> {
  return new Promise((resolvePromise) => {
    let knipBin: string;
    try {
      knipBin = findKnipBin();
    } catch (error) {
      resolvePromise({ exitCode: null, stdout: '', stderr: '', spawnError: (error as Error).message });
      return;
    }

    const child = spawn(process.execPath, buildKnipArgs(knipBin, options), {
      cwd: options.clonePath,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode: null, stdout, stderr, spawnError: error.message });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

/** Turns a Knip run into the set of unused files, or throws an AnalyserError. Pure. `folder` is the --knip-dir it ran in. */
export function readKnipResult(result: KnipProcessResult, folder = ''): Set<string> {
  if (result.spawnError !== undefined) {
    throw knipFailure(`could not run Knip: ${result.spawnError}`, result.stderr, folder);
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw knipFailure(
      result.exitCode === null ? 'Knip was stopped before it finished.' : `Knip exited with code ${result.exitCode}.`,
      result.stderr,
      folder,
    );
  }
  try {
    return parseKnipOutput(result.stdout);
  } catch (error) {
    if (error instanceof KnipOutputError) throw knipFailure(error.message, result.stderr, folder);
    throw error;
  }
}
