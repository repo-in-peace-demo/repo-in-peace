/**
 * Command-line arguments. Pure: the clock is passed in, so tests need no real time.
 *
 *   analyse <repo-path> [--out <file>] [--analysed-at <ISO timestamp>] [--knip-config <file>] [--knip-dir <folder>]...
 */
import { parseArgs } from 'node:util';
import { normaliseKnipDir } from './core/knip-dirs';

export interface CliOptions {
  repoPath: string;
  outPath?: string;
  /** ISO 8601 UTC. */
  analysedAt: string;
  knipConfigPath?: string;
  /** Folders to run Knip in, normalised, "" for the clone root. Absent: the clone root. */
  knipDirs?: string[];
}

export type ParsedArgs =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help' }
  | { kind: 'usage-error'; message: string };

export const USAGE = `Usage: analyse <repo-path> [options]

Reads a local git clone of a JavaScript/TypeScript repository and writes one
graveyard data file (JSON).

Arguments:
  <repo-path>               Root of a full (not shallow) git clone, with its
                            dependencies installed so Knip can resolve imports.

Options:
  --out <file>              Output file. Default: <repo-name>.graveyard.json in the
                            current directory. Must be outside the clone.
  --analysed-at <timestamp> Analysis time, ISO 8601 with Z or an offset
                            (for example 2026-03-01T12:00:00Z). Default: now.
                            Fix it to get byte-identical output across runs.
  --knip-config <file>      Knip configuration to use instead of the clone's own.
  --knip-dir <folder>       Run Knip in this folder of the clone instead of the clone
                            root, for repositories whose JS/TS lives in a subfolder
                            (it needs a package.json). Repeat for several folders.
  -h, --help                Show this help.
`;

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** @returns the timestamp as ISO 8601 UTC, or undefined when it is not a full ISO timestamp with a zone. */
export function normaliseAnalysedAt(value: string): string | undefined {
  if (!ISO_WITH_ZONE.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** @param now called only when --analysed-at is absent, and then once. */
export function parseCliArgs(argv: readonly string[], now: () => string): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        'analysed-at': { type: 'string' },
        'knip-config': { type: 'string' },
        'knip-dir': { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    return { kind: 'usage-error', message: (error as Error).message };
  }

  const { values, positionals } = parsed;
  if (values.help === true) return { kind: 'help' };

  if (positionals.length !== 1 || positionals[0] === undefined || positionals[0] === '') {
    return { kind: 'usage-error', message: 'Give exactly one argument: the path to a git clone.' };
  }

  let analysedAt: string;
  if (values['analysed-at'] === undefined) {
    analysedAt = now();
  } else {
    const normalised = normaliseAnalysedAt(values['analysed-at']);
    if (normalised === undefined) {
      return {
        kind: 'usage-error',
        message: `--analysed-at must be an ISO 8601 timestamp with Z or an offset, like 2026-03-01T12:00:00Z (got "${values['analysed-at']}").`,
      };
    }
    analysedAt = normalised;
  }

  let knipDirs: string[] | undefined;
  if (values['knip-dir'] !== undefined) {
    knipDirs = [];
    for (const raw of values['knip-dir']) {
      const dir = normaliseKnipDir(raw);
      if (dir === undefined) {
        return {
          kind: 'usage-error',
          message: `--knip-dir must be a folder inside the clone, like "app" or "packages/web" (got "${raw}").`,
        };
      }
      if (!knipDirs.includes(dir)) knipDirs.push(dir);
    }
  }

  const options: CliOptions = { repoPath: positionals[0], analysedAt };
  if (knipDirs !== undefined) options.knipDirs = knipDirs;
  if (values.out !== undefined) options.outPath = values.out;
  if (values['knip-config'] !== undefined) options.knipConfigPath = values['knip-config'];
  return { kind: 'run', options };
}
