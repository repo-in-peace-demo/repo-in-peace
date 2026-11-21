import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from './write-output';

/**
 * The eulogy cache file (eulogies spec, Req 6.4): `{ version: 1, entries: { <cache key>: { eulogy, model, at } } }`. One file serves
 * every repository and model; the key already says which.
 */

export interface CacheEntry {
  eulogy: string;
  model: string;
  /** The run's analysedAt, never the clock. */
  at: string;
}
export type CacheEntries = Map<string, CacheEntry>;

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const isEntry = (value: unknown): value is CacheEntry => {
  const v = value as Partial<CacheEntry> | null;
  return typeof v === 'object' && v !== null && typeof v.eulogy === 'string' && typeof v.model === 'string' && typeof v.at === 'string';
};

/** A missing file is an empty cache; an unreadable or malformed one is reported through `log` and treated as empty. */
export async function readEulogyCache(path: string, log: (message: string) => void): Promise<CacheEntries> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    log(`The eulogy cache at ${path} could not be read; starting a new one.`);
    return new Map();
  }
  try {
    const file = JSON.parse(text) as Partial<CacheFile> | null;
    if (file?.version !== 1 || typeof file.entries !== 'object' || file.entries === null || Array.isArray(file.entries)) throw new Error();
    const entries: CacheEntries = new Map();
    for (const [key, entry] of Object.entries(file.entries)) {
      if (!isEntry(entry)) throw new Error();
      if (entry.eulogy !== '') entries.set(key, entry);
    }
    return entries;
  } catch {
    log(`The eulogy cache at ${path} could not be read; starting a new one.`);
    return new Map();
  }
}

/** Writes every non-empty entry, keys sorted so the file changes only where the cache did. Atomic: a failed write leaves the old file. */
export async function writeEulogyCache(path: string, entries: CacheEntries): Promise<void> {
  const file: CacheFile = { version: 1, entries: {} };
  for (const key of [...entries.keys()].sort()) {
    const entry = entries.get(key)!;
    if (entry.eulogy !== '') file.entries[key] = { eulogy: entry.eulogy, model: entry.model, at: entry.at };
  }
  await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** The key-to-eulogy view the run reads. */
export const eulogiesOf = (entries: CacheEntries): Map<string, string> => new Map([...entries].map(([key, e]) => [key, e.eulogy]));
