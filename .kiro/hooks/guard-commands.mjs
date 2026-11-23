#!/usr/bin/env node
/**
 * preToolUse hook on the shell tool: blocks commands that break the working agreement (.kiro/steering/tech.md): the full test
 * suites, installs, builds and deploys are the human's to run. Single test files (Vitest or Playwright) and the typecheck are allowed.
 * Exit 2 blocks the command and returns the message on stderr to the agent; exit 0 lets it run.
 */

/** Options that take a value, so the word after them is not a file. */
const VALUE_FLAGS = new Set([
  '-t', '--testNamePattern', '--reporter', '--seed', '--project', '--config', '-c', '--root', '--dir', '--pool', '--maxWorkers',
  '-g', '--grep', '--grep-invert', '--workers', '-j', '--repeat-each', '--retries', '--timeout', '--shard', '--output',
]);
/** A "file argument" that is really a whole tree is still the full suite. */
const WHOLE_TREES = new Set(['.', './', 'src', 'src/', 'test', 'test/', 'e2e', 'e2e/', 'server', 'server/', 'tests', 'tests/']);

const words = (part) => (part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''));

/** Whether the words after a test runner name at least one file (or a folder below the top level). */
function namesAFile(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    if (!WHOLE_TREES.has(a)) return true;
  }
  return false;
}

/** Strips `VAR=value` prefixes, `npx`, and `timeout N`, so `FOO=1 npx vitest run` reads as `vitest run`. */
function core(ws) {
  let i = 0;
  while (i < ws.length && /^[A-Z_][A-Z0-9_]*=/.test(ws[i])) i++;
  if (ws[i] === 'timeout') i += 2;
  if (ws[i] === 'npx' || ws[i] === 'pnpm' && ws[i + 1] === 'exec') i += ws[i] === 'npx' ? 1 : 2;
  return ws.slice(i);
}

/** @returns why the command breaks the working agreement, or null when it may run. */
export function blockedReason(command) {
  const parts = command.split(/&&|\|\||;|\||\n/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const ws = core(words(part));
    const [a, b, c] = ws;
    if (a === undefined) continue;
    const npmRun = (a === 'npm' || a === 'pnpm' || a === 'yarn') && b === 'run' ? c : (a === 'npm' || a === 'pnpm' || a === 'yarn') ? b : undefined;
    // Installs.
    if ((a === 'npm' || a === 'pnpm' || a === 'yarn') && ['install', 'i', 'ci', 'add', 'uninstall', 'remove', 'update', 'upgrade'].includes(b ?? '')) return 'installs';
    if (a === 'yarn' && b === undefined) return 'installs';
    if (a === 'brew' || a === 'pip' || a === 'pip3') return 'installs';
    if (a === 'playwright' && b === 'install') return 'installs';
    // Deploys and publishing.
    if (a === 'vercel' || a === 'netlify') return 'deploys';
    if ((a === 'npm' || a === 'pnpm' || a === 'yarn') && b === 'publish') return 'deploys';
    if (a === 'git' && b === 'push') return 'deploys';
    // Builds (the typecheck, tsc --noEmit, is allowed).
    if (npmRun === 'build' || npmRun === 'preview' || (a === 'vite' && b === 'build')) return 'builds';
    if (a === 'tsc' && !ws.includes('--noEmit')) return 'builds';
    // The full suites: npm test, npm run e2e, and the runners with no file.
    if (npmRun === 'test' || npmRun === 't') {
      const rest = ws.slice(ws.indexOf(npmRun) + 1);
      if (!namesAFile(rest)) return 'the full test suite';
    }
    if (npmRun === 'e2e' || npmRun === 'e2e:quick') {
      if (!namesAFile(ws.slice(ws.indexOf(npmRun) + 1))) return 'the full end-to-end suite';
    }
    if (a === 'vitest') {
      const rest = ['run', 'watch', 'related'].includes(b ?? '') ? ws.slice(2) : ws.slice(1);
      if (!namesAFile(rest)) return 'the full test suite';
    }
    if (a === 'playwright' && b === 'test' && !namesAFile(ws.slice(2))) return 'the full end-to-end suite';
  }
  return null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0); // not a hook event: let it run
  }
  const command = event?.tool_input?.command;
  if (typeof command !== 'string') process.exit(0);
  const reason = blockedReason(command);
  if (reason === null) process.exit(0);
  process.stderr.write(
    `Blocked by the guard-commands hook: this runs ${reason}, which the working agreement (.kiro/steering/tech.md) leaves to the human. ` +
      `Don't run it. Give the user the exact command to run instead, and say what it will verify. ` +
      `Allowed: the typecheck (tsc --noEmit, npm run typecheck) and single test files (npx vitest run <file>, npx playwright test <spec>).\n` +
      `Command: ${command}\n`,
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
