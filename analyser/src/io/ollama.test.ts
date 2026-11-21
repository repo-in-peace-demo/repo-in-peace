import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalyserError } from '../errors';
import type { EulogyInput } from '../core/eulogy-input';
import { runEulogies } from '../core/eulogy-run';
import { checkOllama, notRunningMessage, ollamaClient } from './ollama';

/** A fake Ollama on 127.0.0.1 and a random port, started by each test; it records every request with its body. */
interface Fake {
  url: string;
  requests: Array<{ method: string; path: string; body: unknown }>;
}
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

async function fakeOllama(handle: (req: IncomingMessage, body: unknown, res: ServerResponse) => void | Promise<void>): Promise<Fake> {
  const requests: Fake['requests'] = [];
  const server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      const body = text === '' ? undefined : (JSON.parse(text) as unknown);
      requests.push({ method: req.method ?? '', path: req.url ?? '', body });
      void handle(req, body, res);
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

const json = (res: ServerResponse, value: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const tags = (...names: string[]) => ({ models: names.map((name) => ({ name, size: 1 })) });

/** A port nothing listens on: one a server had a moment ago. */
async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return `http://127.0.0.1:${port}`;
}

describe('checkOllama', () => {
  it('says to start Ollama when nothing listens', async () => {
    const url = await closedPortUrl();
    await expect(checkOllama(url, 'm')).rejects.toThrow(new AnalyserError(notRunningMessage(url)));
  });

  it('says to start Ollama when the answer is not JSON, or not in time', async () => {
    const garbled = await fakeOllama((_req, _body, res) => void res.end('<html>hello</html>'));
    await expect(checkOllama(garbled.url, 'm')).rejects.toThrow(notRunningMessage(garbled.url));
    const slow = await fakeOllama(() => {}); // never answers
    await expect(checkOllama(slow.url, 'm', 50)).rejects.toThrow(notRunningMessage(slow.url));
  });

  it('says how to install a missing model, listing what is installed', async () => {
    const fake = await fakeOllama((_req, _body, res) => json(res, tags('llama3.2:latest', 'gemma3:4b')));
    await expect(checkOllama(fake.url, 'qwen2.5:7b')).rejects.toThrow(
      new AnalyserError('The model qwen2.5:7b is not installed. Install it with `ollama pull qwen2.5:7b`. Installed: gemma3:4b, llama3.2:latest.'),
    );
    expect(fake.requests).toEqual([{ method: 'GET', path: '/api/tags', body: undefined }]);
  });

  it('says "none" when no model is installed', async () => {
    const fake = await fakeOllama((_req, _body, res) => json(res, tags()));
    await expect(checkOllama(fake.url, 'm')).rejects.toThrow(/Installed: none\.$/);
  });

  it('matches a name with no tag to name:latest, and an exact name', async () => {
    const fake = await fakeOllama((_req, _body, res) => json(res, tags('llama3.2:latest', 'qwen2.5:7b')));
    await expect(checkOllama(fake.url, 'llama3.2')).resolves.toBeUndefined();
    await expect(checkOllama(fake.url, 'llama3.2:latest')).resolves.toBeUndefined();
    await expect(checkOllama(fake.url, 'qwen2.5:7b')).resolves.toBeUndefined();
    await expect(checkOllama(fake.url, 'qwen2.5')).rejects.toThrow(/not installed/);
  });
});

describe('ollamaClient', () => {
  it('sends the model, the prompts, stream and think false, and the options; returns the answer as is', async () => {
    const fake = await fakeOllama((_req, _body, res) => json(res, { model: 'm', response: '  Here lies a. It slept.\n', done: true }));
    const answer = await ollamaClient(fake.url, 'm').generate({ system: 'S', prompt: 'P' });
    expect(answer).toBe('  Here lies a. It slept.\n');
    expect(fake.requests).toEqual([
      {
        method: 'POST',
        path: '/api/generate',
        body: { model: 'm', system: 'S', prompt: 'P', stream: false, think: false, options: { temperature: 0.2, seed: 7, num_predict: 120 } },
      },
    ]);
  });

  it('times out a slow answer', async () => {
    const fake = await fakeOllama((_req, _body, res) => void setTimeout(() => json(res, { response: 'late' }), 1000));
    await expect(ollamaClient(fake.url, 'm', 50).generate({ system: 'S', prompt: 'P' })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('throws on an answer that is not JSON, has no response, or is an error', async () => {
    const notJson = await fakeOllama((_req, _body, res) => void res.end('not json'));
    await expect(ollamaClient(notJson.url, 'm').generate({ system: 'S', prompt: 'P' })).rejects.toThrow(/not JSON/);
    const noResponse = await fakeOllama((_req, _body, res) => json(res, { done: true }));
    await expect(ollamaClient(noResponse.url, 'm').generate({ system: 'S', prompt: 'P' })).rejects.toThrow(/without a response/);
    const failing = await fakeOllama((_req, _body, res) => json(res, { error: 'model not found' }, 404));
    await expect(ollamaClient(failing.url, 'm').generate({ system: 'S', prompt: 'P' })).rejects.toThrow(/answered 404: .*model not found/);
  });

  it('a reasoning model: think false is sent, the thinking field is never read, and the eulogy is the epitaph alone', async () => {
    const epitaph = 'Here lies the router, which kept every path in order. It never once got lost.';
    const fake = await fakeOllama((_req, _body, res) =>
      json(res, { response: `<think>I should mention the lanterns…</think>${epitaph}`, thinking: 'Lanterns. Paths. Do not name the author.', done: true }),
    );
    const input: EulogyInput = {
      kind: 'file',
      path: 'src/router.ts',
      name: 'router.ts',
      state: 'Fresh',
      flags: [],
      lines: 40,
      subject: 'route the paths',
      contents: { text: 'export function route() {}\n', cut: false, kind: 'text' },
      decayState: 'fresh',
      unused: false,
      ageDays: 3,
    };
    const result = await runEulogies([{ path: input.path, input }], {
      client: ollamaClient(fake.url, 'thinker:8b'),
      cache: new Map(),
      model: 'thinker:8b',
      concurrency: 1,
      people: { names: new Set(), emails: new Set() },
      log: () => {},
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body).toMatchObject({ model: 'thinker:8b', think: false, stream: false });
    expect(result.eulogies.get('src/router.ts')).toBe(epitaph);
  });
});
