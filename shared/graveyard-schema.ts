/**
 * Graveyard data file schema, version 2.
 *
 * The analyser writes this file and the frontend reads it. This is the only
 * place the schema is defined. Change it only here, and bump SCHEMA_VERSION
 * when the shape changes.
 *
 * Key order in the interfaces below is the key order in the written JSON.
 */

/** 2: `meta.thresholds` added (decay thresholds became configurable). */
export const SCHEMA_VERSION = 2;

export type DecayState = 'fresh' | 'stale' | 'ancient';

export const DECAY_STATES: readonly DecayState[] = ['fresh', 'stale', 'ancient'];

/** The numbers that turn age and commit counts into a decay state, score and hot flag. Recorded so readers can show the real values. */
export interface Thresholds {
  /** A file is fresh below this many days since its last commit. Default 90. */
  staleAfterDays: number;
  /** A file is ancient above this many days (stale from `staleAfterDays` up to and including this). Default 360. Greater than `staleAfterDays`. */
  ancientAfterDays: number;
  /** The age part of the decay score stops growing at this age. Always 2 x `ancientAfterDays` (720 by default). */
  decayCapDays: number;
  /** A file is hot with this many commits or more in the hot window. Default 5. */
  hotCommits: number;
  /** Length of the hot window, in days before the snapshot date. Default 30. */
  hotWindowDays: number;
}

export interface RepoMeta {
  /** Repository name, taken from the clone. */
  name: string;
  /** Commit the analysis describes. */
  snapshotSha: string;
  /** Committer date of the snapshot commit, ISO 8601 UTC with milliseconds. */
  snapshotDate: string;
  /** When the analyser ran, ISO 8601 UTC. The only value not derived from the snapshot. */
  analysedAt: string;
  schemaVersion: number;
  /** The decay thresholds the analyser ran with. */
  thresholds: Thresholds;
  /** The local model that wrote the eulogies (Ollama), present only when the analyser ran with --eulogies. */
  eulogyModel?: string;
}

export interface Folder {
  /** Repo-relative path with forward slashes and no trailing slash. The repo root is "". */
  path: string;
  /** Path of the parent folder. null only for the root. */
  parent: string | null;
}

export interface FileEntry {
  path: string;
  /** Path of the immediate parent folder. Always present in `folders`. */
  folder: string;
  /** Non-blank lines at the snapshot commit. */
  linesOfCode: number;
  lastCommitDate: string;
  lastCommitAuthor: string;
  /**
   * Commits in the hot window before the snapshot date: `meta.thresholds.hotWindowDays` days, 30 by default.
   * (Version 1 called this `commitsLast30Days`; the window was fixed at 30 days.)
   */
  recentCommits: number;
  /** Knip lists this file as unused. */
  unused: boolean;
  /** 0 to 1, rounded to 4 decimals. */
  decayScore: number;
  decayState: DecayState;
  /** Many commits in the 30 days before the snapshot. */
  hot: boolean;
  /**
   * The analysed files that import this one, sorted by path; `typeOnly` when every import from that file is type-only (importers
   * spec). Present (possibly empty) when the analyser built the import graph; absent in older files.
   */
  importedBy?: ImporterEntry[];
  /** Set when a framework or tool loads this file rather than an import: Next.js routes, Vite entries, configs, tests. */
  entry?: EntryPoint;
  /** Always "" from the analyser. A later step fills it. */
  eulogy: string;
}

export interface ImporterEntry {
  path: string;
  typeOnly?: true;
}

export type EntryKind = 'framework' | 'config' | 'test' | 'package';
export const ENTRY_KINDS: readonly EntryKind[] = ['framework', 'config', 'test', 'package'];

export interface EntryPoint {
  kind: EntryKind;
  /** A short label: "Next.js route", "Vite entry", "test". */
  label: string;
}

export interface Ghost {
  /** Path of the deleted file. */
  path: string;
  /** The commit that deleted it. */
  deletedInSha: string;
  deletedDate: string;
  deletedBy: string;
  /** First parent of the deleting commit: the last commit in which the file still existed. */
  lastExistingSha: string;
  /** Its epitaph, present only when the analyser ran with --eulogies ("" when none was written). Absent reads as "". */
  eulogy?: string;
}

export interface Graveyard {
  meta: RepoMeta;
  folders: Folder[];
  files: FileEntry[];
  ghosts: Ghost[];
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const MAX_ERRORS = 50;
const SHA_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Checks an unknown value against the schema and against the structural rules
 * the data file promises: every file's folder exists, the folder tree has one
 * root and no cycles, and no path is both a current file and a ghost.
 * Returns every problem found, up to 50.
 */
export function validateGraveyard(value: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (message: string): void => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };

  if (!isRecord(value)) return { ok: false, errors: ['graveyard must be an object'] };

  checkMeta(value['meta'], fail);
  const folderPaths = checkFolders(value['folders'], fail);
  const filePaths = checkFiles(value['files'], folderPaths, fail);
  checkGhosts(value['ghosts'], filePaths, fail);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

type Fail = (message: string) => void;

function checkMeta(meta: unknown, fail: Fail): void {
  if (!isRecord(meta)) return fail('meta must be an object');
  if (!isNonEmptyString(meta['name'])) fail('meta.name must be a non-empty string');
  if (!isSha(meta['snapshotSha'])) fail('meta.snapshotSha must be a full commit SHA');
  if (!isIsoUtc(meta['snapshotDate'])) fail('meta.snapshotDate must be an ISO 8601 UTC date');
  if (!isIsoUtc(meta['analysedAt'])) fail('meta.analysedAt must be an ISO 8601 UTC date');
  if (meta['schemaVersion'] !== SCHEMA_VERSION) {
    fail(`meta.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  checkThresholds(meta['thresholds'], fail);
  if ('eulogyModel' in meta && !isNonEmptyString(meta['eulogyModel'])) fail('meta.eulogyModel must be a non-empty string when present');
}

function checkThresholds(thresholds: unknown, fail: Fail): void {
  if (!isRecord(thresholds)) return fail('meta.thresholds must be an object');
  const names = ['staleAfterDays', 'ancientAfterDays', 'decayCapDays', 'hotCommits', 'hotWindowDays'] as const;
  let allCounts = true;
  for (const name of names) {
    if (!isPositiveInteger(thresholds[name])) {
      fail(`meta.thresholds.${name} must be a positive whole number`);
      allCounts = false;
    }
  }
  if (!allCounts) return;

  const { staleAfterDays, ancientAfterDays, decayCapDays } = thresholds as Record<(typeof names)[number], number>;
  if (ancientAfterDays <= staleAfterDays) {
    fail('meta.thresholds.ancientAfterDays must be greater than staleAfterDays');
  }
  if (decayCapDays !== 2 * ancientAfterDays) {
    fail('meta.thresholds.decayCapDays must be 2 x ancientAfterDays');
  }
}

/** Returns the set of folder paths found, so later checks can use it. */
function checkFolders(folders: unknown, fail: Fail): Set<string> {
  const paths = new Set<string>();
  if (!Array.isArray(folders)) {
    fail('folders must be an array');
    return paths;
  }

  const parentOf = new Map<string, string | null>();
  folders.forEach((folder: unknown, i) => {
    const at = `folders[${i}]`;
    if (!isRecord(folder)) return fail(`${at} must be an object`);
    const { path, parent } = folder;
    if (typeof path !== 'string') return fail(`${at}.path must be a string`);
    if (parent !== null && typeof parent !== 'string') {
      return fail(`${at}.parent must be a string or null`);
    }
    if (parentOf.has(path)) return fail(`${at}: duplicate folder path "${path}"`);
    parentOf.set(path, parent);
    paths.add(path);
  });

  const roots = [...parentOf].filter(([, parent]) => parent === null).map(([path]) => path);
  if (parentOf.size > 0) {
    if (roots.length !== 1 || roots[0] !== '') {
      fail('folders must have exactly one root, with path "" and parent null');
    }
  }

  for (const [path, parent] of parentOf) {
    if (parent !== null && !parentOf.has(parent)) {
      fail(`folder "${path}" names a parent "${parent}" that is not in the folder list`);
    }
  }

  // Every parent chain must reach the root without revisiting a folder.
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    let current: string | null | undefined = start;
    while (current !== null && current !== undefined) {
      if (seen.has(current)) {
        fail(`folder hierarchy has a cycle through "${current}"`);
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }

  return paths;
}

/** Returns the set of file paths found. */
/** Strict "a before b" by Unicode code point, the analyser's order (core/sort.ts), not UTF-16 units. */
function codePointLess(a: string, b: string): boolean {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]!.codePointAt(0)! < y[i]!.codePointAt(0)!;
  }
  return x.length < y.length;
}

function checkFiles(files: unknown, folderPaths: Set<string>, fail: Fail): Set<string> {
  const paths = new Set<string>();
  if (!Array.isArray(files)) {
    fail('files must be an array');
    return paths;
  }

  files.forEach((file: unknown, i) => {
    const at = `files[${i}]`;
    if (!isRecord(file)) return fail(`${at} must be an object`);

    if (!isNonEmptyString(file['path'])) {
      fail(`${at}.path must be a non-empty string`);
    } else if (paths.has(file['path'])) {
      fail(`${at}: duplicate file path "${file['path']}"`);
    } else {
      paths.add(file['path']);
    }

    const folder = file['folder'];
    if (typeof folder !== 'string') fail(`${at}.folder must be a string`);
    else if (!folderPaths.has(folder)) fail(`${at}.folder "${folder}" is not in the folder list`);

    if (!isCount(file['linesOfCode'])) fail(`${at}.linesOfCode must be a whole number, 0 or more`);
    if (!isIsoUtc(file['lastCommitDate'])) fail(`${at}.lastCommitDate must be an ISO 8601 UTC date`);
    if (typeof file['lastCommitAuthor'] !== 'string') fail(`${at}.lastCommitAuthor must be a string`);
    if (!isCount(file['recentCommits'])) {
      fail(`${at}.recentCommits must be a whole number, 0 or more`);
    }
    if (typeof file['unused'] !== 'boolean') fail(`${at}.unused must be a boolean`);

    const score = file['decayScore'];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      fail(`${at}.decayScore must be a number from 0 to 1`);
    }

    const state = file['decayState'];
    if (!DECAY_STATES.some((s) => s === state)) {
      fail(`${at}.decayState must be one of ${DECAY_STATES.join(', ')}`);
    }

    if (typeof file['hot'] !== 'boolean') fail(`${at}.hot must be a boolean`);
    if ('entry' in file) {
      const e = file['entry'];
      if (!isRecord(e) || !ENTRY_KINDS.some((k) => k === e['kind']) || !isNonEmptyString(e['label'])) {
        fail(`${at}.entry must be { kind: ${ENTRY_KINDS.join(' | ')}, label: a non-empty string }`);
      }
    }
    if (typeof file['eulogy'] !== 'string') fail(`${at}.eulogy must be a string`);
  });

  // importedBy names other files, so it is checked once every path is known.
  files.forEach((file: unknown, i) => {
    if (!isRecord(file) || !('importedBy' in file)) return;
    const at = `files[${i}].importedBy`;
    const list = file['importedBy'];
    if (!Array.isArray(list)) return fail(`${at} must be an array`);
    let previous: string | undefined;
    list.forEach((entry: unknown, j) => {
      if (!isRecord(entry) || !isNonEmptyString(entry['path'])) return fail(`${at}[${j}] must be { path, typeOnly? }`);
      const path = entry['path'];
      if (!paths.has(path)) fail(`${at}[${j}]: "${path}" is not a file in the data`);
      if (path === file['path']) fail(`${at}[${j}]: a file can't import itself`);
      if (previous !== undefined && !codePointLess(previous, path)) fail(`${at} must be sorted by path, without repeats`);
      if ('typeOnly' in entry && entry['typeOnly'] !== true) fail(`${at}[${j}].typeOnly must be true when present`);
      previous = path;
    });
  });

  return paths;
}

function checkGhosts(ghosts: unknown, filePaths: Set<string>, fail: Fail): void {
  if (!Array.isArray(ghosts)) return fail('ghosts must be an array');

  const seen = new Set<string>();
  ghosts.forEach((ghost: unknown, i) => {
    const at = `ghosts[${i}]`;
    if (!isRecord(ghost)) return fail(`${at} must be an object`);

    const path = ghost['path'];
    if (!isNonEmptyString(path)) {
      fail(`${at}.path must be a non-empty string`);
    } else {
      if (seen.has(path)) fail(`${at}: duplicate ghost path "${path}"`);
      seen.add(path);
      if (filePaths.has(path)) fail(`${at}: "${path}" is both a current file and a ghost`);
    }

    if (!isSha(ghost['deletedInSha'])) fail(`${at}.deletedInSha must be a full commit SHA`);
    if (!isIsoUtc(ghost['deletedDate'])) fail(`${at}.deletedDate must be an ISO 8601 UTC date`);
    if (typeof ghost['deletedBy'] !== 'string') fail(`${at}.deletedBy must be a string`);
    if (!isSha(ghost['lastExistingSha'])) fail(`${at}.lastExistingSha must be a full commit SHA`);
    if ('eulogy' in ghost && typeof ghost['eulogy'] !== 'string') fail(`${at}.eulogy must be a string when present`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isSha(value: unknown): boolean {
  return typeof value === 'string' && SHA_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** True for strings in exactly the form Date.toISOString() writes, and that are real dates. */
function isIsoUtc(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}
