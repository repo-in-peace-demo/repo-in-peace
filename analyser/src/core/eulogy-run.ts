import { AnalyserError } from '../errors';
import { cleanEulogy } from './eulogy-clean';
import type { EulogyInput } from './eulogy-input';
import { cacheKey } from './eulogy-key';
import { buildPrompt, PROMPT_VERSION } from './eulogy-prompt';
import type { People } from './history';

/**
 * Writing every grave's eulogy (eulogies spec, Req 6.1 to 6.3b): the cache first, then the model through a fixed pool of workers, with
 * one retry on a rejected answer, and the rules for when to stop. No I/O of its own: the client, the cache and the log come in.
 */

/** Something that sends one prompt to the model and returns its raw answer; it throws when the request fails. */
export interface EulogyClient {
  generate(request: { system: string; prompt: string }): Promise<string>;
}

export interface EulogyJob {
  path: string;
  input: EulogyInput;
}

export interface RunResult {
  /** Every job's path, with its eulogy, or "" when it has none. */
  eulogies: Map<string, string>;
  written: number;
  cached: number;
  empty: Array<{ path: string; reason: string }>;
  stoppedEarly: boolean;
}

export interface RunDeps {
  client: EulogyClient;
  /** Cache key to eulogy. Read only: new eulogies go to `onNew`. */
  cache: ReadonlyMap<string, string>;
  model: string;
  concurrency: number;
  people: People;
  log: (message: string) => void;
  /** Called for each new eulogy once the model check has passed, so a run that fails the check keeps nothing. */
  onNew?: (key: string, eulogy: string) => void;
  /** The clock for the progress line; tests pass their own. */
  now?: () => number;
}

/** Request errors in a row, with no answer between them, after which the run stops taking jobs. */
export const ERRORS_IN_A_ROW = 5;
/** The answered jobs (in path order) the model check looks at. */
export const MODEL_CHECK_ANSWERS = 8;
const PROGRESS_EVERY_MS = 1000;

/** How one job ended. `answered` jobs count for the model check; cache hits and failed requests don't. */
type Outcome =
  | { kind: 'cached'; eulogy: string }
  | { kind: 'written'; eulogy: string; key: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'failed'; reason: string; timedOut: boolean }
  | { kind: 'not run' };

export const modelMessage = (model: string): string =>
  `The model ${model} wrote no usable eulogy in its first ${MODEL_CHECK_ANSWERS} answers (they quoted code, named authors, or broke the format). Try another model, see the README.`;

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timed? ?out/i.test(error.message));
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runEulogies(jobs: ReadonlyArray<EulogyJob>, deps: RunDeps): Promise<RunResult> {
  const sorted = [...jobs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const outcomes: Array<Outcome | undefined> = sorted.map(() => undefined);
  const now = deps.now ?? Date.now;
  const concurrency = Math.max(1, Math.floor(deps.concurrency));

  let next = 0;
  let done = 0;
  let cachedSoFar = 0;
  let errorsInARow = 0;
  let stoppedEarly = false;
  /** undefined while the check is open, 'passed' once it is decided, 'failed' when the model failed it. */
  let check: 'passed' | 'failed' | undefined;
  const held: Array<{ key: string; eulogy: string }> = [];
  let lastProgress = now();

  /** The model check, in path order so it never depends on which request finished first. */
  const decideCheck = (): void => {
    if (check !== undefined) return;
    let answered = 0;
    for (const outcome of outcomes) {
      if (outcome === undefined) return; // an earlier job is still running: not decided yet
      if (outcome.kind === 'written') {
        check = 'passed';
        break;
      }
      if (outcome.kind === 'rejected' && ++answered === MODEL_CHECK_ANSWERS) {
        check = 'failed';
        return;
      }
    }
    if (check === undefined && outcomes.every((o) => o !== undefined)) check = 'passed'; // fewer than 8 answers in the whole run
    if (check === 'passed') for (const { key, eulogy } of held.splice(0)) deps.onNew?.(key, eulogy);
  };

  const keep = (key: string, eulogy: string): void => {
    if (check === 'passed') deps.onNew?.(key, eulogy);
    else held.push({ key, eulogy });
  };

  const runOne = async (job: EulogyJob): Promise<Outcome> => {
    const key = cacheKey(deps.model, PROMPT_VERSION, job.input);
    const hit = deps.cache.get(key);
    if (hit !== undefined && hit !== '') return { kind: 'cached', eulogy: hit };
    let lastReason = '';
    for (const retry of [false, true]) {
      let raw: string;
      try {
        raw = await deps.client.generate(buildPrompt(job.input, retry));
      } catch (error) {
        errorsInARow++;
        return { kind: 'failed', reason: messageOf(error), timedOut: isTimeout(error) };
      }
      errorsInARow = 0;
      const cleaned = cleanEulogy(raw, { people: deps.people });
      if (cleaned.ok) {
        keep(key, cleaned.text);
        return { kind: 'written', eulogy: cleaned.text, key };
      }
      lastReason = cleaned.reason;
    }
    return { kind: 'rejected', reason: lastReason };
  };

  const progress = (): void => {
    const at = now();
    if (at - lastProgress < PROGRESS_EVERY_MS) return;
    lastProgress = at;
    deps.log(`Eulogies: ${done}/${sorted.length} (${cachedSoFar} from the cache)`);
  };

  const worker = async (): Promise<void> => {
    while (next < sorted.length && check !== 'failed' && !stoppedEarly) {
      const index = next++;
      const outcome = await runOne(sorted[index]!);
      outcomes[index] = outcome;
      done++;
      if (outcome.kind === 'cached') cachedSoFar++;
      if (errorsInARow >= ERRORS_IN_A_ROW && !stoppedEarly) {
        stoppedEarly = true;
        const written = outcomes.filter((o) => o?.kind === 'written').length;
        deps.log(`Ollama stopped answering after ${written} eulogies; the rest are left empty.`);
      }
      decideCheck();
      progress();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, sorted.length)) }, worker));

  for (let i = 0; i < outcomes.length; i++) if (outcomes[i] === undefined) outcomes[i] = { kind: 'not run' };
  decideCheck();
  if (check === 'failed') throw new AnalyserError(modelMessage(deps.model));

  const result: RunResult = { eulogies: new Map(), written: 0, cached: 0, empty: [], stoppedEarly };
  let rejected = 0;
  let timedOut = 0;
  let failed = 0;
  let notRun = 0;
  sorted.forEach((job, i) => {
    const outcome = outcomes[i]!;
    switch (outcome.kind) {
      case 'cached':
        result.cached++;
        result.eulogies.set(job.path, outcome.eulogy);
        return;
      case 'written':
        result.written++;
        result.eulogies.set(job.path, outcome.eulogy);
        return;
      case 'rejected':
        rejected++;
        result.empty.push({ path: job.path, reason: `rejected twice (${outcome.reason})` });
        break;
      case 'failed':
        if (outcome.timedOut) timedOut++;
        else failed++;
        result.empty.push({ path: job.path, reason: outcome.timedOut ? 'timed out' : `request failed: ${outcome.reason}` });
        break;
      case 'not run':
        notRun++;
        result.empty.push({ path: job.path, reason: 'not run (Ollama stopped answering)' });
        break;
    }
    result.eulogies.set(job.path, '');
  });

  const parts = [
    rejected > 0 ? `${rejected} rejected twice` : '',
    timedOut > 0 ? `${timedOut} timed out` : '',
    failed > 0 ? `${failed} failed` : '',
    notRun > 0 ? `${notRun} not run` : '',
  ].filter((p) => p !== '');
  deps.log(
    `Eulogies: ${result.written} written, ${result.cached} from the cache, ${result.empty.length} left empty` +
      (parts.length > 0 ? ` (${parts.join(', ')}).` : '.'),
  );
  return result;
}
