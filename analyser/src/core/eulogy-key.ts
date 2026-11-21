import { createHash } from 'node:crypto';
import { CLEANING_VERSION } from './eulogy-clean';
import type { EulogyInput } from './eulogy-input';
import { PROMPT_VERSION } from './eulogy-prompt';

/**
 * The cache key of a eulogy (eulogies spec, Req 6.4): a SHA-256 of the model's name, the prompt and cleaning versions and the exact input, as
 * canonical JSON (keys sorted at every level), so the same values always give the same key and any change gives another. Pure.
 */

/** JSON with every object's keys sorted, so the order fields were set in never changes the text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** What decides a eulogy's text besides the model and the input: the prompt, and the rules that clean and check the answer. */
export interface EulogyVersions {
  prompt: number;
  cleaning: number;
}
export const EULOGY_VERSIONS: EulogyVersions = { prompt: PROMPT_VERSION, cleaning: CLEANING_VERSION };

export function cacheKey(model: string, versions: EulogyVersions, input: EulogyInput): string {
  return createHash('sha256')
    .update(canonicalJson({ model, promptVersion: versions.prompt, cleaningVersion: versions.cleaning, input }))
    .digest('hex');
}
