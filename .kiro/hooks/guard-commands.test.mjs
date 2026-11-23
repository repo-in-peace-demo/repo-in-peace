// Checks the guard's rules against commands from this project's sessions. Run: node .kiro/hooks/guard-commands.test.mjs
import assert from 'node:assert/strict';
import { blockedReason } from './guard-commands.mjs';

const blocked = [
  'npm test',
  'cd analyser && npm test',
  'cd frontend && npm test && npm run e2e',
  'npm run e2e',
  'npm run e2e:quick',
  'npx vitest run',
  'npx vitest',
  'npx vitest run src', // a whole tree is the suite: this one was run in this project, once, by Kiro
  'npx vitest run --reporter=dot',
  'npx playwright test',
  'npx playwright test --grep-invert @slow',
  'npm install',
  'npm i -D fast-check',
  'npm ci',
  'npx playwright install chromium',
  'npm run build',
  'npx vite build',
  'npx tsc -p .',
  'vercel --prod',
  'cd .. && vercel --prod',
  'git push origin main',
  'GOLDEN_WRITE=1 npm test',
];
const allowed = [
  'npx tsc --noEmit',
  'npx tsc --noEmit -p .',
  'npm run typecheck',
  'npx vitest run src/model/usage',
  'npx vitest run src/pipeline.test src/cli.test',
  'npx vitest run src/core/eulogy-clean.property --seed 3',
  'GOLDEN_WRITE=1 npx vitest run src/pipeline.test -t "with the import graph"',
  'npx vitest run -t "P4" src/e2e.property',
  'npx playwright test e2e/gravedigger.spec.ts --reporter=line',
  'npx playwright test e2e/importers.spec.ts e2e/interface.spec.ts --grep-invert @slow',
  'npm test -- src/model/usage',
  'npm run e2e -- e2e/sky.spec.ts',
  'git status --short',
  'git commit -qm "npm test later"',
  'grep -n "npm install" README.md',
];
for (const c of blocked) assert.notEqual(blockedReason(c), null, `should block: ${c}`);
for (const c of allowed) assert.equal(blockedReason(c), null, `should allow: ${c}`);
console.log(`guard-commands: ${blocked.length} blocked and ${allowed.length} allowed as expected`);
