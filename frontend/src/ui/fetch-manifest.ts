import { MANIFEST_FILE, checkManifest, type Manifest } from '../model/manifest';

/**
 * Loads the demo list (`graveyards/index.json`, written by `vite-plugins/graveyard-manifest.ts`). Resolves to null when it is missing
 * or not a manifest, so the boot screen can still offer a file from disk (interface spec, Req 1.9). Never throws.
 */
export async function fetchManifest(baseUrl: string, signal?: AbortSignal): Promise<Manifest | null> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  try {
    const response = await fetch(`${base}graveyards/${MANIFEST_FILE}`, { signal, cache: 'no-store' });
    if (!response.ok) return null;
    return checkManifest(await response.json());
  } catch {
    return null;
  }
}
