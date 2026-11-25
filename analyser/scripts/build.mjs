// Builds the published package (npm run build, and before npm pack / npm publish): one ESM file, dist/repo-in-peace.js, with a Node
// shebang. The analyser's code and the shared schema are bundled in; TypeScript stays a runtime dependency (it is large, and the
// analyser uses its parser and resolver), and Knip is run as its own executable, found in node_modules. Also copies the licence in.
import { build } from 'esbuild';
import { chmodSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });
await build({
  entryPoints: [`${root}src/bin.ts`],
  outfile: `${root}dist/repo-in-peace.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['typescript', 'knip'],
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'info',
});
chmodSync(`${root}dist/repo-in-peace.js`, 0o755);
copyFileSync(`${root}../LICENSE`, `${root}LICENSE`);
