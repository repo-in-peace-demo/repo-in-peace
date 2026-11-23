import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { validateGraveyard, type Graveyard } from '../../shared/graveyard-schema';
import { GOLDEN_ANALYSED_AT, GOLDEN_UNUSED, goldenSteps } from '../test/golden-repo';
import { makeRepo, type BuiltRepo, type Step } from '../test/make-repo';
import { thresholdsFrom } from './core/thresholds';
import { AnalyserError } from './errors';
import { KNIP_ADVICE, KNIP_DIR_ADVICE, type KnipProcessResult, type KnipRunOptions } from './io/knip';
import { runPipeline, type PipelineDeps, type PipelineOptions } from './pipeline';

const scratch: string[] = [];
const repos: BuiltRepo[] = [];
afterAll(() => {
  for (const repo of repos) repo.cleanup();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-pipe-'));
  scratch.push(dir);
  return dir;
};
const build = (steps: Step[]): BuiltRepo => {
  const repo = makeRepo(steps);
  repos.push(repo);
  return repo;
};

const ANALYSED_AT = '2026-03-02T09:30:00.000Z';
const knipJson = (...unused: string[]): string =>
  JSON.stringify({ issues: unused.map((file) => ({ file, files: [{ name: file }] })) });
const knipOk = (...unused: string[]): KnipProcessResult => ({ exitCode: unused.length > 0 ? 1 : 0, stdout: knipJson(...unused), stderr: '' });

/** Collects what the pipeline logs and what it asks Knip. */
function harness(result: KnipProcessResult | (() => KnipProcessResult)) {
  const logs: string[] = [];
  const knipCalls: KnipRunOptions[] = [];
  const deps: PipelineDeps = {
    log: (m) => logs.push(m),
    runKnip: async (options) => {
      knipCalls.push(options);
      return typeof result === 'function' ? result() : result;
    },
  };
  return { deps, logs, knipCalls };
}

/** The error a pipeline run fails with. Fails the test if the run succeeds. */
async function errorOf(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the pipeline to fail, but it succeeded');
}

const optionsFor = (repo: BuiltRepo, outDir: string, extra: Partial<PipelineOptions> = {}): PipelineOptions => ({
  repoPath: repo.dir,
  outPath: join(outDir, 'out', 'graveyard.json'),
  analysedAt: ANALYSED_AT,
  cwd: outDir,
  ...extra,
});

// A repo with every kind of file the analyser must handle.
//   c1 2025-01-01: adds sources, an unused file, build output, docs, a declaration file, a file that is deleted later
//   c2 2025-06-01: deletes ghost.ts
//   c3..c7 (Feb 16-20 2026): five edits to src/a.ts, making it hot
//   c8 2026-02-20: renames src/b.ts to src/moved.ts
const steps: Step[] = [
  {
    kind: 'commit',
    message: 'c1',
    author: 'Ann',
    date: '2025-01-01T10:00:00+00:00',
    ops: [
      { op: 'write', path: 'src/a.ts', content: 'export const a = 0;\n\n// note\n' },
      { op: 'write', path: 'src/old.ts', content: 'export const old = 1;\n' },
      { op: 'write', path: 'src/b.ts', content: 'export const b = 1;\nexport const b2 = 2;\nexport const b3 = 3;\n' },
      { op: 'write', path: 'ghost.ts', content: 'export const ghost = 1;\n' },
      { op: 'write', path: 'dist/skip.js', content: 'module.exports = 1;\n' },
      { op: 'write', path: 'README.md', content: '# demo\n' },
      { op: 'write', path: 'types.d.ts', content: 'declare const t: number;\n' },
      { op: 'write', path: 'package.json', content: '{"name":"demo","knip":{}}\n' },
    ],
  },
  { kind: 'commit', message: 'c2', author: 'Bob', date: '2025-06-01T10:00:00+00:00', ops: [{ op: 'delete', path: 'ghost.ts' }] },
  ...[16, 17, 18, 19, 20].map(
    (day): Step => ({
      kind: 'commit',
      message: `edit a on ${day}`,
      author: 'Cy',
      date: `2026-02-${day}T09:00:00+00:00`,
      ops: [{ op: 'write', path: 'src/a.ts', content: `export const a = ${day};\n\n// note\n` }],
    }),
  ),
  {
    kind: 'commit',
    message: 'c8',
    author: 'Di',
    date: '2026-02-20T10:00:00+00:00',
    ops: [{ op: 'rename', from: 'src/b.ts', to: 'src/moved.ts' }],
  },
];

const demo = build(steps);

function readOutput(path: string): Graveyard {
  return JSON.parse(readFileSync(path, 'utf8')) as Graveyard;
}

describe('runPipeline on a real repository', () => {
  const out = tempDir();
  const h = harness(knipOk('src/old.ts', 'dist/skip.js', 'not/in/the/tree.ts'));
  const result = runPipeline(optionsFor(demo, out), h.deps);
  result.catch(() => {}); // a failure is reported by the tests that await `result`, not as an unhandled rejection

  it('writes a graveyard file that passes the schema validator', async () => {
    const { outPath, graveyard } = await result;
    expect(existsSync(outPath)).toBe(true);
    const onDisk = readOutput(outPath);
    expect(onDisk).toEqual(graveyard);
    expect(validateGraveyard(onDisk)).toEqual({ ok: true });
    expect(readFileSync(outPath, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('describes the snapshot', async () => {
    const { graveyard } = await result;
    expect(graveyard.meta).toMatchObject({
      snapshotSha: demo.shas.at(-1),
      snapshotDate: '2026-02-20T10:00:00.000Z',
      analysedAt: ANALYSED_AT,
      schemaVersion: 2,
      thresholds: { staleAfterDays: 90, ancientAfterDays: 360, decayCapDays: 720, hotCommits: 5, hotWindowDays: 30 },
    });
  });

  it('lists only the source files git tracks, not build output, docs or declarations', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/moved.ts', 'src/old.ts']);
  });

  it('counts non-blank lines', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.find((f) => f.path === 'src/a.ts')?.linesOfCode).toBe(2); // blank line not counted
    expect(graveyard.files.find((f) => f.path === 'src/moved.ts')?.linesOfCode).toBe(3);
  });

  it('flags the unused file and ignores Knip paths that are not current source files', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.filter((f) => f.unused).map((f) => f.path)).toEqual(['src/old.ts']);
  });

  it('scores an old unused file as ancient, high on the scale', async () => {
    const { graveyard } = await result;
    // 415 days between 2025-01-01 and 2026-02-20: 0.6 + 0.4 * 415 / 720
    expect(graveyard.files.find((f) => f.path === 'src/old.ts')).toMatchObject({
      decayState: 'ancient',
      decayScore: 0.8306,
      lastCommitAuthor: 'Ann',
      hot: false,
    });
  });

  it('marks the file edited five times in 30 days as hot and fresh', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
      decayState: 'fresh',
      hot: true,
      recentCommits: 5,
      lastCommitAuthor: 'Cy',
      unused: false,
    });
  });

  it('follows the rename, so the moved file keeps its history', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.find((f) => f.path === 'src/moved.ts')).toMatchObject({
      recentCommits: 1, // the rename; the original add is outside the 30 days
      lastCommitAuthor: 'Di',
      decayState: 'fresh',
    });
    expect(graveyard.ghosts.map((g) => g.path)).not.toContain('src/b.ts');
  });

  it('records the deleted file as a ghost that can be restored from its last commit', async () => {
    const { graveyard } = await result;
    expect(graveyard.ghosts).toEqual([
      {
        path: 'ghost.ts',
        deletedInSha: demo.shas[1],
        deletedDate: '2025-06-01T10:00:00.000Z',
        deletedBy: 'Bob',
        lastExistingSha: demo.shas[0],
      },
    ]);
    const restored = execFileSync('git', ['-C', demo.dir, 'show', `${demo.shas[0]}:ghost.ts`], { encoding: 'utf8' });
    expect(restored).toBe('export const ghost = 1;\n');
  });

  it('builds the folder hierarchy', async () => {
    const { graveyard } = await result;
    expect(graveyard.folders).toEqual([
      { path: '', parent: null },
      { path: 'src', parent: '' },
    ]);
  });

  it('leaves every eulogy empty', async () => {
    const { graveyard } = await result;
    expect(graveyard.files.every((f) => f.eulogy === '')).toBe(true);
  });

  it('asks Knip to run in the clone, with no config override, and logs its progress', async () => {
    await result;
    expect(h.knipCalls).toHaveLength(1);
    expect(h.knipCalls[0]?.configPath).toBeUndefined();
    expect(h.logs.join('\n')).toMatch(/Analysing .* at [0-9a-f]{7}/);
  });

  it('does not warn about Knip config when the clone has one', async () => {
    await result;
    expect(h.logs.some((m) => m.startsWith('Warning'))).toBe(false);
  });

  it('leaves the clone exactly as it was', async () => {
    await result;
    const status = execFileSync('git', ['-C', demo.dir, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status).toBe('');
  });
});

describe('Knip configuration', () => {
  const noConfigRepo = build([
    {
      kind: 'commit',
      message: 'c1',
      author: 'Ann',
      date: '2026-01-01T10:00:00+00:00',
      ops: [
        { op: 'write', path: 'index.ts', content: 'export {};\n' },
        { op: 'write', path: 'package.json', content: '{"name":"x"}\n' },
      ],
    },
  ]);

  it('warns when the clone has no Knip config and none is given, then carries on', async () => {
    const out = tempDir();
    const h = harness(knipOk());
    await runPipeline(optionsFor(noConfigRepo, out), h.deps);
    const warning = h.logs.find((m) => m.startsWith('Warning'));
    expect(warning).toMatch(/no Knip configuration/);
    expect(warning).toMatch(/--knip-config/);
    expect(existsSync(join(out, 'out', 'graveyard.json'))).toBe(true);
  });

  it('does not warn, and passes the config on as an absolute path, when --knip-config is given', async () => {
    const out = tempDir();
    writeFileSync(join(out, 'my-knip.json'), '{}');
    const h = harness(knipOk());
    await runPipeline(optionsFor(noConfigRepo, out, { knipConfigPath: 'my-knip.json' }), h.deps);
    expect(h.logs.some((m) => m.startsWith('Warning'))).toBe(false);
    expect(h.knipCalls[0]?.configPath).toBe(join(out, 'my-knip.json'));
  });

  it('does not warn when the clone has a knip.json in its root', async () => {
    const withConfig = build([
      {
        kind: 'commit',
        message: 'c1',
        author: 'Ann',
        date: '2026-01-01T10:00:00+00:00',
        ops: [
          { op: 'write', path: 'index.ts', content: 'export {};\n' },
          { op: 'write', path: 'package.json', content: '{"name":"x"}\n' },
          { op: 'write', path: 'knip.json', content: '{}\n' },
        ],
      },
    ]);
    const h = harness(knipOk());
    await runPipeline(optionsFor(withConfig, tempDir()), h.deps);
    expect(h.logs.some((m) => m.startsWith('Warning'))).toBe(false);
  });

  it('fails before running Knip when the given config file does not exist', async () => {
    const out = tempDir();
    const h = harness(knipOk());
    await expect(runPipeline(optionsFor(noConfigRepo, out, { knipConfigPath: 'missing.json' }), h.deps)).rejects.toThrow(
      /Knip config file "missing\.json" does not exist/,
    );
    expect(h.knipCalls).toHaveLength(0);
  });
});

describe('a failed run leaves no output file', () => {
  const outFileOf = (out: string) => join(out, 'out', 'graveyard.json');
  const expectNothingWritten = (out: string) => {
    expect(existsSync(outFileOf(out))).toBe(false);
    // not even a temporary file or the created directory's contents
    const outDir = join(out, 'out');
    expect(existsSync(outDir) ? readdirSync(outDir) : []).toEqual([]);
  };

  it('when the path does not exist', async () => {
    const out = tempDir();
    await expect(
      runPipeline({ ...optionsFor(demo, out), repoPath: join(out, 'nope') }, harness(knipOk()).deps),
    ).rejects.toBeInstanceOf(AnalyserError);
    expectNothingWritten(out);
  });

  it('when the clone is shallow', async () => {
    const out = tempDir();
    const shallow = join(tempDir(), 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${demo.dir}`, shallow], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    const h = harness(knipOk());
    await expect(runPipeline({ ...optionsFor(demo, out), repoPath: shallow }, h.deps)).rejects.toThrow(/shallow clone/);
    expect(h.knipCalls).toHaveLength(0);
    expectNothingWritten(out);
  });

  it.each([
    ['Knip exits with code 2', { exitCode: 2, stdout: '', stderr: 'Cannot find module "typescript"' }],
    ['Knip prints something that is not JSON', { exitCode: 0, stdout: 'oops', stderr: '' }],
    ['Knip cannot be started', { exitCode: null, stdout: '', stderr: '', spawnError: 'spawn ENOENT' }],
  ] as Array<[string, KnipProcessResult]>)('when %s, with the install advice in the message', async (_label, knip) => {
    const out = tempDir();
    await expect(runPipeline(optionsFor(demo, out), harness(knip).deps)).rejects.toThrow(KNIP_ADVICE);
    expectNothingWritten(out);
  });

  it('when the output path is inside the clone, and says why', async () => {
    const h = harness(knipOk());
    const inside = join(demo.dir, 'graveyard.json');
    await expect(runPipeline({ ...optionsFor(demo, tempDir()), outPath: inside }, h.deps)).rejects.toThrow(/inside the clone/);
    expect(existsSync(inside)).toBe(false);
    expect(h.knipCalls).toHaveLength(0);
  });

  it('when the output path is inside the clone through a symlink', async () => {
    const link = join(tempDir(), 'link');
    execFileSync('ln', ['-s', demo.dir, link]);
    await expect(
      runPipeline({ ...optionsFor(demo, tempDir()), outPath: join(link, 'sub', 'g.json') }, harness(knipOk()).deps),
    ).rejects.toThrow(/inside the clone/);
    expect(existsSync(join(demo.dir, 'sub'))).toBe(false);
  });

  it('when the eulogy cache is inside the clone, before Ollama or Knip is asked anything', async () => {
    const h = harness(knipOk());
    const out = tempDir();
    const cachePath = join(demo.dir, '.cache', 'eulogies.json');
    const eulogies = { model: 'm', ollamaUrl: 'http://localhost:11434', concurrency: 2, cachePath };
    await expect(runPipeline({ ...optionsFor(demo, out), eulogies }, h.deps)).rejects.toThrow(/eulogy cache .* inside the clone.*--eulogy-cache/);
    expect(existsSync(join(demo.dir, '.cache'))).toBe(false);
    expect(h.knipCalls).toHaveLength(0);
    expectNothingWritten(out);
  });
});

describe('the default output file', () => {
  it('is <repo-name>.graveyard.json in the working directory', async () => {
    const cwd = tempDir();
    const result = await runPipeline(
      { repoPath: demo.dir, analysedAt: ANALYSED_AT, cwd },
      harness(knipOk()).deps,
    );
    expect(result.outPath).toMatch(/[\\/][A-Za-z0-9._-]+\.graveyard\.json$/);
    expect(result.outPath.startsWith(cwd)).toBe(true);
    expect(existsSync(result.outPath)).toBe(true);
  });

  it('resolves a relative --out against the working directory, creating directories', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'results'));
    const result = await runPipeline(
      { repoPath: demo.dir, outPath: 'results/deep/g.json', analysedAt: ANALYSED_AT, cwd },
      harness(knipOk()).deps,
    );
    expect(result.outPath).toBe(join(cwd, 'results', 'deep', 'g.json'));
    expect(existsSync(result.outPath)).toBe(true);
  });
});

describe('a repository with nothing to show', () => {
  it('writes a valid graveyard with only the root folder', async () => {
    const empty = build([
      {
        kind: 'commit',
        message: 'docs only',
        author: 'Ann',
        date: '2026-01-01T10:00:00+00:00',
        ops: [
          { op: 'write', path: 'README.md', content: '# hi\n' },
          { op: 'write', path: 'package.json', content: '{"name":"x"}\n' },
        ],
      },
    ]);
    const out = tempDir();
    const { graveyard } = await runPipeline(optionsFor(empty, out), harness(knipOk()).deps);
    expect(graveyard.files).toEqual([]);
    expect(graveyard.ghosts).toEqual([]);
    expect(graveyard.folders).toEqual([{ path: '', parent: null }]);
  });
});

describe('side effects', () => {
  it('never calls Knip more than once', async () => {
    const run = vi.fn(async () => knipOk());
    await runPipeline(optionsFor(demo, tempDir()), { log: () => {}, runKnip: run });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// A Python project with its web apps in subfolders, like the first real repository tried.
const polyglot = build([
  {
    kind: 'commit',
    message: 'c1',
    author: 'Ann',
    date: '2025-01-01T10:00:00+00:00',
    ops: [
      { op: 'write', path: 'pyproject.toml', content: '[project]\nname = "x"\n' },
      { op: 'write', path: 'scripts/run.py', content: 'print(1)\n' },
      { op: 'write', path: 'app/package.json', content: '{"name":"app","knip":{}}\n' },
      { op: 'write', path: 'app/src/index.ts', content: 'export const a = 1;\n' },
      { op: 'write', path: 'app/src/old.ts', content: 'export const old = 1;\n' },
      { op: 'write', path: 'tools/web/package.json', content: '{"name":"web"}\n' },
      { op: 'write', path: 'tools/web/main.ts', content: 'export const w = 1;\n' },
      { op: 'write', path: 'tools/web/unused.ts', content: 'export const u = 1;\n' },
    ],
  },
]);

describe('Knip folders (--knip-dir)', () => {
  const realRoot = realpathSync(polyglot.dir);

  it('stops before running Knip when the clone root has no package.json, listing every folder that has one', async () => {
    const out = tempDir();
    const h = harness(knipOk());
    const attempt = runPipeline(optionsFor(polyglot, out), h.deps);
    await expect(attempt).rejects.toThrow(/No package\.json found in the clone root/);
    await expect(attempt).rejects.toThrow(/"app", "tools\/web"/);
    await expect(attempt).rejects.toThrow(/--knip-dir app/);
    expect(h.knipCalls).toHaveLength(0);
    expect(existsSync(join(out, 'out'))).toBe(false);
  });

  it('does not suggest installing dependencies when the folder is wrong', async () => {
    const error = await errorOf(runPipeline(optionsFor(polyglot, tempDir()), harness(knipOk()).deps));
    expect(error).toBeInstanceOf(AnalyserError);
    expect(error.message).not.toMatch(/install/i);
  });

  it('runs Knip in the folder and prefixes what it reports, so the right current file is flagged', async () => {
    const h = harness(knipOk('src/old.ts'));
    const { graveyard } = await runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app'] }), h.deps);

    expect(h.knipCalls.map((c) => c.clonePath)).toEqual([join(realRoot, 'app')]);
    expect(graveyard.files.filter((f) => f.unused).map((f) => f.path)).toEqual(['app/src/old.ts']);
    expect(graveyard.files.map((f) => f.path)).toEqual(['app/src/index.ts', 'app/src/old.ts', 'tools/web/main.ts', 'tools/web/unused.ts']);
  });

  it('runs Knip once per folder and merges the results', async () => {
    const answers: Record<string, KnipProcessResult> = {
      [join(realRoot, 'app')]: knipOk('src/old.ts'),
      [join(realRoot, 'tools/web')]: knipOk('unused.ts'),
    };
    const knipCalls: KnipRunOptions[] = [];
    const logs: string[] = [];
    const deps: PipelineDeps = {
      log: (m) => logs.push(m),
      runKnip: async (options) => {
        knipCalls.push(options);
        return answers[options.clonePath] ?? { exitCode: 2, stdout: '', stderr: 'unexpected folder' };
      },
    };

    const { graveyard } = await runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app', 'tools/web'] }), deps);

    expect(knipCalls).toHaveLength(2);
    expect(graveyard.files.filter((f) => f.unused).map((f) => f.path)).toEqual(['app/src/old.ts', 'tools/web/unused.ts']);
    expect(logs.some((m) => m.includes('Running Knip (unused files) in "app"'))).toBe(true);
    expect(logs.some((m) => m.includes('Running Knip (unused files) in "tools/web"'))).toBe(true);
  });

  it('runs a repeated folder only once', async () => {
    const h = harness(knipOk());
    await runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app', 'app'] }), h.deps);
    expect(h.knipCalls).toHaveLength(1);
  });

  it('reports a path Knip names that is not a current file without flagging anything', async () => {
    const h = harness(knipOk('src/not-tracked.ts', '../escape.ts'));
    const { graveyard } = await runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app'] }), h.deps);
    expect(graveyard.files.some((f) => f.unused)).toBe(false);
  });

  it('lists every folder that has a package.json when a requested folder does not', async () => {
    const h = harness(knipOk());
    await expect(runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app', 'nope'] }), h.deps)).rejects.toThrow(
      /No package\.json found in "nope"[\s\S]*"app", "tools\/web"/,
    );
    expect(h.knipCalls).toHaveLength(0); // even the valid folder is not run first
  });

  it('warns about a missing Knip config for each folder that lacks one', async () => {
    const h = harness(knipOk());
    await runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app', 'tools/web'] }), h.deps);
    const warnings = h.logs.filter((m) => m.startsWith('Warning'));
    expect(warnings).toHaveLength(1); // app has a "knip" key in its package.json; tools/web has no config
    expect(warnings[0]).toContain('"tools/web"');
    expect(warnings[0]).toMatch(/no Knip configuration/);
  });

  it('names the folder in a Knip failure, and keeps the install advice when a package.json exists', async () => {
    const failing = harness({ exitCode: 2, stdout: '', stderr: 'Cannot find module "vite"' });
    const error = await errorOf(runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app'] }), failing.deps));
    expect(error.message).toContain('Knip failed in "app"');
    expect(error.message).toContain(KNIP_ADVICE);
    expect(error.message).not.toContain(KNIP_DIR_ADVICE);
  });

  it('suggests --knip-dir, not installing, when Knip itself cannot find a package.json', async () => {
    const failing = harness({ exitCode: 2, stdout: '', stderr: 'ERROR: Unable to find package.json' });
    const error = await errorOf(runPipeline(optionsFor(polyglot, tempDir(), { knipDirs: ['app'] }), failing.deps));
    expect(error.message).toContain(KNIP_DIR_ADVICE);
    expect(error.message).not.toContain(KNIP_ADVICE);
  });
});

// ---- Decay thresholds ----

describe('P6: with the default thresholds the output is what the analyser wrote before thresholds were configurable', () => {
  const goldenPath = fileURLToPath(new URL('../test/golden/default-thresholds.json', import.meta.url));
  const golden = readFileSync(goldenPath, 'utf8');
  const goldenRepo = build(goldenSteps);
  const unusedStub = harness(knipOk(...GOLDEN_UNUSED));

  const run = async (extra: Partial<PipelineOptions> = {}) => {
    const out = tempDir();
    const result = await runPipeline(
      { repoPath: goldenRepo.dir, outPath: join(out, 'g.json'), analysedAt: GOLDEN_ANALYSED_AT, cwd: out, ...extra },
      unusedStub.deps,
    );
    return { text: readFileSync(result.outPath, 'utf8'), graveyard: result.graveyard };
  };

  /** What version 1 wrote: no thresholds in the metadata, schema version 1, and the temporary directory's name masked. */
  const asVersion1 = (text: string): string => {
    const g = JSON.parse(text) as Graveyard;
    const meta = g.meta as unknown as Record<string, unknown>;
    delete meta['thresholds'];
    meta['schemaVersion'] = 1;
    meta['name'] = 'REPO';
    // The import graph's fields came later (importers spec): without them, the output is still the golden file byte for byte.
    for (const f of g.files as unknown as Array<Record<string, unknown>>) {
      delete f['importedBy'];
      delete f['entry'];
    }
    return `${JSON.stringify(g, null, 2)}\n`;
  };

  it('is byte for byte the golden file, once the new metadata fields are taken out', async () => {
    expect(asVersion1((await run()).text)).toBe(golden);
  });

  // The whole output, the import graph included, against a second golden file made on purpose: GOLDEN_WRITE=1 writes it.
  it('is byte for byte the golden file with the import graph (importers spec)', async () => {
    const path = fileURLToPath(new URL('../test/golden/with-importers.json', import.meta.url));
    const g = JSON.parse((await run()).text) as Graveyard;
    g.meta.name = 'REPO';
    const text = `${JSON.stringify(g, null, 2)}\n`;
    if (process.env['GOLDEN_WRITE'] === '1') writeFileSync(path, text);
    expect(text).toBe(readFileSync(path, 'utf8'));
    expect(g.files.every((f) => Array.isArray(f.importedBy))).toBe(true);
  });

  it('is the same when the default values are passed explicitly', async () => {
    const explicit = thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 5, hotWindowDays: 30 });
    expect(asVersion1((await run({ thresholds: explicit })).text)).toBe(golden);
  });

  it('is a golden file that covers every state, unused and hot files, a rename and a ghost', () => {
    const g = JSON.parse(golden) as Graveyard;
    expect(new Set(g.files.map((f) => f.decayState))).toEqual(new Set(['fresh', 'stale', 'ancient']));
    expect(g.files.some((f) => f.unused)).toBe(true);
    expect(g.files.some((f) => f.hot)).toBe(true);
    expect(g.files.map((f) => f.path)).toContain('src/moved.ts');
    expect(g.ghosts.map((x) => x.path)).toEqual(['ghost.ts']);
    // The edges: 89 days is fresh, 90 and 360 are stale, 361 is ancient.
    const state = (path: string) => g.files.find((f) => f.path === path)?.decayState;
    expect([state('src/at89.ts'), state('src/at90.ts'), state('src/at360.ts'), state('src/at361.ts')]).toEqual([
      'fresh',
      'stale',
      'stale',
      'ancient',
    ]);
  });

  it('writes the thresholds and schema version 2 into the metadata', async () => {
    const { graveyard } = await run();
    expect(graveyard.meta.schemaVersion).toBe(2);
    expect(graveyard.meta.thresholds).toEqual({
      staleAfterDays: 90,
      ancientAfterDays: 360,
      decayCapDays: 720,
      hotCommits: 5,
      hotWindowDays: 30,
    });
  });

  it('does not log a thresholds line when the defaults are used', async () => {
    const quiet = harness(knipOk());
    await runPipeline({ repoPath: goldenRepo.dir, outPath: join(tempDir(), 'g.json'), analysedAt: GOLDEN_ANALYSED_AT, cwd: tempDir() }, quiet.deps);
    expect(quiet.logs.some((m) => m.startsWith('Decay thresholds'))).toBe(false);
  });
});

describe('custom decay thresholds through the whole pipeline', () => {
  const goldenRepo = build(goldenSteps);
  const analyseWith = async (thresholds: PipelineOptions['thresholds']) => {
    const h = harness(knipOk(...GOLDEN_UNUSED));
    const out = tempDir();
    const { graveyard } = await runPipeline(
      { repoPath: goldenRepo.dir, outPath: join(out, 'g.json'), analysedAt: GOLDEN_ANALYSED_AT, cwd: out, thresholds },
      h.deps,
    );
    return { graveyard, logs: h.logs };
  };
  const byPath = (g: Graveyard, path: string) => g.files.find((f) => f.path === path)!;

  it('moves the edges between the states, and records the thresholds', async () => {
    // Ages: at89 89, at90 90, at360 360, at361 361, mid 148, old 415, a 0.
    const t = thresholdsFrom({ staleAfterDays: 100, ancientAfterDays: 300, hotCommits: 5, hotWindowDays: 30 });
    const { graveyard: g } = await analyseWith(t);
    expect(g.meta.thresholds).toEqual(t);
    expect(g.files.map((f) => [f.path, f.decayState])).toEqual([
      ['src/a.ts', 'fresh'],
      ['src/at360.ts', 'ancient'], // 360 > 300
      ['src/at361.ts', 'ancient'],
      ['src/at89.ts', 'fresh'],
      ['src/at90.ts', 'fresh'], // 90 < 100
      ['src/mid.ts', 'stale'], // 148
      ['src/mid2.ts', 'stale'],
      ['src/moved.ts', 'fresh'],
      ['src/old.ts', 'ancient'],
    ]);
  });

  it('applies the edges exactly: stale from staleAfterDays, ancient only after ancientAfterDays', async () => {
    const t = thresholdsFrom({ staleAfterDays: 89, ancientAfterDays: 90, hotCommits: 5, hotWindowDays: 30 });
    const { graveyard: g } = await analyseWith(t);
    expect(byPath(g, 'src/at89.ts').decayState).toBe('stale'); // 89 is the first stale day
    expect(byPath(g, 'src/at90.ts').decayState).toBe('stale'); // 90 is the last stale day
    expect(byPath(g, 'src/mid.ts').decayState).toBe('ancient'); // 148
  });

  it('caps the age score at twice ancientAfterDays', async () => {
    const t = thresholdsFrom({ staleAfterDays: 30, ancientAfterDays: 100, hotCommits: 5, hotWindowDays: 30 }); // cap 200
    const { graveyard: g } = await analyseWith(t);
    expect(byPath(g, 'src/at360.ts').decayScore).toBe(0.4); // 360 days, past the cap, not unused
    expect(byPath(g, 'src/at361.ts').decayScore).toBe(0.4);
    expect(byPath(g, 'src/at89.ts').decayScore).toBe(0.178); // 0.4 * 89 / 200
    expect(byPath(g, 'src/old.ts').decayScore).toBe(1); // unused, past the cap: 0.6 + 0.4
  });

  it('counts recent commits in the configured window and marks hot by the configured count', async () => {
    // src/a.ts was edited on Feb 16 to 20 at 09:00; the snapshot is Feb 20 at 10:00.
    const wide = await analyseWith(thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 6, hotWindowDays: 60 }));
    expect(byPath(wide.graveyard, 'src/a.ts')).toMatchObject({ recentCommits: 5, hot: false }); // 5 < 6

    const narrow = await analyseWith(thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 2, hotWindowDays: 2 }));
    expect(byPath(narrow.graveyard, 'src/a.ts')).toMatchObject({ recentCommits: 2, hot: true }); // Feb 19 and 20

    const tiny = await analyseWith(thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 2, hotWindowDays: 1 }));
    expect(byPath(tiny.graveyard, 'src/a.ts')).toMatchObject({ recentCommits: 1, hot: false }); // Feb 20 only
  });

  it('leaves everything that is not decay unchanged', async () => {
    const base = (await analyseWith(undefined)).graveyard;
    const other = (await analyseWith(thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 20, hotCommits: 5, hotWindowDays: 30 }))).graveyard;
    const strip = (g: Graveyard) => g.files.map(({ decayScore: _a, decayState: _b, ...rest }) => rest);
    expect(strip(other)).toEqual(strip(base));
    expect(other.folders).toEqual(base.folders);
    expect(other.ghosts).toEqual(base.ghosts);
  });

  it('logs the thresholds when they are not the defaults', async () => {
    const { logs } = await analyseWith(thresholdsFrom({ staleAfterDays: 30, ancientAfterDays: 200, hotCommits: 3, hotWindowDays: 14 }));
    expect(logs).toContain('Decay thresholds: stale after 30 days, ancient after 200, hot at 3 commits in 14 days');
  });
});

// ---- The import graph (importers spec) ----

describe('the import graph, end to end', () => {
  const w = (path: string, content: string) => ({ op: 'write' as const, path, content });
  const repo = build([
    {
      kind: 'commit',
      message: 'one',
      author: 'Ann',
      date: '2026-01-01T10:00:00+00:00',
      ops: [
        w('package.json', '{"name":"g","knip":{}}\n'),
        w('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] }, moduleResolution: 'bundler', module: 'esnext' } })),
        w('index.html', '<script type="module" src="/src/main.ts"></script>\n'),
        w('src/main.ts', "import { db } from '@/lib/db';\nimport type { T } from './types';\nexport const run = (t: T) => db + t;\n"),
        w('src/lib/db.ts', 'export const db = 1;\n'),
        w('src/types.ts', 'export type T = number;\n'),
        w('src/dead/section.ts', "import { card } from './card';\nexport const section = card;\n"),
        w('src/dead/card.ts', 'export const card = 1;\n'),
        w('src/live-dead.ts', "export const x = 1;\n"),
        w('src/uses-live-dead.ts', "import { x } from './live-dead';\nexport const y = x;\n"),
        w('src/lib/db.test.ts', "import { db } from './db';\nexport const t = db;\n"),
        w('vite.config.ts', 'export default {};\n'),
      ],
    },
  ]);

  it('writes importedBy and entry on every file, and reports where Knip and the graph disagree', async () => {
    const out = tempDir();
    // Knip says: the dead chain is unused, and so is live-dead.ts (wrongly: uses-live-dead.ts imports it, and is used).
    const h = harness(knipOk('src/dead/section.ts', 'src/dead/card.ts', 'src/live-dead.ts'));
    const { graveyard } = await runPipeline(optionsFor(repo, out), h.deps);
    const by = (p: string) => graveyard.files.find((f) => f.path === p)!;
    expect(by('src/lib/db.ts').importedBy).toEqual([{ path: 'src/lib/db.test.ts' }, { path: 'src/main.ts' }]);
    expect(by('src/types.ts').importedBy).toEqual([{ path: 'src/main.ts', typeOnly: true }]);
    expect(by('src/dead/card.ts').importedBy).toEqual([{ path: 'src/dead/section.ts' }]);
    expect(by('src/main.ts')).toMatchObject({ importedBy: [], entry: { kind: 'framework', label: 'Vite entry' } });
    expect(by('src/lib/db.test.ts').entry).toEqual({ kind: 'test', label: 'test' });
    expect(by('vite.config.ts').entry).toEqual({ kind: 'config', label: 'Vite config' });
    expect(by('src/lib/db.ts').entry).toBeUndefined();
    expect(h.logs.some((l) => /^Import graph: 5 imports among 9 files; 0 to packages, 0 outside the analysed files, 0 unresolved, 0 non-literal; 3 entry points\.$/.test(l))).toBe(true);
    expect(h.logs).toContain('  src/live-dead.ts is unused (Knip), but imported by src/uses-live-dead.ts, which is used');
    expect(h.logs).toContain("Used files nothing imports and that aren't entry points (1): src/uses-live-dead.ts");
    // The data follows Knip: the stone stays unused.
    expect(by('src/live-dead.ts').unused).toBe(true);
  });

  it('warns when the working tree differs from the snapshot, and keeps reading the snapshot', async () => {
    writeFileSync(join(repo.dir, 'src', 'lib', 'db.ts'), "import './changed';\nexport const db = 2;\n");
    try {
      const h = harness(knipOk());
      const { graveyard } = await runPipeline(optionsFor(repo, tempDir()), h.deps);
      expect(h.logs.some((l) => /^Warning: 1 analysed files differ in the working tree from the snapshot \(src\/lib\/db\.ts\)/.test(l))).toBe(true);
      expect(graveyard.files.find((f) => f.path === 'src/lib/db.ts')!.importedBy).toEqual([{ path: 'src/lib/db.test.ts' }, { path: 'src/main.ts' }]);
    } finally {
      execFileSync('git', ['-C', repo.dir, 'checkout', '-q', '--', 'src/lib/db.ts']);
    }
  });
});
