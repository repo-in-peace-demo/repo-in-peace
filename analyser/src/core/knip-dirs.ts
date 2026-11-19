import { compareCodePoint } from './sort';

/**
 * Where Knip runs. By default in the clone root, but a repository may keep its JS/TS in a
 * subfolder (a Python project with a web app in `app/`). `--knip-dir <folder>` names such folders.
 * Pure: no file access. A folder is a repo-relative path with forward slashes, "" for the clone root.
 */

/**
 * Cleans a --knip-dir value. Returns "" for the clone root ("." or "./"), a normalised
 * folder like "app" or "packages/web", or undefined when the value is not a folder inside the clone.
 */
export function normaliseKnipDir(value: string): string | undefined {
  if (value === '') return undefined;
  const slashed = value.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) return undefined; // absolute
  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return undefined; // would leave the clone
  return segments.join('/');
}

/** Folders that contain a tracked package.json (outside node_modules), sorted. "" is the clone root. */
export function packageJsonDirs(treePaths: Iterable<string>): string[] {
  const dirs = new Set<string>();
  for (const path of treePaths) {
    const segments = path.split('/');
    if (segments[segments.length - 1] !== 'package.json') continue;
    if (segments.includes('node_modules')) continue;
    dirs.add(segments.slice(0, -1).join('/'));
  }
  return [...dirs].sort(compareCodePoint);
}

export function describeKnipDir(dir: string): string {
  return dir === '' ? 'the clone root' : `"${dir}"`;
}

/**
 * The error text for the fast check, or undefined when every folder has a package.json.
 * It never mentions installing dependencies: the fix is choosing the right folder.
 */
export function missingPackageJsonMessage(dirs: readonly string[], treePaths: readonly string[]): string | undefined {
  const have = packageJsonDirs(treePaths);
  const haveSet = new Set(have);
  const missing = dirs.filter((dir) => !haveSet.has(dir));
  if (missing.length === 0) return undefined;

  const first = `No package.json found in ${missing.map(describeKnipDir).join(' or ')}. Knip needs a package.json in each folder it runs in.`;
  if (have.length === 0) {
    return `${first} This clone has no package.json outside node_modules, so there is nothing for Knip to analyse.`;
  }
  const example = have[0] === '' ? '.' : have[0];
  return (
    `${first} Folders in this clone that contain a package.json: ${have.map(describeKnipDir).join(', ')}. ` +
    `Run again with --knip-dir <folder> for each folder you want analysed, for example --knip-dir ${example}.`
  );
}

/** Knip prints paths relative to the folder it ran in. This makes them repo-relative. */
export function prefixKnipPaths(dir: string, paths: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const path of paths) result.add(dir === '' ? path : `${dir}/${path}`);
  return result;
}

/** The tree paths below `dir`, with the folder prefix removed. For the clone root, all of them. */
export function relativeToKnipDir(dir: string, treePaths: readonly string[]): string[] {
  if (dir === '') return [...treePaths];
  const prefix = `${dir}/`;
  return treePaths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}
