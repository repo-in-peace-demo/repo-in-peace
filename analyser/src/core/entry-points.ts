/**
 * Entry points (importers spec, Req 3): files a framework or tool loads rather than imports. Pure: a path, and what the clone's
 * `index.html` files and `package.json` files name, in; a kind and a short label out. Rules in order: the first that matches wins.
 */
export type EntryKind = 'framework' | 'config' | 'test' | 'package';
export interface EntryPoint {
  kind: EntryKind;
  label: string;
}
export interface EntryContext {
  /** Clone paths named by `<script type="module" src>` in an index.html. */
  htmlScripts: ReadonlySet<string>;
  /** Clone paths named by `main` or `bin` in a package.json. */
  packageEntries: ReadonlySet<string>;
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
/** The name without its extension(s): `page.tsx` → `page`, `vite.config.ts` → `vite.config`. */
const stemOf = (path: string): string => baseOf(path).replace(/\.(?:[cm]?[jt]sx?)$/i, '');
const segments = (path: string): string[] => path.split('/').slice(0, -1);

const NEXT_APP: Record<string, string> = {
  page: 'Next.js page',
  layout: 'Next.js layout',
  template: 'Next.js template',
  route: 'Next.js route',
  loading: 'Next.js loading',
  error: 'Next.js error',
  'global-error': 'Next.js error',
  'not-found': 'Next.js not-found',
  default: 'Next.js default',
};

const CONFIG_LABELS: Array<[RegExp, string]> = [
  [/^vite\.config$/, 'Vite config'],
  [/^vitest\.config$/, 'Vitest config'],
  [/^next\.config$/, 'Next.js config'],
  [/^tailwind\.config$/, 'Tailwind config'],
  [/^postcss\.config$/, 'PostCSS config'],
  [/^drizzle\.config$/, 'Drizzle config'],
  [/^playwright\.config$/, 'Playwright config'],
  [/^eslint\.config$/, 'ESLint config'],
];

export function entryPointOf(path: string, context: EntryContext): EntryPoint | undefined {
  const base = baseOf(path);
  const stem = stemOf(path);
  const dirs = segments(path);

  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(base) || dirs.includes('__tests__')) return { kind: 'test', label: 'test' };

  // Next.js: the App Router (a file under a folder named `app`), the Pages Router, middleware at a project root or in `src/`.
  const appAt = dirs.lastIndexOf('app');
  if (appAt >= 0 && NEXT_APP[stem] !== undefined && !dirs.slice(appAt + 1).some((d) => d === 'components' || d === 'lib')) return { kind: 'framework', label: NEXT_APP[stem]! };
  const pagesAt = dirs.indexOf('pages');
  if (pagesAt >= 0 && !dirs.slice(pagesAt + 1).some((d) => d === 'components' || d === 'lib')) {
    return { kind: 'framework', label: dirs[pagesAt + 1] === 'api' ? 'Next.js API route' : 'Next.js page' };
  }
  // At the clone root, a project folder's root (one level down, as with --knip-dir app), or that root's `src/`.
  if (stem === 'middleware' && (dirs.length <= 1 || (dirs.length <= 2 && dirs[dirs.length - 1] === 'src'))) return { kind: 'framework', label: 'Next.js middleware' };

  if (context.htmlScripts.has(path)) return { kind: 'framework', label: 'Vite entry' };
  if (context.packageEntries.has(path)) return { kind: 'package', label: 'package entry' };

  for (const [pattern, label] of CONFIG_LABELS) if (pattern.test(stem)) return { kind: 'config', label };
  if (/\.config$/.test(stem) || /^\.(eslintrc|prettierrc|babelrc|lintstagedrc)$/.test(stem)) return { kind: 'config', label: 'config' };
  return undefined;
}

/** A path from `ref` as written in a file in `folder` (a leading `/` meaning the folder itself, as Vite reads index.html). */
export function joinPath(folder: string, ref: string): string | undefined {
  const parts = [...(folder === '' ? [] : folder.split('/'))];
  for (const p of ref.replace(/^\.?\//, '').replace(/[?#].*$/, '').split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(p);
  }
  return parts.length === 0 ? undefined : parts.join('/');
}

/** The module scripts an index.html at `path` names, as clone paths. */
export function htmlScriptsOf(path: string, html: string): string[] {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\btype\s*=\s*["']?module["']?/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src || /^[a-z]+:\/\//i.test(src)) continue;
    const p = joinPath(folder, src);
    if (p) out.push(p);
  }
  return out;
}

/** The files a package.json at `path` names as `main` or `bin` (a string, or an object of names to files). */
export function packageEntriesOf(path: string, json: string): string[] {
  let value: { main?: unknown; bin?: unknown };
  try {
    value = JSON.parse(json) as { main?: unknown; bin?: unknown };
  } catch {
    return [];
  }
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const refs = [value.main, ...(typeof value.bin === 'string' ? [value.bin] : value.bin && typeof value.bin === 'object' ? Object.values(value.bin) : [])];
  return refs.flatMap((r) => (typeof r === 'string' ? [joinPath(folder, r)].filter((p): p is string => p !== undefined) : []));
}
