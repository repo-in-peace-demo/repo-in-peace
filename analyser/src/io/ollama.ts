import { AnalyserError } from '../errors';
import type { EulogyClient } from '../core/eulogy-run';

/**
 * The Ollama HTTP API, through Node's own fetch (eulogies spec, Req 2, 6.5). The URL has already been checked to name this machine
 * (cli-args `ollamaUrlProblem`).
 */

export const CHECK_TIMEOUT_MS = 5_000;
export const GENERATE_TIMEOUT_MS = 60_000;

/** The generation options: low temperature and a fixed seed, so a re-run gives close to the same words; 120 tokens is ample for 240 characters. */
export const GENERATE_OPTIONS = { temperature: 0.2, seed: 7, num_predict: 120 } as const;

export const notRunningMessage = (url: string): string =>
  `Ollama is not running at ${url}. Start it with \`ollama serve\` (or open the Ollama app), then run the analyser again.`;

const withoutLatest = (name: string): string => name.replace(/:latest$/, '');

/** Checks that Ollama answers at `url` and has `model`, or throws AnalyserError saying what to run. */
export async function checkOllama(url: string, model: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<void> {
  let names: string[];
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
    if (!Array.isArray(body.models)) throw new Error('no models list');
    names = body.models.map((m) => m.name).filter((n): n is string => typeof n === 'string');
  } catch {
    throw new AnalyserError(notRunningMessage(url));
  }
  if (names.some((name) => withoutLatest(name) === withoutLatest(model))) return;
  const installed = names.length === 0 ? 'none' : [...names].sort().join(', ');
  throw new AnalyserError(`The model ${model} is not installed. Install it with \`ollama pull ${model}\`. Installed: ${installed}.`);
}

/** A client for one model. It returns the raw `response` (reasoning blocks and all; cleaning removes them) and throws on any failure. */
export function ollamaClient(url: string, model: string, timeoutMs = GENERATE_TIMEOUT_MS): EulogyClient {
  return {
    async generate({ system, prompt }) {
      const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // think: false asks a reasoning model to leave its reasoning out; servers that don't know the field ignore it.
        body: JSON.stringify({ model, system, prompt, stream: false, think: false, options: GENERATE_OPTIONS }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ollama answered ${response.status}: ${text.slice(0, 200)}`);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error('Ollama answered with something that is not JSON');
      }
      // Only `response` is read; a reasoning field (`thinking`) never is.
      const answer = (body as { response?: unknown } | null)?.response;
      if (typeof answer !== 'string') throw new Error('Ollama answered without a response');
      return answer;
    },
  };
}
