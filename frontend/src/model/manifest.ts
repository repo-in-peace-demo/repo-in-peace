import { GRAVEYARD_NAME_PATTERN, checkGraveyardData } from './graveyard-load';
import { compareCodePoint } from './sort';

/**
 * The list of demo graveyards the boot screen offers (interface spec, Req 1.2). The browser cannot list a folder, so a Vite plugin
 * (`vite-plugins/graveyard-manifest.ts`) reads `public/graveyards/` and serves or writes `graveyards/index.json` from this. Pure.
 */

export const GRAVEYARD_SUFFIX = '.graveyard.json';
export const MANIFEST_FILE = 'index.json';

export interface ManifestEntry {
  /** The file name without `.graveyard.json`: what `?graveyard=` takes. */
  name: string;
  /** The repository's name, from the file's `meta.name`. */
  repo: string;
  files: number;
  ghosts: number;
}

export interface Manifest {
  version: 1;
  /** Sorted by name, in code-point order. */
  graveyards: ManifestEntry[];
}

/**
 * The manifest of a folder's files. Each `json` is the parsed content of the file (or anything else when it was not JSON). A
 * `*.graveyard.json` that is not a valid version-2 graveyard is left out and named in `skipped`, so the plugin can warn; any other
 * file name (and `index.json` itself) is ignored silently. A name is used only when it is a valid `?graveyard=` name.
 */
export function buildManifest(entries: ReadonlyArray<{ fileName: string; json: unknown }>): { manifest: Manifest; skipped: string[] } {
  const graveyards: ManifestEntry[] = [];
  const skipped: string[] = [];
  for (const { fileName, json } of entries) {
    if (fileName === MANIFEST_FILE || !fileName.endsWith(GRAVEYARD_SUFFIX)) continue;
    const name = fileName.slice(0, -GRAVEYARD_SUFFIX.length);
    const checked = checkGraveyardData(json);
    if (!GRAVEYARD_NAME_PATTERN.test(name) || !checked.ok) {
      skipped.push(fileName);
      continue;
    }
    const g = checked.graveyard;
    graveyards.push({ name, repo: g.meta.name, files: g.files.length, ghosts: g.ghosts.length });
  }
  graveyards.sort((a, b) => compareCodePoint(a.name, b.name));
  skipped.sort(compareCodePoint);
  return { manifest: { version: 1, graveyards }, skipped };
}

/** The manifest the boot screen fetched, checked, or null when it is not one (the boot screen then says the demo list is missing). */
export function checkManifest(value: unknown): Manifest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v['version'] !== 1 || !Array.isArray(v['graveyards'])) return null;
  const graveyards: ManifestEntry[] = [];
  for (const e of v['graveyards'] as unknown[]) {
    if (typeof e !== 'object' || e === null) return null;
    const r = e as Record<string, unknown>;
    const { name, repo, files, ghosts } = r;
    if (typeof name !== 'string' || !GRAVEYARD_NAME_PATTERN.test(name) || typeof repo !== 'string' || repo.length === 0) return null;
    if (!Number.isInteger(files) || (files as number) < 0 || !Number.isInteger(ghosts) || (ghosts as number) < 0) return null;
    graveyards.push({ name, repo, files: files as number, ghosts: ghosts as number });
  }
  return { version: 1, graveyards };
}
