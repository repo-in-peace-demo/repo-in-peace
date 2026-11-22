import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('P5 (pure part): redaction', () => {
  const tokenArb = fc.oneof(
    fc.stringMatching(/^[A-Za-z0-9_]{20,60}$/).map((s) => `github_pat_${s}`),
    fc.stringMatching(/^[A-Za-z0-9]{30,40}$/).map((s) => `ghp_${s}`),
    fc.string({ minLength: 8, maxLength: 40 }),
  );

  it('leaves no copy of the token, wherever and however often it appears', () => {
    fc.assert(
      fc.property(tokenArb, fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 6 }), (token, pieces) => {
        const text = pieces.join(token);
        const out = redact(`${token}${text}${token}`, [token]);
        return !out.includes(token);
      }),
      { numRuns: 1000 },
    );
  });

  it('removes any GitHub-looking token, configured or not', () => {
    expect(redact('Bad credentials for github_pat_11ABCDEF_xyz123 in request')).toBe('Bad credentials for [redacted] in request');
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz0123 used')).toBe('token [redacted] used');
  });

  it('is the identity on text without the token, and with a token too short to be one', () => {
    fc.assert(fc.property(fc.string(), (t) => redact(t, ['xyz']) === redact(t) && (/github_pat_|gh[pousr]_/.test(t) || redact(t, []) === t)));
  });

  it('ends even when the token is part of the replacement text', () => {
    expect(redact('a redacted b', ['redacted'])).not.toContain('redacted');
    expect(redact('x[redacted]y', ['[redacted]'])).not.toContain('[redacted]');
  });
});
