#!/usr/bin/env node
/**
 * postToolUse hook on the write tool: when the edited file is a graveyard data file (frontend/public/graveyards/) or the schema
 * (shared/graveyard-schema*), validates both demo files against the schema (data-check.ts, run with the analyser's tsx). Silent for
 * any other file.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const watches = (path) => path.startsWith('frontend/public/graveyards/') || /^shared\/graveyard-schema[^/]*$/.test(path);

let input = '';
for await (const chunk of process.stdin) input += chunk;
let event = null;
try {
  event = JSON.parse(input);
} catch {
  // not a hook event
}
const raw = event?.tool_input?.path;
if (typeof raw === 'string' && watches(relative(ROOT, resolve(event.cwd ?? ROOT, raw)))) {
  const tsx = join(ROOT, 'analyser', 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) {
    process.stderr.write('data-check: analyser/node_modules is not installed, so the demo files were not checked.\n');
    process.exit(1);
  }
  const run = spawnSync(tsx, [join(ROOT, '.kiro', 'hooks', 'data-check.ts')], { encoding: 'utf8' });
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  process.exit(run.status ?? 1);
}
