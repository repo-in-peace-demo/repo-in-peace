import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { graveyardFrom } from '../../test/make-graveyard';
import { fetchGraveyard, type FetchOutcome } from './fetch-graveyard';

const URL_OF_FILE = '/graveyards/demo.spatialql.graveyard.json';

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

/** A fetch that answers with `response` once and remembers how it was called. */
const answering = (response: Response | (() => Promise<Response>)) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => (typeof response === 'function' ? response() : response));

const run = (fetchImpl: typeof fetch, signal?: AbortSignal): Promise<FetchOutcome> =>
  fetchGraveyard('demo.spatialql', URL_OF_FILE, signal, fetchImpl);

const errorOf = (outcome: FetchOutcome) => {
  if (outcome.kind !== 'error') throw new Error(`expected an error, got ${outcome.kind}`);
  return outcome;
};

describe('fetchGraveyard', () => {
  it('returns the graveyard when the file is good', async () => {
    const g = graveyardFrom({ files: ['src/a.ts'] });
    const outcome = await run(answering(json(g)));
    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') expect(outcome.graveyard).toEqual(g);
  });

  it('makes exactly one request, for the address it was given', async () => {
    const fetchImpl = answering(json(graveyardFrom({})));
    await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(URL_OF_FILE);
  });

  it('passes the abort signal on, so the request can be cancelled', async () => {
    const controller = new AbortController();
    const fetchImpl = answering(json(graveyardFrom({})));
    await run(fetchImpl, controller.signal);
    expect(fetchImpl.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });

  it('reads the real test files', async () => {
    for (const name of ['demo.oikosledger', 'demo.spatialql']) {
      const path = fileURLToPath(new URL(`../../public/graveyards/${name}.graveyard.json`, import.meta.url));
      const outcome = await fetchGraveyard(name, `/graveyards/${name}.graveyard.json`, undefined, answering(json(readFileSync(path, 'utf8'))));
      expect(outcome.kind).toBe('ready');
    }
  });

  describe('when the file is missing', () => {
    it('says not found for a 404, naming the file', async () => {
      const e = errorOf(await run(answering(new Response('nope', { status: 404, statusText: 'Not Found' }))));
      expect(e.title).toBe('Graveyard not found');
      expect(e.message).toContain('graveyards/demo.spatialql.graveyard.json');
    });

    it('says not found when a development server answers a missing file with its own page', async () => {
      const page = new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      expect(errorOf(await run(answering(page))).title).toBe('Graveyard not found');
    });
  });

  describe('when the server or the network fails', () => {
    it('says what the server answered', async () => {
      const e = errorOf(await run(answering(new Response('', { status: 500, statusText: 'Internal Server Error' }))));
      expect(e.title).toBe('Could not load the graveyard');
      expect(e.message).toContain('500 Internal Server Error');
    });

    it('copes with a server that sends no status text', async () => {
      const e = errorOf(await run(answering(new Response('', { status: 503 }))));
      expect(e.message).toContain('503');
    });

    it('says the file could not be fetched when the request fails', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      const e = errorOf(await run(fetchImpl as unknown as typeof fetch));
      expect(e.title).toBe('Could not load the graveyard');
      expect(e.message).toContain('Check your connection');
    });
  });

  describe('when the request is cancelled', () => {
    it('is not an error when the fetch rejects with an abort', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      });
      expect(await run(fetchImpl as unknown as typeof fetch)).toEqual({ kind: 'aborted' });
    });

    it('is not an error when the signal is already aborted, whatever the fetch says', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchImpl = vi.fn(async () => {
        throw new Error('something else');
      });
      expect(await run(fetchImpl as unknown as typeof fetch, controller.signal)).toEqual({ kind: 'aborted' });
    });

    it('is not an error when the body is cut off by the abort', async () => {
      const controller = new AbortController();
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => {
          controller.abort();
          throw new DOMException('aborted', 'AbortError');
        },
      } as unknown as Response;
      expect(await run(answering(response), controller.signal)).toEqual({ kind: 'aborted' });
    });
  });

  describe('when the file is not a good graveyard', () => {
    it('says it is not JSON', async () => {
      const e = errorOf(await run(answering(json('this is not json {'))));
      expect(e.title).toBe('Not a JSON file');
      expect(e.message).toContain('demo.spatialql.graveyard.json');
    });

    it('says it is not a graveyard file when it is JSON of another kind', async () => {
      for (const body of [[], 42, 'text', null, {}, { meta: 5 }]) {
        expect(errorOf(await run(answering(json(JSON.stringify(body))))).title).toBe('Not a graveyard file');
      }
    });

    it('names both schema versions for an old file, and tells the user to make it again', async () => {
      const old = { ...graveyardFrom({ files: ['a.ts'] }), meta: { ...graveyardFrom({}).meta, schemaVersion: 1 } };
      const e = errorOf(await run(answering(json(old))));
      expect(e.title).toBe('Wrong schema version');
      expect(e.message).toContain('schema version 1');
      expect(e.message).toContain('reads version 2');
      expect(e.message).toContain('current analyser');
    });

    it('lists the first problems of an invalid file, at most five, and says how many there are', async () => {
      const g = graveyardFrom({ files: Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`) });
      const broken = { ...g, files: g.files.map((f) => ({ ...f, decayScore: 7 })) };
      const e = errorOf(await run(answering(json(broken))));
      expect(e.title).toBe('Invalid graveyard file');
      expect(e.details).toHaveLength(5);
      expect(e.message).toContain('12 problems found');
    });
  });

  it('puts nothing but plain text in its messages: a name with markup is shown as it is', async () => {
    const e = errorOf(await fetchGraveyard('<b>x</b>', '/graveyards/x.json', undefined, answering(new Response('', { status: 404 }))));
    expect(e.message).toContain('<b>x</b>'); // shown literally: the page renders it as text, never as markup
  });
});
