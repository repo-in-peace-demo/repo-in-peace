/**
 * The one request the browser may send (bury-and-resurrect Req 5.1): a demo name, an action and a path. Everything else in the body is
 * ignored. Pure.
 */
import { GRAVEYARD_NAME_PATTERN } from '../../src/model/graveyard-load.js';

export type Action = 'bury' | 'resurrect';
export const ACTIONS: readonly Action[] = ['bury', 'resurrect'];

export interface PrRequest {
  graveyard: string;
  action: Action;
  path: string;
}

export const MAX_PATH_LENGTH = 1024;
/** The most bytes a request body may have. */
export const MAX_BODY_BYTES = 2048;

export type Parsed = PrRequest | { error: string; status: 400 };

export function parseRequest(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'The request must be a JSON object.', status: 400 };
  const { graveyard, action, path } = body as Record<string, unknown>;
  if (typeof graveyard !== 'string' || !GRAVEYARD_NAME_PATTERN.test(graveyard)) return { error: 'The request needs a graveyard name.', status: 400 };
  if (action !== 'bury' && action !== 'resurrect') return { error: 'The action must be "bury" or "resurrect".', status: 400 };
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    return { error: `The request needs a path of 1 to ${MAX_PATH_LENGTH} characters.`, status: 400 };
  }
  // A fresh object with the three fields only: nothing else the browser sent is carried further.
  return { graveyard, action, path };
}
