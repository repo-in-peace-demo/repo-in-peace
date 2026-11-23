import type { Graveyard } from '../../../shared/graveyard-schema';

/**
 * --eulogies-from (importers spec, task 8): every grave takes the eulogy of the grave with the same path in an earlier data file of
 * the same repository, files from files and ghosts from ghosts, and the data takes its `meta.eulogyModel`. No model, no cache.
 * A grave the earlier file doesn't have gets "" and is listed in `missing` (files first, then ghosts, each in data order).
 *
 * @param earlier a valid data file that has eulogies (`meta.eulogyModel` set); the caller checks both.
 */
export function copyEulogies(graveyard: Graveyard, earlier: Graveyard): { graveyard: Graveyard; missing: string[] } {
  const fileEulogies = new Map(earlier.files.map((f) => [f.path, f.eulogy]));
  const ghostEulogies = new Map(earlier.ghosts.flatMap((g) => (g.eulogy === undefined ? [] : [[g.path, g.eulogy] as const])));
  const missing: string[] = [];
  const take = (from: Map<string, string>, path: string, what: string): string => {
    const eulogy = from.get(path);
    if (eulogy !== undefined) return eulogy;
    missing.push(`${path} (${what})`);
    return '';
  };
  const files = graveyard.files.map((file) => ({ ...file, eulogy: take(fileEulogies, file.path, 'file') }));
  const ghosts = graveyard.ghosts.map((ghost) => ({ ...ghost, eulogy: take(ghostEulogies, ghost.path, 'ghost') }));
  return {
    graveyard: { ...graveyard, meta: { ...graveyard.meta, eulogyModel: earlier.meta.eulogyModel! }, files, ghosts },
    missing,
  };
}
