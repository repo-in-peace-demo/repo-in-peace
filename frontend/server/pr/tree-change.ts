/**
 * The one-path change a pull request makes (bury-and-resurrect Req 2.2, 3.2, 4.1), and the walk that finds a path in a git tree.
 * Pure apart from the tree reader passed in (in production, `GET /git/trees/{sha}` one folder at a time, never `recursive`, so a large
 * repository never meets GitHub's truncation limit).
 */

export type EntryType = 'blob' | 'tree' | 'commit';

/** One entry of a git tree, as `GET /git/trees/{sha}` lists it: `path` is the entry's own name within its folder. */
export interface TreeEntry {
  path: string;
  mode: string;
  type: EntryType;
  sha: string;
}

export type ReadTree = (treeSha: string) => Promise<readonly TreeEntry[]>;

/** What is at a path in a tree. */
export type Found =
  | { kind: 'blob'; mode: string; sha: string } // a file (or a symlink: mode 120000)
  | { kind: 'tree' } // a folder
  | { kind: 'commit' } // a submodule
  | { kind: 'absent' } // nothing there, and nothing in the way
  | { kind: 'blocked'; at: string }; // a file or submodule where one of the path's folders would be

/** Walks the tree folder by folder to the path. */
export async function lookupPath(readTree: ReadTree, rootTreeSha: string, path: string): Promise<Found> {
  const parts = path.split('/');
  let treeSha = rootTreeSha;
  for (let i = 0; i < parts.length; i++) {
    const entry = (await readTree(treeSha)).find((e) => e.path === parts[i]);
    const last = i === parts.length - 1;
    if (entry === undefined) return { kind: 'absent' };
    if (last) return entry.type === 'blob' ? { kind: 'blob', mode: entry.mode, sha: entry.sha } : { kind: entry.type };
    if (entry.type !== 'tree') return { kind: 'blocked', at: parts.slice(0, i + 1).join('/') };
    treeSha = entry.sha;
  }
  return { kind: 'absent' };
}

/** The single entry for `POST /git/trees` with `base_tree`. `sha: null` deletes the path. */
export interface ChangeEntry {
  path: string;
  mode: string;
  type: 'blob';
  sha: string | null;
}

export type ChangeRefusal = 'not-on-base' | 'not-a-file' | 'already-exists' | 'original-missing';
export type Change = { entry: ChangeEntry } | { refused: ChangeRefusal };

/** Bury: the file must be a file on the base branch head (Req 2.4); it is removed, and nothing else changes. */
export function buryChange(path: string, onBase: Found): Change {
  if (onBase.kind === 'absent' || onBase.kind === 'blocked') return { refused: 'not-on-base' };
  if (onBase.kind !== 'blob') return { refused: 'not-a-file' };
  return { entry: { path, mode: onBase.mode, type: 'blob', sha: null } };
}

/**
 * Resurrect: nothing may be at the path on the base branch head, nor a file where one of its folders would go (Req 3.4); the file is
 * added with the blob and mode it had at its last existing commit, so it is byte for byte what it was (Req 3.2).
 */
export function resurrectChange(path: string, onBase: Found, original: Found): Change {
  if (onBase.kind !== 'absent') return { refused: 'already-exists' };
  if (original.kind !== 'blob') return { refused: 'original-missing' };
  return { entry: { path, mode: original.mode, type: 'blob', sha: original.sha } };
}

/** A tree as a flat map of file path to mode and blob, for the property tests and the fake GitHub server. */
export type FlatTree = ReadonlyMap<string, { mode: string; sha: string }>;

/** Applies a change entry the way GitHub's `POST /git/trees` with `base_tree` does. Deleting a missing path is an error, as on GitHub. */
export function applyTreeChange(base: FlatTree, entry: ChangeEntry): Map<string, { mode: string; sha: string }> {
  const next = new Map(base);
  if (entry.sha === null) {
    if (!next.has(entry.path)) throw new Error(`cannot delete ${entry.path}: not in the tree`);
    next.delete(entry.path);
  } else {
    next.set(entry.path, { mode: entry.mode, sha: entry.sha });
  }
  return next;
}
