import { execFile, spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { AnalyserError } from '../errors';
import { GIT_LOG_ARGS } from './git-log-parse';

/**
 * Everything the analyser asks git. Read-only commands only, so the clone is never changed.
 * Every call passes arguments as an array (no shell), so odd path names are safe.
 */

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: '0', // do not take index locks or refresh the index
  GIT_TERMINAL_PROMPT: '0',
};

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** git could not be started at all. */
  notInstalled: boolean;
}

function execGit(repo: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', repo, ...args],
      { encoding: 'utf8', maxBuffer: Infinity, env: GIT_ENV },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        resolve({ ok: error === null, stdout, stderr, notInstalled: code === 'ENOENT' });
      },
    );
  });
}

const NOT_INSTALLED = 'git is not installed or is not on the PATH';

async function runGit(repo: string, args: readonly string[]): Promise<string> {
  const result = await execGit(repo, args);
  if (result.ok) return result.stdout;
  if (result.notInstalled) throw new AnalyserError(NOT_INSTALLED);
  throw new AnalyserError(`git ${args[0] ?? ''} failed: ${result.stderr.trim() || 'no error message'}`);
}

export interface RepoInfo {
  /** Real path of the repository root. */
  root: string;
  /** Last segment of the root path. */
  name: string;
}

/**
 * Checks the path is the root of a normal, full-history git clone.
 * Rejects: missing paths, non-repositories, bare repositories, shallow clones, subdirectories.
 */
export async function assertUsableRepo(path: string): Promise<RepoInfo> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new AnalyserError(`"${path}" does not exist`);
  }
  if (!info.isDirectory()) throw new AnalyserError(`"${path}" is not a directory`);

  const inside = await execGit(path, ['rev-parse', '--is-inside-work-tree']);
  if (inside.notInstalled) throw new AnalyserError(NOT_INSTALLED);
  if (!inside.ok) {
    throw new AnalyserError(`"${path}" is not a git repository (${inside.stderr.trim() || 'git rev-parse failed'})`);
  }
  if (inside.stdout.trim() !== 'true') {
    throw new AnalyserError(`"${path}" is a bare repository. Point the analyser at a normal clone with a working tree.`);
  }

  const shallow = await runGit(path, ['rev-parse', '--is-shallow-repository']);
  if (shallow.trim() === 'true') {
    throw new AnalyserError(
      `"${path}" is a shallow clone, so its history is incomplete. ` +
        'Run `git fetch --unshallow` in it (or clone again without --depth) and re-run the analyser.',
    );
  }

  const topLevel = (await runGit(path, ['rev-parse', '--show-toplevel'])).trim();
  const [realPath, realTop] = await Promise.all([realpath(path), realpath(topLevel)]);
  if (realPath !== realTop) {
    throw new AnalyserError(`"${path}" is inside the repository at "${realTop}". Pass the repository root instead.`);
  }

  return { root: realPath, name: basename(realPath) };
}

export interface Snapshot {
  sha: string;
  /** Committer date, ISO 8601 UTC. */
  date: string;
}

/** The snapshot is the commit HEAD points to. */
export async function resolveSnapshot(repo: string): Promise<Snapshot> {
  const result = await execGit(repo, ['log', '-1', '--format=%H%x00%cI', 'HEAD']);
  if (result.notInstalled) throw new AnalyserError(NOT_INSTALLED);
  if (!result.ok) throw new AnalyserError(`"${repo}" has no commits to analyse`);

  const [sha = '', dateText = ''] = result.stdout.trim().split('\0');
  const ms = Date.parse(dateText);
  if (sha === '' || Number.isNaN(ms)) throw new AnalyserError(`could not read the HEAD commit of "${repo}"`);
  return { sha, date: new Date(ms).toISOString() };
}

export interface TreeFile {
  path: string;
  blobSha: string;
}

/**
 * Regular files in the snapshot's tree, every one of them (not only source files).
 * Symlinks and submodules are skipped.
 */
export async function listTree(repo: string, commitSha: string): Promise<TreeFile[]> {
  return parseLsTree(await runGit(repo, ['ls-tree', '-r', '-z', commitSha]));
}

/** Parses `git ls-tree -r -z`: `<mode> <type> <sha>\t<path>` entries separated by NUL. */
export function parseLsTree(text: string): TreeFile[] {
  const files: TreeFile[] = [];
  for (const entry of text.split('\0')) {
    if (entry === '') continue;
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t([\s\S]+)$/.exec(entry);
    if (match === null) throw new AnalyserError(`unexpected git ls-tree output: ${entry.slice(0, 80)}`);
    const [, mode, type, blobSha, path] = match;
    if (type === 'blob' && (mode === '100644' || mode === '100755')) {
      files.push({ path: path!, blobSha: blobSha! });
    }
  }
  return files;
}

/** The raw `git log` text for the snapshot, for parseGitLog. */
export function readLog(repo: string, commitSha: string): Promise<string> {
  return runGit(repo, [...GIT_LOG_ARGS, commitSha]);
}

/**
 * Reads blobs through one `git cat-file --batch` process and reduces each to a
 * value with `reduce`, so file contents are not all held in memory at once.
 * `reduce` must not keep the array it is given: it is a view into a shared buffer.
 * Identical blobs are read once.
 */
export function mapBlobs<T>(
  repo: string,
  blobShas: Iterable<string>,
  reduce: (content: Uint8Array) => T,
): Promise<Map<string, T>> {
  const unique = [...new Set(blobShas)];
  if (unique.length === 0) return Promise.resolve(new Map());

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], {
      env: GIT_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.stdin.on('error', () => {
      // git exited before reading everything; the close handler reports why.
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(new AnalyserError(error.code === 'ENOENT' ? NOT_INSTALLED : `git cat-file failed: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new AnalyserError(`git cat-file failed: ${Buffer.concat(err).toString('utf8').trim() || `exit ${code}`}`));
        return;
      }
      try {
        resolve(parseCatFileBatch(Buffer.concat(out), unique, reduce));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${unique.join('\n')}\n`);
  });
}

/** How many `<commit>:<path>` names go to one `git rev-parse`, to stay well under the argument length limit. */
const REV_PARSE_CHUNK = 200;

/**
 * The blob SHA of each `<commit>:<path>` name, for `mapBlobs` (which needs SHAs: cat-file answers with the SHA, not the name).
 * A name git cannot resolve is left out of the result.
 */
export async function resolveBlobNames(repo: string, names: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(names)];
  const result = new Map<string, string>();
  const resolveOne = async (name: string): Promise<void> => {
    const one = await execGit(repo, ['rev-parse', '--verify', '--quiet', name]);
    if (one.notInstalled) throw new AnalyserError(NOT_INSTALLED);
    if (one.ok && one.stdout.trim() !== '') result.set(name, one.stdout.trim());
  };
  for (let i = 0; i < unique.length; i += REV_PARSE_CHUNK) {
    const chunk = unique.slice(i, i + REV_PARSE_CHUNK);
    const all = await execGit(repo, ['rev-parse', ...chunk]);
    if (all.notInstalled) throw new AnalyserError(NOT_INSTALLED);
    const lines = all.stdout.split('\n').filter((line) => line !== '');
    if (all.ok && lines.length === chunk.length) {
      chunk.forEach((name, j) => result.set(name, lines[j]!));
    } else {
      // One name did not resolve, so the whole call failed: ask about each on its own.
      for (const name of chunk) await resolveOne(name);
    }
  }
  return result;
}

/**
 * Parses `git cat-file --batch` output for the objects asked for, in order:
 * `<sha> <type> <size>\n<size bytes>\n` each, or `<sha> missing\n`.
 */
export function parseCatFileBatch<T>(
  output: Uint8Array,
  expectedShas: readonly string[],
  reduce: (content: Uint8Array) => T,
): Map<string, T> {
  const buffer = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  const result = new Map<string, T>();
  let position = 0;

  for (const sha of expectedShas) {
    const lineEnd = buffer.indexOf(0x0a, position);
    if (lineEnd === -1) throw new AnalyserError(`git cat-file output ended early, before ${sha}`);

    const header = buffer.toString('latin1', position, lineEnd);
    const parts = header.split(' ');
    if (parts[0] !== sha) throw new AnalyserError(`git cat-file answered "${header}" when asked for ${sha}`);
    if (parts[1] === 'missing') throw new AnalyserError(`git has no object ${sha}`);

    const size = Number(parts[2]);
    if (parts[1] !== 'blob' || !Number.isInteger(size) || size < 0) {
      throw new AnalyserError(`git cat-file gave an unexpected header: "${header}"`);
    }
    const start = lineEnd + 1;
    if (start + size > buffer.length) throw new AnalyserError(`git cat-file output was cut off inside ${sha}`);

    result.set(sha, reduce(buffer.subarray(start, start + size)));
    position = start + size + 1; // skip the newline git writes after each object
  }
  return result;
}
