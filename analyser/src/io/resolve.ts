import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import ts from 'typescript';
import type { Resolution } from '../core/import-graph';

/**
 * Resolving import specifiers (importers spec, Req 2) with TypeScript's own module resolution and each file's nearest tsconfig or
 * jsconfig. The clone's own files are answered from the snapshot commit's tree (an uncommitted change can't alter the graph); only
 * paths under `node_modules` (never tracked) are read from the disk, to tell a package from a missing file.
 */
export interface SnapshotFiles {
  /** Absolute path of the clone. */
  root: string;
  /** Every tracked path at the snapshot. */
  tracked: ReadonlySet<string>;
  /** Tracked tsconfig*.json, jsconfig.json and package.json texts, by path. */
  texts: ReadonlyMap<string, string>;
  /** The analysed files (the graveyard's), by path. */
  analysed: ReadonlySet<string>;
}

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];
const BUILTINS = new Set(builtinModules);
const isBare = (s: string): boolean => !s.startsWith('.') && !s.startsWith('/');
const packageName = (s: string): string => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]!);

export function snapshotResolver(files: SnapshotFiles): (from: string, specifier: string) => Resolution {
  const root = files.root.replace(/\/+$/, '');
  const rel = (abs: string): string | null => {
    const n = posix.normalize(abs);
    if (n === root) return '';
    return n.startsWith(`${root}/`) ? n.slice(root.length + 1) : null;
  };
  const inNodeModules = (r: string): boolean => r === 'node_modules' || r.startsWith('node_modules/') || r.includes('/node_modules/') || r.endsWith('/node_modules');
  const trackedDirs = new Set<string>(['']);
  for (const p of files.tracked) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/'));
  }

  const host: ts.ModuleResolutionHost & ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: (abs) => {
      const r = rel(abs);
      if (r === null || inNodeModules(r)) return existsSync(abs) && statSync(abs).isFile();
      return files.tracked.has(r);
    },
    directoryExists: (abs) => {
      const r = rel(abs);
      if (r === null || inNodeModules(r)) return existsSync(abs) && statSync(abs).isDirectory();
      return trackedDirs.has(r);
    },
    readFile: (abs) => {
      const r = rel(abs);
      if (r === null || inNodeModules(r)) return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined;
      return files.texts.get(r);
    },
    realpath: (p) => p,
    getCurrentDirectory: () => root,
    readDirectory: () => [], // only the compiler options are wanted, never the list of files
  };

  // The nearest config above a folder, parsed once each.
  const configOf = new Map<string, { options: ts.CompilerOptions; cache: ts.ModuleResolutionCache }>();
  const nearest = new Map<string, string | null>();
  const configPathFor = (dir: string): string | null => {
    if (nearest.has(dir)) return nearest.get(dir)!;
    let found: string | null = null;
    for (const name of CONFIG_NAMES) {
      const candidate = dir === '' ? name : `${dir}/${name}`;
      if (files.tracked.has(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === null && dir !== '') found = configPathFor(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
    nearest.set(dir, found);
    return found;
  };
  const DEFAULTS: ts.CompilerOptions = { allowJs: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: false };
  const optionsFor = (configPath: string | null): { options: ts.CompilerOptions; cache: ts.ModuleResolutionCache } => {
    const key = configPath ?? '';
    let entry = configOf.get(key);
    if (entry) return entry;
    let options: ts.CompilerOptions = { ...DEFAULTS };
    if (configPath !== null) {
      const abs = posix.join(root, configPath);
      const read = ts.readConfigFile(abs, (p) => host.readFile(p));
      if (read.config) {
        const parsed = ts.parseJsonConfigFileContent(read.config, host, posix.dirname(abs), undefined, abs);
        options = { ...parsed.options, allowJs: true };
        if (options.moduleResolution === undefined) options.moduleResolution = ts.ModuleResolutionKind.Bundler;
      }
    }
    entry = { options, cache: ts.createModuleResolutionCache(root, (s) => s, options) };
    configOf.set(key, entry);
    return entry;
  };

  return (from, specifier) => {
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const { options, cache } = optionsFor(configPathFor(dir));
    const result = ts.resolveModuleName(specifier, posix.join(root, from), options, host, cache).resolvedModule;
    if (result) {
      const r = rel(result.resolvedFileName);
      if (r === null || inNodeModules(r) || result.isExternalLibraryImport) return { ignored: 'package' };
      if (files.analysed.has(r)) return { to: r };
      return { ignored: 'outside' };
    }
    if (isBare(specifier)) {
      // Not resolved, and bare: a package if one of that name is installed above the file, else missing (an alias that didn't match).
      const name = packageName(specifier);
      for (let d = dir; ; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
        if (existsSync(posix.join(root, d, 'node_modules', name))) return { ignored: 'package' };
        if (d === '') break;
      }
      if (specifier.startsWith('node:') || BUILTINS.has(name)) return { ignored: 'package' }; // Node's own modules
    }
    // A relative import TypeScript can't resolve that names a tracked file (a stylesheet, an image, JSON without resolveJsonModule):
    // the file exists, it just isn't one the graveyard shows.
    if (specifier.startsWith('.')) {
      const target = posix.normalize(posix.join(dir, specifier));
      if (!target.startsWith('../') && files.tracked.has(target)) return { ignored: 'outside' };
    }
    return { ignored: 'missing' };
  };
}
