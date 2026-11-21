import { createHash } from 'node:crypto';
import type { EulogyInput } from './eulogy-input';

/**
 * The cache key of a eulogy (eulogies spec, Req 6.4): a SHA-256 of the model's name, the prompt version and the exact input, as
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

export function cacheKey(model: string, promptVersion: number, input: EulogyInput): string {
  return createHash('sha256').update(canonicalJson({ model, promptVersion, input })).digest('hex');
}
