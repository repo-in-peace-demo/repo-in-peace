/**
 * The published command, `repo-in-peace` (npx repo-in-peace <repo-path> ...). Always runs `main`: cli.ts's own check for being the
 * entry point compares the script path, which through npx is a symlink in node_modules/.bin, not this file.
 */
import { main } from './cli';

main(process.argv.slice(2), {
  stderr: (text) => void process.stderr.write(text),
  cwd: process.cwd(),
  now: () => new Date().toISOString(),
}).then((code) => {
  process.exitCode = code;
});
