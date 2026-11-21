/**
 * Command-line arguments. Pure: the clock is passed in, so tests need no real time.
 *
 *   analyse <repo-path> [--out <file>] [--analysed-at <ISO timestamp>] [--knip-config <file>] [--knip-dir <folder>]...
 *           [--stale-after <days>] [--ancient-after <days>] [--hot-commits <n>] [--hot-window <days>]
 *           [--eulogies --eulogy-model <name> [--ollama-url <url>] [--eulogy-concurrency <n>] [--eulogy-cache <file>]]
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Thresholds } from '../../shared/graveyard-schema';
import { normaliseKnipDir } from './core/knip-dirs';
import { parseThresholdFlags } from './core/thresholds';

export interface CliOptions {
  repoPath: string;
  outPath?: string;
  /** ISO 8601 UTC. */
  analysedAt: string;
  knipConfigPath?: string;
  /** Folders to run Knip in, normalised, "" for the clone root. Absent: the clone root. */
  knipDirs?: string[];
  /** Decay thresholds. Absent when no threshold flag was given: the defaults apply. */
  thresholds?: Thresholds;
  /** Eulogies by a local model. Absent without --eulogies: the output is then exactly what it was without them. */
  eulogies?: EulogyOptions;
}

export interface EulogyOptions {
  model: string;
  ollamaUrl: string;
  /** Requests at a time, 1 to 4. */
  concurrency: number;
  /** Absolute for the default; as given (relative to the current folder) for --eulogy-cache. */
  cachePath: string;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_EULOGY_CONCURRENCY = 2;
/** In the analyser's own folder, whatever folder the command runs in (this file is analyser/src/cli-args.ts). */
export const DEFAULT_EULOGY_CACHE = fileURLToPath(new URL('../.cache/eulogies.json', import.meta.url));
/** The only hosts an Ollama URL may name: eulogies never leave this machine (Req 1.4). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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

Decay thresholds (the defaults are what the demo uses):
  --stale-after <days>      A file is fresh below this many days since its last
                            commit, stale from here on. Default 90.
  --ancient-after <days>    A file is ancient after this many days. Must be greater
                            than --stale-after. Default 360.
  --hot-commits <n>         A file is hot with this many commits in the hot window
                            or more. Default 5.
  --hot-window <days>       Length of the hot window before the snapshot. Default 30.

Eulogies (a short epitaph for every grave, written by a model on this machine):
  --eulogies                Write a eulogy for every grave with a local model
                            (Ollama). Only commit subjects and file contents are
                            sent, and only to this machine. See the README.
  --eulogy-model <name>     The Ollama model, for example qwen2.5:7b. Needed with
                            --eulogies.
  --ollama-url <url>        The Ollama server on this machine (localhost,
                            127.0.0.1 or [::1]). Default ${DEFAULT_OLLAMA_URL}.
  --eulogy-concurrency <n>  Requests at a time, 1 to 4. Default ${DEFAULT_EULOGY_CONCURRENCY}.
  --eulogy-cache <file>     The cache of eulogies, so a second run asks the model
                            only about what changed. Default
                            analyser/.cache/eulogies.json. Must be outside the clone.

  -h, --help                Show this help.
`;

const NUMBER_FLAGS = new Set(['--stale-after', '--ancient-after', '--hot-commits', '--hot-window']);

/**
 * Node's parser reads `--hot-commits -1` as a flag followed by another option, and fails with a
 * vague message. Joining them as `--hot-commits=-1` lets our own check say the value must be positive.
 */
function joinNegativeNumbers(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (NUMBER_FLAGS.has(arg) && next !== undefined && /^-\d/.test(next)) {
      out.push(`${arg}=${next}`);
      i++;
    } else {
      out.push(arg);
    }
  }
  return out;
}

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
      args: joinNegativeNumbers(argv),
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        'analysed-at': { type: 'string' },
        'knip-config': { type: 'string' },
        'knip-dir': { type: 'string', multiple: true },
        'stale-after': { type: 'string' },
        'ancient-after': { type: 'string' },
        'hot-commits': { type: 'string' },
        'hot-window': { type: 'string' },
        eulogies: { type: 'boolean' },
        'eulogy-model': { type: 'string' },
        'ollama-url': { type: 'string' },
        'eulogy-concurrency': { type: 'string' },
        'eulogy-cache': { type: 'string' },
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

  const thresholdFlags = {
    staleAfter: values['stale-after'],
    ancientAfter: values['ancient-after'],
    hotCommits: values['hot-commits'],
    hotWindow: values['hot-window'],
  };
  let thresholds: Thresholds | undefined;
  if (Object.values(thresholdFlags).some((value) => value !== undefined)) {
    const result = parseThresholdFlags(thresholdFlags);
    if (!result.ok) return { kind: 'usage-error', message: result.message };
    thresholds = result.thresholds;
  }

  const eulogies = parseEulogyFlags(values);
  if (eulogies !== undefined && 'message' in eulogies) return { kind: 'usage-error', message: eulogies.message };

  const options: CliOptions = { repoPath: positionals[0], analysedAt };
  if (eulogies !== undefined) options.eulogies = eulogies;
  if (thresholds !== undefined) options.thresholds = thresholds;
  if (knipDirs !== undefined) options.knipDirs = knipDirs;
  if (values.out !== undefined) options.outPath = values.out;
  if (values['knip-config'] !== undefined) options.knipConfigPath = values['knip-config'];
  return { kind: 'run', options };
}

/**
 * Ollama runs a model whose tag is `cloud` or ends in `-cloud` (`gemma4:cloud`, `gpt-oss:120b-cloud`) on its own servers, even through a
 * local URL, so such a model would send contents off this machine (Req 1.4).
 */
export const isCloudModel = (model: string): boolean => /(?::|-)cloud$/i.test(model.trim());

/** @returns undefined when Ollama may be used at this URL, or what is wrong with it. */
export function ollamaUrlProblem(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `--ollama-url must be a URL like ${DEFAULT_OLLAMA_URL} (got "${raw}").`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `--ollama-url must start with http:// or https:// (got "${raw}").`;
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return (
      `--ollama-url must name this machine (localhost, 127.0.0.1 or [::1]), so file contents never leave it (got "${raw}"). ` +
      'Run Ollama locally, or forward its port to this machine.'
    );
  }
  return undefined;
}

type EulogyFlagValues = {
  eulogies?: boolean;
  'eulogy-model'?: string;
  'ollama-url'?: string;
  'eulogy-concurrency'?: string;
  'eulogy-cache'?: string;
};

function parseEulogyFlags(values: EulogyFlagValues): EulogyOptions | { message: string } | undefined {
  if (values.eulogies !== true) {
    const stray = (['eulogy-model', 'ollama-url', 'eulogy-concurrency', 'eulogy-cache'] as const).filter((f) => values[f] !== undefined);
    if (stray.length > 0) return { message: `${stray.map((f) => `--${f}`).join(', ')} only work${stray.length === 1 ? 's' : ''} with --eulogies. Add --eulogies, or leave ${stray.length === 1 ? 'it' : 'them'} out.` };
    return undefined;
  }
  const model = values['eulogy-model']?.trim() ?? '';
  if (model === '') {
    return { message: 'Choose a model with --eulogy-model, for example qwen2.5:7b (see the README); install it with ollama pull <name>.' };
  }
  if (isCloudModel(model)) {
    return {
      message: `--eulogy-model ${model} is an Ollama cloud model: it runs on Ollama's servers, so file contents would leave this machine. Choose a model that runs locally (see the README).`,
    };
  }
  const ollamaUrl = values['ollama-url'] ?? DEFAULT_OLLAMA_URL;
  const urlProblem = ollamaUrlProblem(ollamaUrl);
  if (urlProblem !== undefined) return { message: urlProblem };

  let concurrency = DEFAULT_EULOGY_CONCURRENCY;
  const rawConcurrency = values['eulogy-concurrency'];
  if (rawConcurrency !== undefined) {
    if (!/^[1-4]$/.test(rawConcurrency.trim())) return { message: `--eulogy-concurrency must be a whole number from 1 to 4 (got "${rawConcurrency}").` };
    concurrency = Number(rawConcurrency.trim());
  }

  const cachePath = values['eulogy-cache'] ?? DEFAULT_EULOGY_CACHE;
  if (cachePath === '') return { message: '--eulogy-cache needs a file path.' };
  return { model, ollamaUrl: ollamaUrl.replace(/\/+$/, ''), concurrency, cachePath };
}
