import { isAbsolute, relative, sep } from 'node:path';

/** Path helpers with no file access. */

/**
 * `<name>.graveyard.json`, with anything outside letters, digits, dot, underscore and hyphen
 * in the repo name replaced by a hyphen so the file name is safe everywhere.
 */
export function defaultOutputName(repoName: string): string {
  const safe = repoName.replace(/[^A-Za-z0-9._-]/g, '-');
  const usable = safe === '' || /^\.+$/.test(safe) ? 'repo' : safe;
  return `${usable}.graveyard.json`;
}

/** True when `target` is `directory` itself or anywhere below it. Both must be absolute and normalised. */
export function isInside(directory: string, target: string): boolean {
  const rel = relative(directory, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
