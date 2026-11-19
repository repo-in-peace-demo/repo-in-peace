/**
 * The text on a ghost's toe tag: the type of the deleted file, from the last dot of its name. Pure.
 */

/** The most characters a tag shows; a longer type is cut and ends with an ellipsis. */
export const TAG_MAX_LENGTH = 6;

/** What a tag says for a file without a type (no dot, or only a leading dot as in `.eslintrc`). */
export const TAG_NO_TYPE = '·';

/** `.ts` for `src/surface-placement.ts` and for `src/a.test.ts`, `.tsx` for `x.tsx`, and `·` for `Makefile` or `.gitignore`. */
export function ghostTagText(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return TAG_NO_TYPE;
  const extension = name.slice(dot);
  return extension.length > TAG_MAX_LENGTH ? `${extension.slice(0, TAG_MAX_LENGTH - 1)}…` : extension;
}

/** The distinct tag texts of some ghosts, in order, which are the cells of the tag atlas; a ghost's cell is the index of its text. */
export function tagAtlasTexts(paths: readonly string[]): string[] {
  return [...new Set(paths.map(ghostTagText))].sort();
}
