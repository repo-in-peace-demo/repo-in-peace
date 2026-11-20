import fc from 'fast-check';
import type { Row } from '../src/model/list-rows';

/** Rows of the list view for property tests: files of every state and flag, and ghosts; unique paths. */
const segment = fc.stringMatching(/^[a-zA-Z0-9_.-]{1,8}$/);

export const rowArb: fc.Arbitrary<Row> = fc
  .record({
    folder: fc.array(segment, { maxLength: 3 }).map((s) => s.join('/')),
    name: segment,
    ghost: fc.boolean(),
    state: fc.constantFrom('fresh', 'stale', 'ancient' as const),
    unused: fc.boolean(),
    hot: fc.boolean(),
    lines: fc.integer({ min: 0, max: 5000 }),
    age: fc.integer({ min: 0, max: 900 }),
    decay: fc.integer({ min: 0, max: 20 }).map((n) => n / 20), // few values, so ties happen
    deletedDay: fc.integer({ min: 1, max: 9 }),
  })
  .map(({ folder, name, ghost, state, unused, hot, lines, age, decay, deletedDay }): Row => {
    const path = folder === '' ? name : `${folder}/${name}`;
    return ghost
      ? { kind: 'ghost', path, name, folder, state: null, unused: false, hot: false, lines: null, age, decay: null, deleted: `2026-08-0${deletedDay}T00:00:00.000Z` }
      : { kind: 'file', path, name, folder, state, unused, hot, lines, age, decay, deleted: null };
  });

export const rowsArb = (maxLength = 40): fc.Arbitrary<Row[]> => fc.uniqueArray(rowArb, { selector: (r) => r.path, maxLength });
