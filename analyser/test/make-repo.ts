import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Builds a real git repository in a temp directory from a scripted list of steps.
 * Authors, committer dates and contents are fixed by the script, so the same
 * script always produces the same history. Used by integration and property tests.
 */

export type Op =
  | { op: 'write'; path: string; content: string }
  | { op: 'delete'; path: string }
  | { op: 'rename'; from: string; to: string };

export type Step =
  | { kind: 'commit'; message: string; author: string; date: string; ops: Op[]; allowEmpty?: boolean }
  /** Create a branch at HEAD and switch to it. */
  | { kind: 'branch'; name: string }
  | { kind: 'checkout'; name: string }
  /** Merge a branch into the current one with a merge commit (--no-ff). */
  | { kind: 'merge'; name: string; message: string; author: string; date: string };

export interface BuiltRepo {
  dir: string;
  /** SHA of HEAD after each `commit` and `merge` step, in script order. */
  shas: string[];
  cleanup(): void;
}

const NAME = 'main';

export function makeRepo(steps: Step[]): BuiltRepo {
  const dir = mkdtempSync(join(tmpdir(), 'rip-repo-'));
  const shas: string[] = [];

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  const git = (args: string[], env: NodeJS.ProcessEnv = baseEnv): string =>
    execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const withIdentity = (author: string, date: string): NodeJS.ProcessEnv => ({
    ...baseEnv,
    GIT_AUTHOR_NAME: author,
    GIT_COMMITTER_NAME: author,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });

  try {
    git(['-c', `init.defaultBranch=${NAME}`, 'init', '-q', '.']);

    for (const step of steps) {
      switch (step.kind) {
        case 'commit': {
          for (const op of step.ops) applyOp(dir, op);
          git(['add', '-A']);
          const args = ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', step.message];
          if (step.allowEmpty) args.push('--allow-empty');
          git(args, withIdentity(step.author, step.date));
          shas.push(git(['rev-parse', 'HEAD']).trim());
          break;
        }
        case 'branch':
          git(['checkout', '-q', '-b', step.name]);
          break;
        case 'checkout':
          git(['checkout', '-q', step.name]);
          break;
        case 'merge':
          git(
            ['-c', 'commit.gpgsign=false', 'merge', '-q', '--no-ff', step.name, '-m', step.message],
            withIdentity(step.author, step.date),
          );
          shas.push(git(['rev-parse', 'HEAD']).trim());
          break;
      }
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  return { dir, shas, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function applyOp(dir: string, op: Op): void {
  switch (op.op) {
    case 'write': {
      const target = join(dir, op.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.content);
      break;
    }
    case 'delete':
      rmSync(join(dir, op.path), { force: true });
      break;
    case 'rename': {
      const to = join(dir, op.to);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(join(dir, op.from), to);
      break;
    }
  }
}
