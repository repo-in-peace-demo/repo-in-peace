import type { Graveyard } from '@shared/graveyard-schema';
import { checkGraveyardData } from '../model/graveyard-load';

/**
 * Fetches one data file and says what came back. The only place the scene makes a network request, and it makes
 * exactly one: for the file it was asked for, from this site. `fetch` is passed in so the failure cases can be
 * tested without a browser or a server.
 */

export type FetchOutcome =
  | { kind: 'ready'; graveyard: Graveyard }
  | { kind: 'error'; title: string; message: string; details: string[] }
  /** The request was cancelled because the page moved on (for example React starting the effect again). Not an error. */
  | { kind: 'aborted' };

const error = (title: string, message: string, details: string[] = []): FetchOutcome => ({ kind: 'error', title, message, details });

const isAbort = (e: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true || (e instanceof Error && e.name === 'AbortError');

/**
 * @param name the graveyard's name, as it appears in messages
 * @param url where to fetch it from
 */
export async function fetchGraveyard(
  name: string,
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<FetchOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, signal === undefined ? undefined : { signal });
  } catch (e) {
    if (isAbort(e, signal)) return { kind: 'aborted' };
    return error('Could not load the graveyard', 'The file could not be fetched. Check your connection and try again.');
  }

  // A development server answers a missing file with its own page and status 200, so a page of HTML counts as missing too.
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 404 || (response.ok && contentType.includes('text/html'))) {
    return error('Graveyard not found', `There is no file graveyards/${name}.graveyard.json on this site.`);
  }
  if (!response.ok) {
    return error('Could not load the graveyard', `The server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''} for graveyards/${name}.graveyard.json.`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (e) {
    if (isAbort(e, signal)) return { kind: 'aborted' };
    return error('Not a JSON file', `graveyards/${name}.graveyard.json could not be read as JSON.`);
  }

  const checked = checkGraveyardData(data);
  if (checked.ok) return { kind: 'ready', graveyard: checked.graveyard };

  const titles = {
    'not-a-graveyard': 'Not a graveyard file',
    'wrong-version': 'Wrong schema version',
    invalid: 'Invalid graveyard file',
  } as const;
  return error(titles[checked.kind], checked.message, checked.details);
}
