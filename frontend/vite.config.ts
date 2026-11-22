import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { graveyardManifest } from './vite-plugins/graveyard-manifest';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react(), graveyardManifest()],
  resolve: {
    // The schema and validator live once in shared/ and are used by the analyser and by this app.
    alias: { '@shared': sharedDir },
  },
  server: {
    // The dev server must be allowed to read shared/, which is outside this folder.
    fs: { allow: [repoRoot] },
  },
  test: {
    // The logic under test is pure, so it runs in Node, not in a browser.
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
