import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { People } from './history';
import { SOMEONE, handleOf, mentionsPerson, personPattern, personWords, redact } from './redact';

const people = (names: string[], emails: string[] = []): People => ({ names: new Set(names), emails: new Set(emails) });

describe('redacting the people of the repository', () => {
  it('replaces names, e-mails and handles, in any case', () => {
    const p = people(['Ann Author', 'Bob'], ['alice@example.com', '12345+carol@users.noreply.github.com']);
    expect(redact('Merge PR #4 from alice/fix', p)).toBe('Merge PR #4 from someone/fix');
    expect(redact('fix by BOB and ann author', p)).toBe('fix by someone and someone');
    expect(redact('thanks carol', p)).toBe('thanks someone');
    expect(redact('mail stranger@elsewhere.org', p)).toBe('mail someone');
    expect(redact('bobsled the cache', p)).toBe('bobsled the cache'); // a whole word only
  });

  it('knows a handle from an e-mail, and ignores numbers and service names', () => {
    expect(handleOf('alice@example.com')).toBe('alice');
    expect(handleOf('12345+carol@users.noreply.github.com')).toBe('carol');
    expect(handleOf('noreply@github.com')).toBeNull();
    expect(handleOf('12345@x.org')).toBeNull();
    expect(personWords(people(['A'], []))).toEqual([]); // one letter is not a person
  });

  const nameArb = fc.stringMatching(/^[A-Za-z][a-z]{1,9}( [A-Z][a-z]{1,9})?$/).filter((n) => n.toLowerCase() !== SOMEONE && !SOMEONE.includes(n.toLowerCase()));

  it('P7: for any people and any text that mentions them, in any case, no name or e-mail survives', () => {
    fc.assert(
      fc.property(fc.uniqueArray(nameArb, { minLength: 1, maxLength: 4 }), fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 6 }), fc.boolean(), (names, filler, upper) => {
        const emails = names.map((n) => `${n.split(' ')[0]!.toLowerCase()}x@example.com`);
        const p = people(names, emails);
        const mentions = [...names.map((n) => (upper ? n.toUpperCase() : n.toLowerCase())), ...emails];
        const text = [...filler, ...mentions, ...filler].join(' ');
        const out = redact(text, p);
        const pattern = personPattern(personWords(p))!;
        return !pattern.test(out) && !/@/.test(out) && !mentionsPerson(out, p);
      }),
      { numRuns: 300 },
    );
  });

  it('leaves a text that mentions nobody as it is', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 10 }), (words) => {
        const text = words.join(' ');
        return redact(text, people(['Zyxwvu'])) === text;
      }),
    );
  });
});
