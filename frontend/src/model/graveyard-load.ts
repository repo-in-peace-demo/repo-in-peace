import { SCHEMA_VERSION, validateGraveyard, type Graveyard } from '@shared/graveyard-schema';

/**
 * Deciding which data file to load and whether what came back is usable. Pure: the fetch itself
 * is in `ui/useGraveyardLoad.ts`. The scene never draws a partly valid file.
 */

/** The graveyard that loads when the URL names none. It has ghosts, which makes a good first look. */
export const DEFAULT_GRAVEYARD = 'demo.spatialql';

/**
 * The names allowed in `?graveyard=`: 1 to 100 letters, digits, dots, underscores and hyphens.
 * The name comes from the URL, so it is untrusted: it must not be able to name another folder or host.
 * No slash is allowed, so the file always stays inside `graveyards/`.
 */
export const GRAVEYARD_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export type NameResult = { ok: true; name: string } | { ok: false; message: string };

/** @param search the query string of the page address, with or without the leading `?` */
export function parseGraveyardName(search: string): NameResult {
  const requested = new URLSearchParams(search).get('graveyard');
  const name = requested ?? DEFAULT_GRAVEYARD;
  if (GRAVEYARD_NAME_PATTERN.test(name)) return { ok: true, name };

  const shown = name.length > 60 ? `${name.slice(0, 60)}…` : name;
  return {
    ok: false,
    message:
      `The graveyard name "${shown}" is not allowed. ` +
      'Use 1 to 100 letters, digits, dots, underscores or hyphens, for example ?graveyard=demo.spatialql.',
  };
}

/** Where the data file is served from. `baseUrl` is Vite's `import.meta.env.BASE_URL`. */
export function graveyardUrl(name: string, baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}graveyards/${name}.graveyard.json`;
}

export type LoadFailureKind = 'not-a-graveyard' | 'wrong-version' | 'invalid';

export type LoadResult =
  | { ok: true; graveyard: Graveyard }
  | { ok: false; kind: LoadFailureKind; message: string; details: string[] };

/** How many validation errors are shown on screen. */
const MAX_DETAILS = 5;

/**
 * Checks parsed JSON: first that it looks like a graveyard file, then its schema version (so an old
 * file gets the clear version message and not a list of missing fields), and only then the whole structure.
 */
export function checkGraveyardData(value: unknown): LoadResult {
  if (!isRecord(value)) {
    return failure('not-a-graveyard', 'This is not a graveyard file: it is not a JSON object.');
  }
  const meta = value['meta'];
  if (!isRecord(meta)) {
    return failure('not-a-graveyard', 'This is not a graveyard file: it has no "meta" section.');
  }

  const version = meta['schemaVersion'];
  if (version !== SCHEMA_VERSION) {
    return failure(
      'wrong-version',
      `This graveyard file uses schema version ${describeVersion(version)}, but this viewer reads version ${SCHEMA_VERSION}. ` +
        'Make the file again with the current analyser.',
    );
  }

  const validation = validateGraveyard(value);
  if (!validation.ok) {
    const count = validation.errors.length;
    return failure(
      'invalid',
      `This graveyard file is not valid: ${count} ${count === 1 ? 'problem' : 'problems'} found` +
        `${count > MAX_DETAILS ? `, the first ${MAX_DETAILS} are shown` : ''}.`,
      validation.errors.slice(0, MAX_DETAILS),
    );
  }

  // validateGraveyard has checked every field of the schema, so the value has the Graveyard shape.
  return { ok: true, graveyard: value as unknown as Graveyard };
}

function failure(kind: LoadFailureKind, message: string, details: string[] = []): LoadResult {
  return { ok: false, kind, message, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeVersion(version: unknown): string {
  if (typeof version === 'number') return String(version);
  if (typeof version === 'string') return JSON.stringify(version.length > 20 ? `${version.slice(0, 20)}…` : version);
  return '(missing, or not a number)';
}
