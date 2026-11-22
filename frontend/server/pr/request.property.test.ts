import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PATH_LENGTH, parseRequest } from './request';

const nameArb = fc.stringMatching(/^[A-Za-z0-9._-]{1,30}$/);
const pathArb = fc.string({ minLength: 1, maxLength: 200 });

describe('parseRequest', () => {
  it('accepts a well-formed request and keeps only its three fields, whatever else is sent', () => {
    fc.assert(
      fc.property(nameArb, fc.constantFrom('bury', 'resurrect'), pathArb, fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue()), (graveyard, action, path, extra) => {
        const body = { ...extra, graveyard, action, path };
        expect(parseRequest(body)).toEqual({ graveyard, action, path });
      }),
    );
  });

  it('refuses anything else with a 400 and a message', () => {
    const bad = fc.oneof(
      fc.jsonValue().filter((v) => typeof v !== 'object' || v === null || Array.isArray(v)),
      fc.record({ graveyard: fc.oneof(fc.constant(''), fc.constant('a b'), fc.integer()), action: fc.constant('bury'), path: fc.constant('a.ts') }),
      fc.record({ graveyard: fc.constant('demo.x'), action: fc.string().filter((a) => a !== 'bury' && a !== 'resurrect'), path: fc.constant('a.ts') }),
      fc.record({ graveyard: fc.constant('demo.x'), action: fc.constant('resurrect'), path: fc.oneof(fc.constant(''), fc.constant('x'.repeat(MAX_PATH_LENGTH + 1)), fc.integer(), fc.constant(null)) }),
      fc.record({ graveyard: fc.constant('demo.x'), action: fc.constant('bury') }),
    );
    fc.assert(
      fc.property(bad, (body) => {
        const r = parseRequest(body);
        return 'error' in r && r.status === 400 && r.error.length > 0;
      }),
    );
  });
});
