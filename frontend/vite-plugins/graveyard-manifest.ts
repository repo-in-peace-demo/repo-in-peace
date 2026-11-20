import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { GRAVEYARD_SUFFIX, MANIFEST_FILE, buildManifest } from '../src/model/manifest';

/**
 * Writes `graveyards/index.json`, the list of demo graveyards the boot screen offers (interface spec, Req 1.2), from the files in
 * `public/graveyards/`. The browser cannot list a folder, and nobody has to keep a list by hand: in the dev server a request for
 * the file reads the folder each time (a file dropped in shows on the next load), and a build emits it once. Nothing is written into
 * `public/`. The analyser knows nothing of this. A graveyard file that is not a valid version-2 file is left out, with a warning.
 */
export function graveyardManifest(): Plugin {
  let folder = '';
  let base = '/';

  const make = (warn: (message: string) => void): string => {
    const names = readdirSync(folder).filter((name) => name.endsWith(GRAVEYARD_SUFFIX));
    const entries = names.map((fileName) => {
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(join(folder, fileName), 'utf8'));
      } catch {
        json = undefined; // not JSON: skipped and named in the warning
      }
      return { fileName, json };
    });
    const { manifest, skipped } = buildManifest(entries);
    if (skipped.length > 0) warn(`graveyard manifest: left out (not valid version-2 graveyard files): ${skipped.join(', ')}`);
    return `${JSON.stringify(manifest, null, 2)}\n`;
  };

  return {
    name: 'repo-in-peace:graveyard-manifest',
    configResolved(config) {
      folder = join(config.publicDir, 'graveyards');
      base = config.base;
    },
    configureServer(server) {
      const path = `${base.endsWith('/') ? base : `${base}/`}graveyards/${MANIFEST_FILE}`;
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || req.url?.split('?')[0] !== path) return next();
        try {
          const body = make((message) => server.config.logger.warn(message));
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: `graveyards/${MANIFEST_FILE}`, source: make((message) => this.warn(message)) });
    },
  };
}
