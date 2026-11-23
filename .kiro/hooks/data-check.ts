/**
 * Run by data-check.mjs (a postToolUse hook) through the analyser's tsx: validates both demo graveyard files against the shared schema
 * (`validateGraveyard`, which also checks that every importer is a file of the data). Prints one summary line; exits 1 with the
 * problems on stderr.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGraveyard } from '../../shared/graveyard-schema';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMOS = ['demo.oikosledger', 'demo.spatialql'];
const problems: string[] = [];
const ok: string[] = [];
for (const name of DEMOS) {
  const path = join(ROOT, 'frontend', 'public', 'graveyards', `${name}.graveyard.json`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`${name}: not readable JSON (${(e as Error).message})`);
    continue;
  }
  const result = validateGraveyard(data);
  if (!result.ok) {
    problems.push(`${name}: ${result.errors.length} schema errors:\n  ${result.errors.slice(0, 10).join('\n  ')}`);
    continue;
  }
  const g = data as { files: Array<{ eulogy: string }>; ghosts: unknown[] };
  ok.push(`${name} valid (${g.files.length} files, ${g.ghosts.length} ghosts, ${g.files.filter((f) => f.eulogy === '').length} empty eulogies)`);
}
if (problems.length > 0) {
  process.stderr.write(`data-check: ${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`data-check: ${ok.join('; ')}\n`);
