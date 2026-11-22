import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Graveyard } from '@shared/graveyard-schema';
import { NOT_UNDERSTOOD, PR_NOTES, UNREACHABLE, availability, fetchPrConfig, openPr, parseConfigAnswer, safePrLink } from './pr-client';

const REPO = 'repo-in-peace-demo/oikos_ledger';
const config = { available: true as const, demos: { 'demo.oikosledger': { repo: REPO, base: 'main' } }, fake: false };

describe('P8: the only links the page opens', () => {
  it('accepts the expected fork\'s pull request URLs, in any letter case of owner and name', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999_999 }), fc.boolean(), (n, upper) => {
        const repo = upper ? REPO.toUpperCase() : REPO;
        const url = `https://github.com/${repo}/pull/${n}`;
        return safePrLink(url, REPO, false) === url;
      }),
    );
    expect(safePrLink('/api/fake-pr/3', REPO, true)).toBe('/api/fake-pr/3');
  });

  it('refuses everything else: random strings, other hosts and repos, other schemes, look-alikes and extras', () => {
    const tricks = fc.constantFrom(
      `http://github.com/${REPO}/pull/1`,
      `https://github.com.evil.example/${REPO}/pull/1`,
      `https://evil.example/github.com/${REPO}/pull/1`,
      `https://github.com@evil.example/${REPO}/pull/1`,
      `https://github.com/${REPO}/pull/1?x=1`,
      `https://github.com/${REPO}/pull/1#x`,
      `https://github.com/${REPO}/pull/1/files`,
      `https://github.com/${REPO}/pull/0`,
      `https://github.com/${REPO}/pull/01`,
      `https://github.com/${REPO}/issues/1`,
      `https://github.com/other/oikos_ledger/pull/1`,
      `https://github.com/repo-in-peace-demo/spatialql/pull/1`,
      `https://github.com/${REPO}/../x/pull/1`,
      `javascript:alert(1)//https://github.com/${REPO}/pull/1`,
      `  https://github.com/${REPO}/pull/1`,
      `https://GITHUB.COM/${REPO}/pull/1`,
      '/api/fake-pr/1',
      '/api/fake-pr/1/../../x',
      '//github.com/x',
    );
    fc.assert(fc.property(fc.oneof(tricks, fc.string(), fc.webUrl()), (url) => safePrLink(url, REPO, false) === null || url === `https://github.com/${REPO}/pull/${url.split('/').at(-1)}`));
    fc.assert(fc.property(tricks, (url) => safePrLink(url, REPO, false) === null));
    for (const v of [undefined, null, 1, {}, ['https://github.com']]) expect(safePrLink(v, REPO, true)).toBeNull();
    expect(safePrLink('/api/fake-pr/x', REPO, true)).toBeNull();
  });
});

describe('availability', () => {
  const local = { kind: 'local' as const, fileName: 'mine.graveyard.json', graveyard: {} as Graveyard };
  it('is available only for a configured demo loaded by its name', () => {
    expect(availability({ kind: 'demo', name: 'demo.oikosledger' }, config)).toEqual({ kind: 'available', repo: REPO, fake: false });
    expect(availability({ kind: 'demo', name: 'demo.spatialql' }, config)).toEqual({ kind: 'not-configured' });
    expect(availability(local, config)).toEqual({ kind: 'local-file' });
    expect(availability({ kind: 'made', files: 100 }, config)).toEqual({ kind: 'local-file' });
    expect(availability({ kind: 'demo', name: 'demo.oikosledger' }, { available: false })).toEqual({ kind: 'unavailable' });
    expect(availability({ kind: 'demo', name: 'demo.oikosledger' }, 'unreachable')).toEqual({ kind: 'unavailable' });
  });

  it('has the notes of the requirements', () => {
    expect(PR_NOTES['local-file']).toBe('Pull requests are only available on the demo graveyards.');
    expect(PR_NOTES['not-configured']).toBe('Pull requests are only available on the demo graveyards.');
    expect(PR_NOTES.unavailable).toBe("Pull requests aren't available right now.");
  });

  it('treats a malformed configuration answer as unreachable', () => {
    for (const v of [null, [], 'x', { available: 'yes' }, { available: true }, { available: true, demos: [], fake: false }, { available: true, demos: { d: { repo: 'no slash', base: 'main' } }, fake: false }]) {
      expect(parseConfigAnswer(v)).toBe('unreachable');
    }
    expect(parseConfigAnswer({ available: false, extra: 1 })).toEqual({ available: false });
    expect(parseConfigAnswer(config)).toEqual(config);
  });
});

const answer = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchPrConfig and openPr', () => {
  it('fetch the configuration, and count any failure as unreachable', async () => {
    expect(await fetchPrConfig(answer(200, config) as typeof fetch)).toEqual(config);
    expect(await fetchPrConfig(answer(500, { error: 'x' }) as typeof fetch)).toBe('unreachable');
    expect(await fetchPrConfig((async () => { throw new TypeError('offline'); }) as typeof fetch)).toBe('unreachable');
  });

  it('sends only the demo, the action and the path, and reads an opened pull request', async () => {
    let sent: RequestInit | undefined;
    const f = (async (_url: string, init: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ number: 12, url: `https://github.com/${REPO}/pull/12`, repo: REPO, existing: true }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await openPr('demo.oikosledger', 'bury', 'a.ts', { repo: REPO, fake: false }, f)).toEqual({ kind: 'opened', number: 12, url: `https://github.com/${REPO}/pull/12`, existing: true, fake: false });
    expect(JSON.parse(String(sent!.body))).toEqual({ graveyard: 'demo.oikosledger', action: 'bury', path: 'a.ts' });
    expect(sent!.method).toBe('POST');
  });

  it('keeps the number but drops a link to anywhere else', async () => {
    const r = await openPr('d', 'bury', 'a.ts', { repo: REPO, fake: false }, answer(201, { number: 3, url: 'https://evil.example/pull/3' }) as typeof fetch);
    expect(r).toEqual({ kind: 'opened', number: 3, url: null, existing: false, fake: false });
  });

  it('gives the server\'s message as text, or a friendly one', async () => {
    const opts = { repo: REPO, fake: false };
    expect(await openPr('d', 'bury', 'a', opts, answer(409, { error: 'Only unused files can be buried; a is used.' }) as typeof fetch)).toEqual({ kind: 'error', message: 'Only unused files can be buried; a is used.' });
    expect(await openPr('d', 'bury', 'a', opts, answer(429, { error: 'Too many pull requests from here; try again in 40 seconds.' }) as typeof fetch)).toMatchObject({ message: expect.stringContaining('40 seconds') });
    expect(await openPr('d', 'bury', 'a', opts, (async () => { throw new TypeError('offline'); }) as typeof fetch)).toEqual({ kind: 'error', message: UNREACHABLE });
    expect(await openPr('d', 'bury', 'a', opts, answer(502, '<html>Bad gateway</html>') as typeof fetch)).toEqual({ kind: 'error', message: UNREACHABLE });
    expect(await openPr('d', 'bury', 'a', opts, answer(200, { number: 'x' }) as typeof fetch)).toEqual({ kind: 'error', message: NOT_UNDERSTOOD });
    expect(await openPr('d', 'bury', 'a', opts, answer(400, { error: 'x'.repeat(1000) }) as typeof fetch)).toMatchObject({ message: 'x'.repeat(300) });
  });
});
