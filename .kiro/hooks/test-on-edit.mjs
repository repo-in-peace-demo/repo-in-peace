#!/usr/bin/env node
/**
 * postToolUse hook on the write tool: after an edit to a file under frontend/src/model/, analyser/src/core/ or shared/, runs the
 * test files that belong to it (`x.test.ts` and `x.property.test.ts` beside `x.ts`, or the edited test file itself) with that
 * package's Vitest, one run. A pass prints one line; a failure exits 1 with the failing tests on stderr, which Kiro shows.
 * Nothing runs for other files, or when no test file exists.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCHED = [
  { prefix: 'frontend/src/model/', pkg: 'frontend' },
  { prefix: 'analyser/src/core/', pkg: 'analyser' },
  { prefix: 'shared/', pkg: 'shared' },
];

/** The package and the test files (relative to it) that belong to `path` (relative to the repository), or null. */
export function testsFor(path, exists = (p) => existsSync(join(ROOT, p))) {
  const watched = WATCHED.find((w) => path.startsWith(w.prefix));
  if (!watched || !/\.tsx?$/.test(path) || path.includes('/node_modules/')) return null;
  const files = /\.test\.tsx?$/.test(path)
    ? [path]
    : [path.replace(/\.tsx?$/, '.test.ts'), path.replace(/\.tsx?$/, '.property.test.ts')].filter(exists);
  if (files.length === 0) return null;
  return { pkg: watched.pkg, files: files.map((f) => relative(watched.pkg, f)) };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return;
  }
  const raw = event?.tool_input?.path;
  if (typeof raw !== 'string') return;
  const path = relative(ROOT, resolve(event.cwd ?? ROOT, raw));
  const tests = testsFor(path);
  if (tests === null) return;
  const vitest = join(ROOT, tests.pkg, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitest)) return; // not installed: nothing to run
  const run = spawnSync(vitest, ['run', ...tests.files], { cwd: join(ROOT, tests.pkg), encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
  const out = `${run.stdout}${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const summary = out.match(/^\s*Tests\s+.*$/m)?.[0].trim() ?? '(no summary)';
  const what = `${tests.pkg}: vitest run ${tests.files.join(' ')}`;
  if (run.status === 0) {
    process.stdout.write(`test-on-edit: ${what}: ${summary}\n`);
    return;
  }
  const failures = out
    .split('\n')
    .filter((l) => /^\s*(×|FAIL|AssertionError|Error:|Counterexample|Expected|Received|\s+[-+] )/.test(l) && !/without a file extension/.test(l))
    .slice(0, 30)
    .join('\n');
  process.stderr.write(`test-on-edit: ${what} failed: ${summary}\n${failures}\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
