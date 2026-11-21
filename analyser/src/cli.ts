import { pathToFileURL } from 'node:url';
import { USAGE, parseCliArgs } from './cli-args';
import { AnalyserError } from './errors';
import { defaultDeps, runPipeline, type PipelineDeps } from './pipeline';

/**
 * Command-line entry point. This is the only place the clock is read.
 *
 * Exit codes: 0 success; 1 the analysis failed for a reason the user can act on
 * (message only, no stack trace) or an unexpected error (with stack); 2 usage error.
 * Progress goes to stderr and stdout stays empty, so the tool composes with other commands.
 */

export interface CliEnv {
  stderr: (text: string) => void;
  cwd: string;
  /** ISO 8601 UTC "now". Called only when --analysed-at is not given. */
  now: () => string;
}

export async function main(
  argv: readonly string[],
  env: CliEnv,
  deps: Pick<PipelineDeps, 'runKnip' | 'eulogyClient' | 'checkOllama'> = defaultDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, env.now);

  if (parsed.kind === 'help') {
    env.stderr(USAGE);
    return 0;
  }
  if (parsed.kind === 'usage-error') {
    env.stderr(`Error: ${parsed.message}\n\n${USAGE}`);
    return 2;
  }

  try {
    const { outPath, graveyard } = await runPipeline(
      { ...parsed.options, cwd: env.cwd },
      { ...deps, log: (message) => env.stderr(`${message}\n`) },
    );
    env.stderr(
      `Wrote ${outPath}: ${graveyard.files.length} files, ${graveyard.ghosts.length} ghosts, ${graveyard.folders.length} folders\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof AnalyserError) {
      env.stderr(`Error: ${error.message}\n`);
    } else {
      env.stderr(`Unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
    return 1;
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2), {
    stderr: (text) => void process.stderr.write(text),
    cwd: process.cwd(),
    now: () => new Date().toISOString(),
  }).then((code) => {
    process.exitCode = code;
  });
}
