#!/usr/bin/env node
/**
 * agentSpawn hook: what the agent should know at the start of a session, printed to stdout (which Kiro adds to the context): the
 * branch, `git status --short`, the last 5 commit subjects, and the unticked tasks of the active spec (the spec whose tasks.md was
 * committed or changed most recently and still has an unticked task).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trimEnd();
  } catch {
    return '';
  }
};

/** The unticked tasks of a tasks.md: the "- [ ]" lines, with their indentation, first line only. */
export const untickedOf = (text) =>
  text
    .split('\n')
    .filter((l) => /^\s*- \[ \]/.test(l))
    .map((l) => l.replace(/\s+$/, ''));

function activeSpec() {
  const dir = join(ROOT, '.kiro', 'specs');
  if (!existsSync(dir)) return null;
  const specs = readdirSync(dir)
    .map((name) => ({ name, file: join(dir, name, 'tasks.md') }))
    .filter((s) => existsSync(s.file))
    .map((s) => {
      const committed = Number(git('log', '-1', '--format=%ct', '--', s.file)) || 0;
      const changed = git('status', '--porcelain', '--', s.file) !== '' ? statSync(s.file).mtimeMs / 1000 : 0;
      return { ...s, when: Math.max(committed, changed), unticked: untickedOf(readFileSync(s.file, 'utf8')) };
    })
    .filter((s) => s.unticked.length > 0)
    .sort((a, b) => b.when - a.when);
  return specs[0] ?? null;
}

const lines = [];
lines.push(`Branch: ${git('branch', '--show-current') || '(detached)'}`);
const status = git('status', '--short');
lines.push(`git status --short:${status === '' ? ' clean' : `\n${status}`}`);
lines.push(`Last 5 commits:\n${git('log', '-5', '--format=  %h %s')}`);
const spec = activeSpec();
lines.push(spec === null ? 'Active spec: none (every tasks.md is fully ticked).' : `Active spec: ${spec.name} (.kiro/specs/${spec.name}/tasks.md), unticked:\n${spec.unticked.slice(0, 25).join('\n')}`);
process.stdout.write(`${lines.join('\n')}\n`);
