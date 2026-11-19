/**
 * Which paths count as source files, and how lines of code are counted.
 * Pure: no file or git access. Used for current files and for ghosts, so the
 * graveyard never shows a ghost for a file type or folder it would not show alive.
 */

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'] as const;
const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'] as const;

/**
 * Directory names that are skipped at any depth, even when git tracks them.
 * Matching is on a whole directory segment, so `distance/` is fine but both
 * `packages/a/dist/` and a hand-written `src/build/` are excluded.
 */
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
]);

/** True for repo-relative, forward-slash paths of JS/TS source files that should appear in the graveyard. */
export function isTrackedSourcePath(path: string): boolean {
  if (path === '') return false;

  const segments = path.split('/');
  const fileName = segments[segments.length - 1] ?? '';
  const directories = segments.slice(0, -1);

  if (directories.some((dir) => EXCLUDED_DIRECTORIES.has(dir))) return false;
  if (!SOURCE_EXTENSIONS.some((ext) => fileName.endsWith(ext))) return false;
  if (DECLARATION_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) return false;
  return true;
}

/**
 * Lines of code: lines that contain at least one non-whitespace character.
 * Content is read as UTF-8. A carriage return counts as whitespace, so CRLF
 * and LF files give the same answer.
 */
export function countNonBlankLines(content: Uint8Array): number {
  if (content.length === 0) return 0;
  const text = new TextDecoder('utf-8').decode(content);
  let count = 0;
  for (const line of text.split('\n')) {
    if (/\S/.test(line)) count++;
  }
  return count;
}
