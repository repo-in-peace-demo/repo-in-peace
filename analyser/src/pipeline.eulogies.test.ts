import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { validateGraveyard, type Graveyard } from '../../shared/graveyard-schema';
import { makeRepo } from '../test/make-repo';
import { main, type CliEnv } from './cli';
import type { EulogyClient } from './core/eulogy-run';
import { toJson } from './core/serialise';
import { AnalyserError } from './errors';
import type { KnipProcessResult } from './io/knip';

/**
 * The eulogy step end to end (eulogies spec, task 11): a real git repository, the real CLI and pipeline, and a fake model.
 * Nothing here talks to a real Ollama; the HTTP checks use a fake server on 127.0.0.1.
 */

const AUTHOR = 'Morticia Addams';
const FILES = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
const repo = makeRepo([
  {
    kind: 'commit',
    message: 'raise the crypt',
    author: AUTHOR,
    date: '2026-01-01T10:00:00+00:00',
    ops: [
      ...FILES.map((path, i) => ({ op: 'write' as const, path, content: `// kept by ${AUTHOR}\nexport const lantern${i} = ${i};\n` })),
      { op: 'write', path: 'src/old.ts', content: 'export const OLD_LANTERN = "the last light";\n' },
      { op: 'write', path: 'package.json', content: '{"name":"crypt"}\n' },
      { op: 'write', path: 'knip.json', content: '{}\n' },
    ],
  },
  {
    kind: 'commit',
    message: `${AUTHOR} lays the old lantern to rest`,
    author: 'Gomez',
    date: '2026-02-01T10:00:00+00:00',
    ops: [{ op: 'delete', path: 'src/old.ts' }],
  },
]);

const scratch: string[] = [];
const servers: Server[] = [];
afterAll(() => {
  repo.cleanup();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-eulogy-pipeline-'));
  scratch.push(dir);
  return dir;
};

const ANALYSED_AT = '2026-03-01T12:00:00Z';
const knip = (): { runKnip: ReturnType<typeof vi.fn> } => ({
  runKnip: vi.fn(async (): Promise<KnipProcessResult> => ({ exitCode: 0, stdout: '{"issues":[]}', stderr: '' })),
});
const pathIn = (prompt: string): string => /^Path: (.*)$/m.exec(prompt)?.[1] ?? '?';

/** A fake model: `answer` decides each reply from the grave's path; every prompt is kept. */
function fakeModel(answer: (path: string, retry: boolean) => string) {
  const prompts: string[] = [];
  const client: EulogyClient = {
    async generate({ system, prompt }) {
      prompts.push(`${system}\n${prompt}`);
      return answer(pathIn(prompt), prompts.filter((p) => p.includes(`Path: ${pathIn(prompt)}`)).length > 1);
    },
  };
  return { client, prompts, calls: () => prompts.length };
}
const epitaphFor = (path: string): string => `The keeper of ${path.replace(/^src\//, '').replace(/\.ts$/, '')} holds a lamp for the lost. It burns to the end.`;

async function run(argv: string[], deps: Record<string, unknown>) {
  const cwd = tempDir();
  const written: string[] = [];
  const cliEnv: CliEnv = { stderr: (t) => void written.push(t), cwd, now: () => '2030-01-01T00:00:00.000Z' };
  const out = join(cwd, 'g.json');
  const code = await main([repo.dir, '--out', out, '--analysed-at', ANALYSED_AT, ...argv], cliEnv, deps as never);
  return { code, out, stderr: written.join(''), cwd };
}
const eulogyFlags = (cache: string, ...more: string[]) => ['--eulogies', '--eulogy-model', 'fake:1b', '--eulogy-cache', cache, ...more];
const okCheck = () => vi.fn(async () => {});

describe('with --eulogies', () => {
  it('sets every file and ghost eulogy and meta.eulogyModel, from redacted inputs with the ghost as it last was', async () => {
    const model = fakeModel((path) => epitaphFor(path));
    const cache = join(tempDir(), 'eulogies.json');
    const { code, out, stderr } = await run(eulogyFlags(cache), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    expect(stderr).not.toMatch(/Error/);
    expect(code).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8')) as Graveyard;
    expect(validateGraveyard(g)).toEqual({ ok: true });
    expect(g.meta.eulogyModel).toBe('fake:1b');
    expect(g.files.map((f) => [f.path, f.eulogy])).toEqual(FILES.map((p) => [p, epitaphFor(p)]));
    expect(g.ghosts.map((x) => [x.path, x.eulogy])).toEqual([['src/old.ts', epitaphFor('src/old.ts')]]);
    // The ghost is shown as it was in its last commit, with the deleting commit's subject.
    const ghostPrompt = model.prompts.find((p) => p.includes('Path: src/old.ts'))!;
    expect(ghostPrompt).toContain('the last light');
    expect(ghostPrompt).toContain('lays the old lantern to rest');
    // No author's name reaches the model, from contents or subjects.
    for (const prompt of model.prompts) expect(prompt).not.toMatch(/Morticia|Addams|Gomez/);
    expect(stderr).toContain('Eulogies: 11 written, 0 from the cache, 0 left empty.');
  });

  it('a reasoning model: the written eulogy is the epitaph alone', async () => {
    const epitaph = 'The router keeps every path in order. It never once gets lost.';
    const model = fakeModel(() => `<think>I should mention the lanterns…</think>${epitaph}`);
    const { code, out } = await run(eulogyFlags(join(tempDir(), 'c.json')), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    expect(code).toBe(0);
    const g = JSON.parse(readFileSync(out, 'utf8')) as Graveyard;
    expect(new Set([...g.files, ...g.ghosts].map((x) => x.eulogy))).toEqual(new Set([epitaph]));
  });
});

describe('P4: without --eulogies the output is byte-identical', () => {
  it('has no eulogyModel and no ghost eulogy, and equals the data written without the optional fields', async () => {
    const plain = await run([], knip());
    expect(plain.code).toBe(0);
    const text = readFileSync(plain.out, 'utf8');
    const g = JSON.parse(text) as Graveyard;
    expect(g.meta).not.toHaveProperty('eulogyModel');
    for (const ghost of g.ghosts) expect(ghost).not.toHaveProperty('eulogy');
    expect(g.files.every((f) => f.eulogy === '')).toBe(true);
    expect(toJson(g)).toBe(text);

    // And the eulogy run changes nothing else: drop its fields, and the bytes are the plain output's.
    const model = fakeModel((path) => epitaphFor(path));
    const withEulogies = await run(eulogyFlags(join(tempDir(), 'c.json')), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    const e = JSON.parse(readFileSync(withEulogies.out, 'utf8')) as Graveyard;
    delete e.meta.eulogyModel;
    for (const ghost of e.ghosts) delete ghost.eulogy;
    for (const file of e.files) file.eulogy = '';
    expect(toJson(e)).toBe(text);
  });
});

describe('P10: a re-run reads the cache', () => {
  it('fills the cache, then a second run makes no call and writes the same bytes', async () => {
    const cache = join(tempDir(), '.cache', 'eulogies.json');
    const first = fakeModel((path) => epitaphFor(path));
    const a = await run(eulogyFlags(cache), { ...knip(), checkOllama: okCheck(), eulogyClient: () => first.client });
    expect(a.code).toBe(0);
    expect(first.calls()).toBe(11);
    const entries = Object.values(JSON.parse(readFileSync(cache, 'utf8')).entries) as Array<{ model: string; at: string }>;
    expect(entries).toHaveLength(11);
    expect(entries.every((x) => x.model === 'fake:1b' && x.at === '2026-03-01T12:00:00.000Z')).toBe(true);

    const second = fakeModel(() => 'This answer must never be used.');
    const b = await run(eulogyFlags(cache), { ...knip(), checkOllama: okCheck(), eulogyClient: () => second.client });
    expect(b.code).toBe(0);
    expect(second.calls()).toBe(0);
    expect(readFileSync(b.out, 'utf8')).toBe(readFileSync(a.out, 'utf8'));
    expect(b.stderr).toContain('Eulogies: 0 written, 11 from the cache, 0 left empty.');
  });
});

describe('failures, end to end', () => {
  const closedPort = async (): Promise<string> => {
    const server = createServer();
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;
    await new Promise((done) => server.close(done));
    return `http://127.0.0.1:${port}`;
  };

  it('Ollama not running: exit 1, no output file, Knip and the model never asked', async () => {
    const url = await closedPort();
    const k = knip();
    const model = fakeModel(() => 'x');
    const r = await run(eulogyFlags(join(tempDir(), 'c.json'), '--ollama-url', url), { ...k, eulogyClient: () => model.client });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`Error: Ollama is not running at ${url}. Start it with \`ollama serve\``);
    expect(existsSync(r.out)).toBe(false);
    expect(k.runKnip).not.toHaveBeenCalled();
    expect(model.calls()).toBe(0);
  });

  it('the model missing: the ollama pull message', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await run(eulogyFlags(join(tempDir(), 'c.json'), '--ollama-url', url), knip());
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Error: The model fake:1b is not installed. Install it with `ollama pull fake:1b`. Installed: llama3.2:latest.');
    expect(existsSync(r.out)).toBe(false);
  });

  it('one grave failing: only that eulogy is empty, and the summary says why', async () => {
    const model = fakeModel((path) => {
      if (path === 'src/f3.ts') throw new Error('500 from the server');
      return epitaphFor(path);
    });
    const r = await run(eulogyFlags(join(tempDir(), 'c.json')), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    expect(r.code).toBe(0);
    const g = JSON.parse(readFileSync(r.out, 'utf8')) as Graveyard;
    for (const file of g.files) expect(file.eulogy).toBe(file.path === 'src/f3.ts' ? '' : epitaphFor(file.path));
    expect(r.stderr).toContain('Eulogies: 10 written, 0 from the cache, 1 left empty (1 failed).');
    expect(r.stderr).toContain('left empty: src/f3.ts (request failed: 500 from the server)');
  });

  it('the first 8 answers all rejected: exit 1, no output file, no cache, the "try another model" message', async () => {
    const cache = join(tempDir(), 'c.json');
    const model = fakeModel(() => 'const lantern = light();');
    const r = await run(eulogyFlags(cache), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Error: The model fake:1b wrote no usable eulogy in its first 8 answers');
    expect(r.stderr).toContain('Try another model, see the README.');
    expect(existsSync(r.out)).toBe(false);
    expect(existsSync(cache)).toBe(false);
  });

  it('a malformed cache is reported, then replaced', async () => {
    const cache = join(tempDir(), 'c.json');
    writeFileSync(cache, '{ broken');
    const model = fakeModel((path) => epitaphFor(path));
    const r = await run(eulogyFlags(cache), { ...knip(), checkOllama: okCheck(), eulogyClient: () => model.client });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`The eulogy cache at ${cache} could not be read; starting a new one.`);
    expect(Object.keys(JSON.parse(readFileSync(cache, 'utf8')).entries)).toHaveLength(11);
  });

  it('a failed check exits 1 with its own message', async () => {
    const r = await run(eulogyFlags(join(tempDir(), 'c.json')), { ...knip(), checkOllama: async () => { throw new AnalyserError('nope'); } });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Error: nope');
  });
});
