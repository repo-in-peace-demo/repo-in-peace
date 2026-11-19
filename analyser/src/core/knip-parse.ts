/**
 * Reads the output of `knip --reporter json --include files`. Pure.
 *
 * Current shape (Knip 5.x docs): one JSON object, `{ "issues": [ { "file": "src/legacy.ts",
 * "files": [ { "name": "src/legacy.ts" } ], ... }, ... ] }`. An entry whose `files` array is
 * non-empty means Knip reports that file as unused. Other issue-type arrays (exports, types,
 * dependencies, ...) are ignored: "unused" here means unused files only.
 *
 * Older shape: a top-level `"files": ["a.ts", ...]` array of unused paths, next to `issues`.
 * Both are read and combined.
 */

export class KnipOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnipOutputError';
  }
}

/** Repo-relative, forward-slash paths of the files Knip reports as unused. */
export function parseKnipOutput(stdout: string): Set<string> {
  const json = parseJson(stdout);

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new KnipOutputError('Knip JSON output is not an object');
  }
  const root = json as Record<string, unknown>;
  const issues = root['issues'];
  if (!Array.isArray(issues)) {
    throw new KnipOutputError('Knip JSON output has no "issues" array');
  }

  const unused = new Set<string>();

  const oldStyleFiles = root['files'];
  if (Array.isArray(oldStyleFiles)) {
    for (const entry of oldStyleFiles) {
      if (typeof entry === 'string') unused.add(normalise(entry));
    }
  }

  issues.forEach((issue: unknown, i) => {
    if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) {
      throw new KnipOutputError(`Knip JSON output: issues[${i}] is not an object`);
    }
    const record = issue as Record<string, unknown>;
    const files = record['files'];
    if (!Array.isArray(files) || files.length === 0) return;

    const file = record['file'];
    if (typeof file === 'string' && file !== '') {
      unused.add(normalise(file));
      return;
    }
    // No `file` on the entry: fall back to the names inside `files`.
    let found = false;
    for (const item of files) {
      const name = typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name;
      if (typeof name === 'string' && name !== '') {
        unused.add(normalise(name));
        found = true;
      }
    }
    if (!found) throw new KnipOutputError(`Knip JSON output: issues[${i}] lists unused files but names none`);
  });

  return unused;
}

/** Knip prints one line of JSON. If something else was printed before it, the last non-empty line is tried. */
function parseJson(stdout: string): unknown {
  const text = stdout.trim();
  if (text === '') throw new KnipOutputError('Knip printed nothing to stdout');
  try {
    return JSON.parse(text);
  } catch {
    const lastLine = text.split('\n').filter((l) => l.trim() !== '').pop() ?? '';
    try {
      return JSON.parse(lastLine);
    } catch {
      throw new KnipOutputError(`Knip output is not valid JSON (starts with: ${text.slice(0, 80)})`);
    }
  }
}

function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
