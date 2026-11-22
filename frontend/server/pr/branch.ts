/**
 * Branch names for Repo In Peace pull requests (bury-and-resurrect Req 4.2): `rip/<action>/<stem>-<hash8>`. Deterministic, so the
 * same grave always maps to the same branch (which is how a duplicate is found), always a valid git ref name, and different for
 * different paths: the stem is readable, the hash of the exact path keeps `a/b.ts` and `a-b.ts` apart.
 */
import { createHash } from 'node:crypto';
import type { Action } from './request';

/** Every Repo In Peace branch starts with this; the cap and the reset count and close only these. */
export const BRANCH_PREFIX = 'rip/';
const STEM_MAX = 60;

/** The readable part: the path lower-cased, with anything outside `[a-z0-9._-]` (slashes too) as single hyphens, and no dots or hyphens at either end. */
export function branchStem(path: string): string {
  let stem = path
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  stem = stem.slice(0, STEM_MAX).replace(/[.-]+$/, '');
  return stem === '' ? 'file' : stem;
}

/** The first 8 hex characters of SHA-256 of the exact path. */
export const pathHash = (path: string): string => createHash('sha256').update(path, 'utf8').digest('hex').slice(0, 8);

export function branchName(action: Action, path: string): string {
  return `${BRANCH_PREFIX}${action}/${branchStem(path)}-${pathHash(path)}`;
}

/**
 * Git's rules for a branch name (`git check-ref-format --branch`), written out: no component starting with `.` or ending in `.lock`;
 * no `..`; no control characters, space, `~ ^ : ? * [ \`; no leading, trailing or doubled `/`; no trailing `.`; no `@{`; not `@`.
 */
export function isValidRefName(name: string): boolean {
  if (name === '' || name === '@') return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}
