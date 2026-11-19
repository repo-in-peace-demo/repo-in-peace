import type { Step } from './make-repo';

/**
 * A fixed repository covering every decay state and the edges between them, used to pin
 * the analyser's output. `golden/default-thresholds.json` was produced by the analyser as it was
 * before decay thresholds became configurable; with default thresholds the output must stay the same.
 *
 * Snapshot: 2026-02-20T10:00:00Z (the last commit). Ages of the files at the snapshot:
 *   src/at89.ts 89 days (fresh), src/at90.ts 90 (stale), src/at360.ts 360 (stale), src/at361.ts 361 (ancient),
 *   src/mid.ts and src/mid2.ts 148 (stale), src/old.ts 415 (ancient), src/a.ts 0 (fresh, hot).
 */

export const GOLDEN_ANALYSED_AT = '2026-03-02T09:30:00.000Z';

/** What the Knip stub reports as unused, relative to the clone root. */
export const GOLDEN_UNUSED = ['src/old.ts', 'src/mid.ts', 'src/at90.ts', 'dist/skip.js'];

const add = (message: string, author: string, date: string, path: string, content: string): Step => ({
  kind: 'commit',
  message,
  author,
  date,
  ops: [{ op: 'write', path, content }],
});

export const goldenSteps: Step[] = [
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
  add('mid', 'Di', '2025-09-25T10:00:00+00:00', 'src/mid.ts', 'export const mid = 1;\n'),
  add('mid2', 'Di', '2025-09-25T10:00:00+00:00', 'src/mid2.ts', 'export const mid2 = 1;\nexport const more = 2;\n'),
  add('at361', 'Eve', '2025-02-24T10:00:00+00:00', 'src/at361.ts', 'export const at361 = 1;\n'),
  add('at360', 'Eve', '2025-02-25T10:00:00+00:00', 'src/at360.ts', 'export const at360 = 1;\n'),
  add('at90', 'Fay', '2025-11-22T10:00:00+00:00', 'src/at90.ts', 'export const at90 = 1;\n'),
  add('at89', 'Fay', '2025-11-23T10:00:00+00:00', 'src/at89.ts', 'export const at89 = 1;\n'),
  ...[16, 17, 18, 19, 20].map((day) =>
    add(`edit a on ${day}`, 'Cy', `2026-02-${day}T09:00:00+00:00`, 'src/a.ts', `export const a = ${day};\n\n// note\n`),
  ),
  {
    kind: 'commit',
    message: 'rename b',
    author: 'Di',
    date: '2026-02-20T10:00:00+00:00',
    ops: [{ op: 'rename', from: 'src/b.ts', to: 'src/moved.ts' }],
  },
];
