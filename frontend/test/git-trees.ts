import { createHash } from 'node:crypto';
import type { FlatTree, TreeEntry } from '../server/pr/tree-change';

/**
 * Nested git-like trees from a flat file list, for tests: every folder becomes a tree object with a SHA made from its entries, so the
 * same files always give the same SHAs. (Not git's own hashing; only stable and distinct.)
 */
export interface TreeStore {
  root: string;
  trees: Map<string, TreeEntry[]>;
  read: (sha: string) => Promise<readonly TreeEntry[]>;
}

export function buildTrees(files: FlatTree, submodules: ReadonlyMap<string, string> = new Map(), into: Map<string, TreeEntry[]> = new Map()): TreeStore {
  const trees = into;
  type Node = { files: Map<string, { mode: string; sha: string; type: 'blob' | 'commit' }>; dirs: Map<string, Node> };
  const rootNode: Node = { files: new Map(), dirs: new Map() };
  const add = (path: string, value: { mode: string; sha: string; type: 'blob' | 'commit' }) => {
    const parts = path.split('/');
    let node = rootNode;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) node.dirs.set(part, (next = { files: new Map(), dirs: new Map() }));
      node = next;
    }
    node.files.set(parts[parts.length - 1]!, value);
  };
  for (const [path, f] of files) add(path, { ...f, type: 'blob' });
  for (const [path, sha] of submodules) add(path, { mode: '160000', sha, type: 'commit' });
  const write = (node: Node): string => {
    const entries: TreeEntry[] = [
      ...[...node.dirs].map(([name, child]): TreeEntry => ({ path: name, mode: '040000', type: 'tree', sha: write(child) })),
      ...[...node.files].map(([name, f]): TreeEntry => ({ path: name, mode: f.mode, type: f.type, sha: f.sha })),
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const sha = createHash('sha1').update(JSON.stringify(entries)).digest('hex');
    trees.set(sha, entries);
    return sha;
  };
  const root = write(rootNode);
  return {
    root,
    trees,
    read: async (sha) => {
      const t = trees.get(sha);
      if (!t) throw new Error(`no tree ${sha}`);
      return t;
    },
  };
}

/** A blob SHA for test contents. */
export const blobSha = (content: string): string => createHash('sha1').update(`blob:${content}`).digest('hex');

/** Every file under a tree, as a flat map (submodules left out). */
export function flattenTree(trees: ReadonlyMap<string, readonly TreeEntry[]>, rootSha: string, prefix = ''): Map<string, { mode: string; sha: string }> {
  const out = new Map<string, { mode: string; sha: string }>();
  const entries = trees.get(rootSha);
  if (!entries) throw new Error(`no tree ${rootSha}`);
  for (const e of entries) {
    const path = prefix === '' ? e.path : `${prefix}/${e.path}`;
    if (e.type === 'tree') for (const [p, f] of flattenTree(trees, e.sha, path)) out.set(p, f);
    else if (e.type === 'blob') out.set(path, { mode: e.mode, sha: e.sha });
  }
  return out;
}
