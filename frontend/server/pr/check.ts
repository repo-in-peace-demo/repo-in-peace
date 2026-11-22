/**
 * The check against the demo's own data file (bury-and-resurrect Req 5.2): the server decides what may be buried or resurrected from
 * the graveyard it holds, never from what the browser says. Pure.
 */
import type { FileEntry, Ghost, Graveyard } from '../../../shared/graveyard-schema.js';
import type { Action } from './request.js';

export type Eligible = { action: 'bury'; file: FileEntry } | { action: 'resurrect'; ghost: Ghost };
export type Refusal = { error: string; status: 404 | 409 };

/**
 * Bury only a current file that is unused (the panel's `buryOffered` is the same rule: `file.unused`); Resurrect only a ghost. A path
 * in neither list is 404; a path in the other list is 409.
 */
export function checkAgainstGraveyard(graveyard: Graveyard, action: Action, path: string): Eligible | Refusal {
  const file = graveyard.files.find((f) => f.path === path);
  const ghost = graveyard.ghosts.find((g) => g.path === path);
  if (file === undefined && ghost === undefined) return { error: `${path} is not in this graveyard.`, status: 404 };
  if (action === 'bury') {
    if (file === undefined) return { error: `${path} is a deleted file; it can be resurrected, not buried.`, status: 409 };
    if (!file.unused) return { error: `Only unused files can be buried; ${path} is used.`, status: 409 };
    return { action: 'bury', file };
  }
  if (ghost === undefined) return { error: `Only deleted files can be resurrected; ${path} is still in the repository.`, status: 409 };
  return { action: 'resurrect', ghost };
}
