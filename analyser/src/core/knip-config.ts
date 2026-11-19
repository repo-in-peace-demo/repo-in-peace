/**
 * Does the repository carry its own Knip configuration? Pure.
 * Without one, Knip's defaults can flag test files, scripts and tool configs as
 * unused, so the graveyard would mark live files dead. The pipeline warns when this is false.
 */

/** Config file names Knip looks for in the project root. */
export const KNIP_CONFIG_FILES: readonly string[] = [
  'knip.json',
  'knip.jsonc',
  '.knip.json',
  '.knip.jsonc',
  'knip.ts',
  'knip.js',
  'knip.config.ts',
  'knip.config.js',
];

/**
 * @param treePaths every path in the snapshot tree (not only source files)
 * @param packageJsonText contents of the root package.json, if the tree has one
 */
export function hasKnipConfig(treePaths: Iterable<string>, packageJsonText?: string): boolean {
  for (const path of treePaths) {
    if (KNIP_CONFIG_FILES.includes(path)) return true; // root only: workspace configs are not checked
  }
  return packageJsonText !== undefined && packageJsonHasKnipKey(packageJsonText);
}

function packageJsonHasKnipKey(text: string): boolean {
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
    const knip = (json as Record<string, unknown>)['knip'];
    return knip !== undefined && knip !== null;
  } catch {
    return false; // unreadable package.json: treat as no config
  }
}
