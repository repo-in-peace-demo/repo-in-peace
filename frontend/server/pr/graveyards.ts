/**
 * The demo graveyards, read on the server (bury-and-resurrect Req 5.2, Decision 2): `public/graveyards/<name>.graveyard.json`, bundled
 * with the function by vercel.json's includeFiles. Read once per instance per demo, and validated with the shared schema check.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateGraveyard, type Graveyard } from '../../../shared/graveyard-schema.js';
import { GRAVEYARD_NAME_PATTERN } from '../../src/model/graveyard-load.js';

const SUFFIX = '.graveyard.json';

export class GraveyardUnavailable extends Error {
  constructor(readonly graveyard: string, why: string) {
    super(`demo graveyard ${graveyard}: ${why}`);
    this.name = 'GraveyardUnavailable';
  }
}

export function graveyardReader(root: string = process.cwd()): { read: (name: string) => Promise<Graveyard>; list: () => Promise<string[]> } {
  const folder = join(root, 'public', 'graveyards');
  const cache = new Map<string, Promise<Graveyard>>();
  const load = async (name: string): Promise<Graveyard> => {
    if (!GRAVEYARD_NAME_PATTERN.test(name)) throw new GraveyardUnavailable(name, 'not a graveyard name');
    let text: string;
    try {
      text = await readFile(join(folder, `${name}${SUFFIX}`), 'utf8');
    } catch {
      throw new GraveyardUnavailable(name, 'no data file');
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new GraveyardUnavailable(name, 'the data file is not JSON');
    }
    const check = validateGraveyard(value);
    if (!check.ok) throw new GraveyardUnavailable(name, `the data file is invalid (${check.errors.slice(0, 3).join('; ')})`);
    return value as Graveyard;
  };
  return {
    read: (name) => {
      let p = cache.get(name);
      if (!p) {
        p = load(name);
        cache.set(name, p);
        p.catch(() => cache.delete(name)); // a failed read is tried again next time
      }
      return p;
    },
    list: async () =>
      (await readdir(folder).catch(() => []))
        .filter((f) => f.endsWith(SUFFIX))
        .map((f) => f.slice(0, -SUFFIX.length))
        .filter((n) => GRAVEYARD_NAME_PATTERN.test(n))
        .sort(),
  };
}
