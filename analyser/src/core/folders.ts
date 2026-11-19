import type { Folder } from '../../../shared/graveyard-schema';
import { compareCodePoint } from './sort';

/**
 * Folder hierarchy for the crypts. Pure.
 * Paths are repo-relative with forward slashes and no trailing slash. The root is "".
 */

/** Path of the directory that holds `path`. Top-level entries are in the root, "". */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * The root plus every ancestor directory of every file, each with its parent
 * (null for the root), sorted by path. Folders with no file inside or below them
 * are never listed, so a folder that only held deleted files does not appear.
 */
export function deriveFolders(filePaths: readonly string[]): Folder[] {
  const paths = new Set<string>(['']);

  for (const filePath of filePaths) {
    let folder = folderOf(filePath);
    // Stop at the first folder already known: its ancestors were added with it.
    while (folder !== '' && !paths.has(folder)) {
      paths.add(folder);
      folder = folderOf(folder);
    }
  }

  return [...paths]
    .sort(compareCodePoint)
    .map((path) => ({ path, parent: path === '' ? null : folderOf(path) }));
}
