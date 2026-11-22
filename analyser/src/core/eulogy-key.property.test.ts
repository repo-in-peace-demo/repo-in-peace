import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EulogyInput } from './eulogy-input';
import { CLEANING_VERSION } from './eulogy-clean';
import { PROMPT_VERSION } from './eulogy-prompt';
import { EULOGY_VERSIONS, cacheKey, canonicalJson, type EulogyVersions } from './eulogy-key';

const contentsArb = fc.oneof(
  fc.record({ text: fc.string({ maxLength: 60 }), cut: fc.boolean(), kind: fc.constant('text' as const) }),
  fc.constant({ text: '', cut: false, kind: 'binary' as const }),
  fc.constant({ text: '', cut: false, kind: 'empty' as const }),
);
const inputArb: fc.Arbitrary<EulogyInput> = fc.oneof(
  fc.record({
    kind: fc.constant('file' as const),
    path: fc.string({ minLength: 1, maxLength: 30 }),
    name: fc.string({ minLength: 1, maxLength: 12 }),
    state: fc.constantFrom('Fresh (under 21 days)', 'Stale (21–45 days)', 'Ancient (over 45 days)'),
    flags: fc.subarray(['Unused (nothing in the project imports it (Knip))', 'Hot (5+ commits in the 30 days before the snapshot)']),
    lines: fc.nat(5000),
    subject: fc.string({ maxLength: 40 }),
    contents: contentsArb,
    decayState: fc.constantFrom('fresh' as const, 'stale' as const, 'ancient' as const),
    unused: fc.boolean(),
    ageDays: fc.nat(2000),
  }),
  fc.record({
    kind: fc.constant('ghost' as const),
    path: fc.string({ minLength: 1, maxLength: 30 }),
    name: fc.string({ minLength: 1, maxLength: 12 }),
    deletedDay: fc.constantFrom('2026-10-12', '2025-01-01'),
    subject: fc.string({ maxLength: 40 }),
    contents: contentsArb,
  }),
);

/** The same value with every object's keys in reverse order. */
const reversed = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reversed);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reversed(v)]));
};

/** Every way to change one field of an input a little. */
function variants(input: EulogyInput): EulogyInput[] {
  const out: EulogyInput[] = [];
  for (const key of Object.keys(input) as Array<keyof EulogyInput>) {
    const v = (input as unknown as Record<string, unknown>)[key];
    if (key === 'kind') continue;
    if (typeof v === 'string') out.push({ ...input, [key]: `${v}x` } as EulogyInput);
    if (typeof v === 'number') out.push({ ...input, [key]: v + 1 } as EulogyInput);
    if (typeof v === 'boolean') out.push({ ...input, [key]: !v } as EulogyInput);
    if (Array.isArray(v)) out.push({ ...input, [key]: [...v, 'extra'] } as EulogyInput);
  }
  const c = input.contents;
  out.push({ ...input, contents: { ...c, text: `${c.text}!` } });
  out.push({ ...input, contents: { ...c, cut: !c.cut } });
  return out;
}

const versionsArb: fc.Arbitrary<EulogyVersions> = fc.record({ prompt: fc.nat(9), cleaning: fc.nat(9) });

describe('P3: the cache key', () => {
  it('uses the current prompt and cleaning versions, so a change to either writes every eulogy again', () => {
    expect(EULOGY_VERSIONS).toEqual({ prompt: PROMPT_VERSION, cleaning: CLEANING_VERSION });
    expect(PROMPT_VERSION).toBe(4);
    expect(CLEANING_VERSION).toBe(5);
  });

  it('is the same for the same model, prompt version and input, whatever order the fields were set in', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), versionsArb, inputArb, (model, version, input) => {
        return cacheKey(model, version, input) === cacheKey(model, version, reversed(input) as EulogyInput) && /^[0-9a-f]{64}$/.test(cacheKey(model, version, input));
      }),
    );
  });

  it('changes when the model, the prompt version, the cleaning version, or any one field of the input (one character of the contents) changes', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), versionsArb, inputArb, (model, version, input) => {
        const key = cacheKey(model, version, input);
        if (cacheKey(`${model}x`, version, input) === key) return false;
        if (cacheKey(model, { ...version, prompt: version.prompt + 1 }, input) === key) return false;
        if (cacheKey(model, { ...version, cleaning: version.cleaning + 1 }, input) === key) return false;
        return variants(input).every((v) => cacheKey(model, version, v) !== key);
      }),
      { numRuns: 300 },
    );
  });

  it('writes canonical JSON: keys sorted at every level, undefined left out', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
