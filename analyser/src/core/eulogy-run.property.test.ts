import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AnalyserError } from '../errors';
import type { EulogyInput } from './eulogy-input';
import { EULOGY_VERSIONS, cacheKey } from './eulogy-key';
import { buildPrompt } from './eulogy-prompt';
import { modelMessage, runEulogies, type EulogyClient, type EulogyJob, type RunDeps } from './eulogy-run';

const people = { names: new Set<string>(), emails: new Set<string>() };
const MODEL = 'fake-model';

type Behaviour = 'pass' | 'reject' | 'rejectThenPass' | 'throw' | 'timeout';

const inputOf = (path: string): EulogyInput => ({
  kind: 'file',
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  state: 'Fresh',
  flags: [],
  lines: 10,
  subject: 'tidy up',
  contents: { text: 'export const a = 1;\n', cut: false, kind: 'text' },
  decayState: 'fresh',
  unused: false,
  ageDays: 3,
});
const jobOf = (path: string): EulogyJob => ({ path, input: inputOf(path) });
const goodAnswer = (path: string): string => `Here lies ${path.replace(/[^a-z]/g, ' ').trim() || 'a file'}. It rested well.`;
const ticks = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** A client that answers each job's prompt (first try and retry) as its behaviour says, after a few ticks so requests overlap. */
function fakeClient(plan: ReadonlyMap<string, { behaviour: Behaviour; delay: number }>): EulogyClient & { calls: number } {
  const byPrompt = new Map<string, { path: string; retry: boolean }>();
  for (const path of plan.keys()) for (const retry of [false, true]) byPrompt.set(buildPrompt(inputOf(path), retry).prompt, { path, retry });
  const client = {
    calls: 0,
    async generate({ prompt }: { system: string; prompt: string }): Promise<string> {
      client.calls++;
      const hit = byPrompt.get(prompt);
      if (hit === undefined) throw new Error('unknown prompt');
      const { behaviour, delay } = plan.get(hit.path)!;
      await ticks(hit.retry ? delay + 1 : delay);
      switch (behaviour) {
        case 'pass':
          return goodAnswer(hit.path);
        case 'reject':
          return 'const x = 1;';
        case 'rejectThenPass':
          return hit.retry ? goodAnswer(hit.path) : 'see https://example.com';
        case 'throw':
          throw new Error('500 from the server');
        case 'timeout': {
          const error = new Error('The operation was aborted due to timeout');
          error.name = 'TimeoutError';
          throw error;
        }
      }
    },
  };
  return client;
}

const deps = (client: EulogyClient, over: Partial<RunDeps> = {}): RunDeps => ({
  client,
  cache: new Map(),
  model: MODEL,
  concurrency: 2,
  people,
  log: () => {},
  ...over,
});

const pathArb = fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.ts$/);
const planArb = (behaviours: fc.Arbitrary<Behaviour>) =>
  fc.uniqueArray(fc.record({ path: pathArb, behaviour: behaviours, delay: fc.nat(6) }), { minLength: 1, maxLength: 20, selector: (j) => j.path });

describe('P5: isolation', () => {
  it('every result key is a job path, and each eulogy is the same as when its job runs alone', async () => {
    await fc.assert(
      fc.asyncProperty(planArb(fc.constantFrom<Behaviour>('pass', 'reject', 'rejectThenPass', 'throw', 'timeout')), fc.integer({ min: 1, max: 4 }), async (entries, concurrency) => {
        // The first job in path order passes, so the model check is switched off; at most 4 failing requests, so the run never stops early.
        const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));
        sorted[0] = { ...sorted[0]!, behaviour: 'pass' };
        let failing = 0;
        for (const e of sorted) if ((e.behaviour === 'throw' || e.behaviour === 'timeout') && ++failing > 4) e.behaviour = 'reject';
        const plan = new Map(sorted.map((e) => [e.path, e]));
        const jobs = entries.map((e) => jobOf(e.path));

        const together = await runEulogies(jobs, deps(fakeClient(plan), { concurrency }));
        expect(together.stoppedEarly).toBe(false);
        expect([...together.eulogies.keys()].sort()).toEqual(jobs.map((j) => j.path).sort());
        for (const job of jobs) {
          const alone = await runEulogies([job], deps(fakeClient(plan)));
          expect(together.eulogies.get(job.path)).toBe(alone.eulogies.get(job.path));
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('P12: the model check', () => {
  it('stops the run with the model message when the first 8 answers are all rejected, and keeps nothing new', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(pathArb, { minLength: 8, maxLength: 16 }),
        fc.integer({ min: 1, max: 4 }),
        fc.nat(6),
        async (paths, concurrency, delay) => {
          const sorted = [...paths].sort();
          // The first 8 in path order are rejected; the rest pass (and may finish before the check is decided).
          const plan = new Map(sorted.map((p, i) => [p, { behaviour: (i < 8 ? 'reject' : 'pass') as Behaviour, delay: i < 8 ? delay : 0 }]));
          const kept: string[] = [];
          await expect(
            runEulogies(paths.map(jobOf), deps(fakeClient(plan), { concurrency, onNew: (key) => kept.push(key) })),
          ).rejects.toThrow(new AnalyserError(modelMessage(MODEL)));
          expect(kept).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('does not stop when any of the first 8 answers passes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(pathArb, { minLength: 8, maxLength: 16 }), fc.nat(7), fc.integer({ min: 1, max: 4 }), async (paths, passing, concurrency) => {
        const sorted = [...paths].sort();
        const plan = new Map(sorted.map((p, i) => [p, { behaviour: (i === passing ? 'rejectThenPass' : 'reject') as Behaviour, delay: i % 3 }]));
        const kept: string[] = [];
        const result = await runEulogies(paths.map(jobOf), deps(fakeClient(plan), { concurrency, onNew: (key) => kept.push(key) }));
        expect(result.written).toBe(1);
        expect(kept).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });

  it('does not count cache hits or failed requests as answers', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`);
    // 4 cache hits, 4 failed requests (not 5 in a row), then 7 rejections and nothing else: fewer than 8 answers, so no stop.
    const cache = new Map(paths.slice(0, 4).map((p) => [cacheKey(MODEL, EULOGY_VERSIONS, inputOf(p)), 'Here lies a cached file. It slept.']));
    const plan = new Map(paths.map((p, i) => [p, { behaviour: (i < 4 ? 'pass' : i < 8 ? 'throw' : 'reject') as Behaviour, delay: 0 }]));
    const extra = ['g1.ts', 'g2.ts', 'g3.ts'];
    for (const p of extra) plan.set(p, { behaviour: 'reject', delay: 0 });
    const result = await runEulogies([...paths, ...extra].map(jobOf), deps(fakeClient(plan), { cache, concurrency: 1 }));
    expect(result.cached).toBe(4);
    expect(result.written).toBe(0);
    expect(result.empty).toHaveLength(11);
  });
});

describe('the run: examples', () => {
  const mixed = new Map<string, { behaviour: Behaviour; delay: number }>(
    (['pass', 'reject', 'rejectThenPass', 'throw', 'timeout', 'pass', 'pass', 'reject', 'pass', 'timeout'] as Behaviour[]).map((behaviour, i) => [
      `src/f${i}.ts`,
      { behaviour, delay: (i * 7) % 5 },
    ]),
  );
  const jobs = [...mixed.keys()].reverse().map(jobOf);

  it('gives the same results with concurrency 1 to 4', async () => {
    const results = [];
    for (const concurrency of [1, 2, 3, 4]) results.push(await runEulogies(jobs, deps(fakeClient(mixed), { concurrency })));
    for (const r of results.slice(1)) {
      expect([...r.eulogies]).toEqual([...results[0]!.eulogies]);
      expect(r.empty).toEqual(results[0]!.empty);
    }
    expect(results[0]!.written).toBe(5);
  });

  it('retries a rejection once, and never retries a failed request', async () => {
    const client = fakeClient(new Map([
      ['a.ts', { behaviour: 'pass' as Behaviour, delay: 0 }],
      ['b.ts', { behaviour: 'reject' as Behaviour, delay: 0 }],
      ['c.ts', { behaviour: 'throw' as Behaviour, delay: 0 }],
    ]));
    const result = await runEulogies(['a.ts', 'b.ts', 'c.ts'].map(jobOf), deps(client, { concurrency: 1 }));
    expect(client.calls).toBe(1 + 2 + 1);
    expect(result.empty).toEqual([
      { path: 'b.ts', reason: 'rejected twice (code)' },
      { path: 'c.ts', reason: 'request failed: 500 from the server' },
    ]);
  });

  it('stops after 5 request errors in a row, leaving the rest empty, with stoppedEarly', async () => {
    const plan = new Map(Array.from({ length: 10 }, (_, i) => [`f${i}.ts`, { behaviour: (i === 0 ? 'pass' : 'throw') as Behaviour, delay: 0 }]));
    const client = fakeClient(plan);
    const lines: string[] = [];
    const result = await runEulogies([...plan.keys()].map(jobOf), deps(client, { concurrency: 1, log: (m) => lines.push(m) }));
    expect(result.stoppedEarly).toBe(true);
    expect(client.calls).toBe(6);
    expect(result.written).toBe(1);
    expect(result.empty.filter((e) => e.reason.startsWith('not run'))).toHaveLength(4);
    expect(lines).toContain('Ollama stopped answering after 1 eulogies; the rest are left empty.');
  });

  it('does not stop when an answer comes between the errors', async () => {
    const plan = new Map(Array.from({ length: 12 }, (_, i) => [`f${String(i).padStart(2, '0')}.ts`, { behaviour: (i % 4 === 0 ? 'pass' : 'throw') as Behaviour, delay: 0 }]));
    const result = await runEulogies([...plan.keys()].map(jobOf), deps(fakeClient(plan), { concurrency: 1 }));
    expect(result.stoppedEarly).toBe(false);
    expect(result.written).toBe(3);
  });

  it('summary counts add up to the number of jobs, and the summary line says so', async () => {
    const cache = new Map([[cacheKey(MODEL, EULOGY_VERSIONS, inputOf('src/f0.ts')), 'Here lies f0. It slept.']]);
    const lines: string[] = [];
    const result = await runEulogies(jobs, deps(fakeClient(mixed), { cache, log: (m) => lines.push(m) }));
    expect(result.written + result.cached + result.empty.length).toBe(jobs.length);
    expect(result.eulogies.size).toBe(jobs.length);
    expect(result.cached).toBe(1);
    expect(lines.at(-1)).toBe('Eulogies: 4 written, 1 from the cache, 5 left empty (2 rejected twice, 2 timed out, 1 failed).');
  });

  it('logs progress at most once a second', async () => {
    let clock = 0;
    const lines: string[] = [];
    await runEulogies(jobs, deps(fakeClient(mixed), { concurrency: 1, log: (m) => lines.push(m), now: () => (clock += 400) }));
    const progress = lines.filter((l) => /^Eulogies: \d+\/\d+/.test(l));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThanOrEqual(Math.ceil((jobs.length * 400) / 1000));
    expect(progress[0]).toMatch(/^Eulogies: \d+\/10 \(0 from the cache\)$/);
  });

  it('checks each answer against its own grave: a used file called unused is retried, with the reminder', async () => {
    const prompts: string[] = [];
    const client: EulogyClient = {
      async generate({ prompt }) {
        prompts.push(prompt);
        return prompts.length === 1 ? 'Though unused, the keeper waits by the gate.' : 'The keeper still guards the gate each night.';
      },
    };
    const result = await runEulogies([jobOf('src/keeper.ts')], deps(client));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('said something the facts above contradict');
    expect(result.eulogies.get('src/keeper.ts')).toBe('The keeper still guards the gate each night.');
  });

  it('reads a cache hit without calling the model', async () => {
    const cache = new Map([[cacheKey(MODEL, EULOGY_VERSIONS, inputOf('a.ts')), 'Here lies a. It slept.']]);
    const client = fakeClient(new Map([['a.ts', { behaviour: 'throw' as Behaviour, delay: 0 }]]));
    const result = await runEulogies([jobOf('a.ts')], deps(client, { cache }));
    expect(client.calls).toBe(0);
    expect(result.eulogies.get('a.ts')).toBe('Here lies a. It slept.');
  });
});
