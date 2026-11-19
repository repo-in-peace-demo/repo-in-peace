import { SCHEMA_VERSION, type FileEntry, type Folder, type Ghost, type Graveyard, type Thresholds } from '@shared/graveyard-schema';
import { compareCodePoint } from '../src/model/sort';
import { DEFAULT_THRESHOLDS } from './arbitraries';

/**
 * A small hand-made graveyard for example tests. Give the paths of the files and ghosts; the folders (with
 * their ancestors) are worked out, and every file is fresh, used and cold unless the spec says otherwise.
 * The result passes `validateGraveyard`.
 */

export interface FileSpec {
  path: string;
  linesOfCode?: number;
  state?: FileEntry['decayState'];
  unused?: boolean;
  hot?: boolean;
  /** Whole days before the snapshot. Default 1. */
  ageDays?: number;
}

export interface GraveyardSpec {
  files?: ReadonlyArray<string | FileSpec>;
  /** Folders to add even when no file is in them (and their ancestors). */
  folders?: readonly string[];
  /** Paths of deleted files. */
  ghosts?: readonly string[];
  thresholds?: Thresholds;
  name?: string;
}

const SNAPSHOT = '2026-08-18T00:00:00.000Z';
const DAY = 86_400_000;

const dirnameOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function graveyardFrom(spec: GraveyardSpec): Graveyard {
  const thresholds = spec.thresholds ?? DEFAULT_THRESHOLDS;
  const fileSpecs: FileSpec[] = (spec.files ?? []).map((f) => (typeof f === 'string' ? { path: f } : f));

  const folderSet = new Set<string>(['']);
  const addWithAncestors = (folder: string): void => {
    for (let current = folder; current !== ''; current = dirnameOf(current)) folderSet.add(current);
  };
  for (const f of fileSpecs) addWithAncestors(dirnameOf(f.path));
  for (const folder of spec.folders ?? []) addWithAncestors(folder);

  const folders: Folder[] = [...folderSet]
    .sort(compareCodePoint)
    .map((path) => ({ path, parent: path === '' ? null : dirnameOf(path) }));

  const files: FileEntry[] = fileSpecs.map((f) => {
    const age = f.ageDays ?? 1;
    return {
      path: f.path,
      folder: dirnameOf(f.path),
      linesOfCode: f.linesOfCode ?? 10,
      lastCommitDate: new Date(Date.parse(SNAPSHOT) - age * DAY).toISOString(),
      lastCommitAuthor: 'Ann',
      recentCommits: f.hot === true ? thresholds.hotCommits : 0,
      unused: f.unused ?? false,
      decayScore: 0,
      decayState: f.state ?? 'fresh',
      hot: f.hot ?? false,
      eulogy: '',
    };
  });

  const ghosts: Ghost[] = (spec.ghosts ?? []).map((path) => ({
    path,
    deletedInSha: 'd'.repeat(40),
    deletedDate: '2026-07-01T00:00:00.000Z',
    deletedBy: 'Bob',
    lastExistingSha: 'e'.repeat(40),
  }));

  return {
    meta: {
      name: spec.name ?? 'hand-made',
      snapshotSha: 'f'.repeat(40),
      snapshotDate: SNAPSHOT,
      analysedAt: '2026-11-19T12:00:00.000Z',
      schemaVersion: SCHEMA_VERSION,
      thresholds,
    },
    folders,
    files,
    ghosts,
  };
}
