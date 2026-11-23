import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORMER_EXAMPLES, cleanEulogy, contradictsFacts, copiesExample, quotesBalanced, rejectReason, sentencesOf, statesTime, stripReasoning, withoutTimeSentences, wrongStatedAge } from './eulogy-clean';
import type { EulogyInput } from './eulogy-input';
import { EULOGY_MAX_CHARS } from './eulogy-prompt';
import type { People } from './history';

const nobody: People = { names: new Set(), emails: new Set() };
const people: People = { names: new Set(['Ann Author', 'Bob']), emails: new Set(['carol@example.com']) };
const clean = (raw: string, p: People = nobody) => cleanEulogy(raw, { people: p });
const GOOD = 'Here lies the voice hook, which listened for a call that never came. It rests now in perfect silence.';

/** Prose: words, punctuation, line breaks, markdown, quotes and emoji, in any mix. */
const prose = fc
  .array(
    fc.oneof(
      fc.stringMatching(/^[A-Za-z]{1,12}$/),
      fc.constantFrom('.', '!', '?', ',', ' ', '\n', '\n\n', '**', '*', '_', '# ', '- ', '> ', '"', '“', '”', "'", '🕯️', '👻', 'index.ts', 'Here', 'It', 'The'),
    ),
    { maxLength: 120 },
  )
  .map((parts) => parts.join(' '));

describe('P1: the format', () => {
  it('an accepted eulogy is at most two whole sentences and 240 characters, on one line, with no markdown, no wrapping or open quotes', () => {
    fc.assert(
      fc.property(prose, (raw) => {
        const r = clean(raw);
        if (!r.ok) return true;
        const t = r.text;
        return (
          Array.from(t).length <= EULOGY_MAX_CHARS &&
          !/[\n\r]/.test(t) &&
          sentencesOf(t).length <= 2 &&
          !/^[#>\-*•]\s/.test(t) &&
          !t.includes('**') &&
          !/^["'“”‘’«»]/.test(t) &&
          quotesBalanced(t) &&
          /[.!?]["”’»]?$/u.test(t) &&
          !/\p{Extended_Pictographic}/u.test(t) &&
          t === t.trim() &&
          !/\s{2,}/.test(t)
        );
      }),
      { numRuns: Number(process.env.EULOGY_RUNS ?? 500) },
    );
  });

  it('cleans the usual wrappings of a good answer to the answer', () => {
    expect(clean(GOOD)).toEqual({ ok: true, text: GOOD });
    expect(clean(`"${GOOD}"`)).toEqual({ ok: true, text: GOOD });
    expect(clean(`Epitaph: **${GOOD}**`)).toEqual({ ok: true, text: GOOD });
    expect(clean(`> ${GOOD.replace('. ', '.\n')} 🕯️`)).toEqual({ ok: true, text: GOOD });
    expect(clean(`${GOOD} A third sentence goes. And a fourth.`)).toEqual({ ok: true, text: GOOD });
    expect(clean('index.ts kept the lanterns lit.')).toEqual({ ok: true, text: 'index.ts kept the lanterns lit.' });
  });

  it('keeps whole sentences: both when they fit, the first alone when two are too long, and rejects one sentence that is too long', () => {
    const first = `The night porter ${'walks the paths '.repeat(6).trim()} at dusk.`;
    const second = `It ${'keeps every flame '.repeat(8).trim()} burning.`;
    expect(clean(`${first} It rests.`)).toEqual({ ok: true, text: `${first} It rests.` });
    expect(Array.from(`${first} ${second}`).length).toBeGreaterThan(EULOGY_MAX_CHARS);
    expect(clean(`${first} ${second}`)).toEqual({ ok: true, text: first });
    expect(clean(`The keeper ${'waited and '.repeat(30)}waited.`)).toEqual({ ok: false, reason: 'long' });
  });

  // The words are random, so a sentence can state a time ("Aa ago!", seed 375800081): the time-agnostic rule drops it first, and the
  // eulogy is whole sentences of what is left.
  it('whatever the length, an accepted eulogy is whole sentences of the answer, never cut inside one', () => {
    const sentence = fc.stringMatching(/^[A-Z][a-z]{1,8}( [a-z]{1,8}){0,30}[.!?]$/);
    fc.assert(
      fc.property(fc.array(sentence, { minLength: 1, maxLength: 4 }), (sentences) => {
        const kept = sentences.filter((s) => !statesTime(s));
        const r = clean(sentences.join(' '));
        if (kept.length === 0) return !r.ok && r.reason === 'empty';
        if (!r.ok) return r.reason === 'long' && Array.from(kept[0]!).length > EULOGY_MAX_CHARS;
        return r.text === kept.slice(0, sentencesOf(r.text).length).join(' ');
      }),
    );
  });

  it('drops a sentence that states a time before keeping whole sentences (the counterexample above)', () => {
    expect(clean('Aa ago! Aa.')).toEqual({ ok: true, text: 'Aa.' });
    expect(clean('Aa ago!')).toEqual({ ok: false, reason: 'empty' });
  });

  it('ends an answer that has no closing stop with one', () => {
    expect(clean('The keeper watches the gate')).toEqual({ ok: true, text: 'The keeper watches the gate.' });
  });

  it('rejects an answer with nothing left', () => {
    expect(clean('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(clean('"" 🕯️ **')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('P2: rejection', () => {
  const bad = {
    code: fc.constantFrom('`x`', 'useEffect()', 'a => b', '{ ok }', 'done; then', 'const x = 1', 'import foo from', 'function go(', 'class Grave {', 'require("x")'),
    url: fc.constantFrom('https://example.org', 'http://x', 'www.example.com', 'example.com', 'docs.dev/x', 'my-site.io'),
    secret: fc.constantFrom('a'.repeat(4) + '0123456789abcdef0123456789abcdef', 'ghp_' + 'A1'.repeat(10), 'AKIAIOSFODNN7EXAMPLE', 'sk-abc123', 'eyJhbGciOi.eyJzdWIiOi', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldY0123', '-----BEGIN KEY'),
    email: fc.constantFrom('a@b.io', 'someone.else@mail.example.org'),
    author: fc.constantFrom('Bob', 'ann author', 'carol', 'BOB'),
  } as const;

  for (const [reason, arb] of Object.entries(bad)) {
    it(`rejects any answer with a ${reason}-like string in it, wherever it is`, () => {
      fc.assert(
        fc.property(arb, fc.nat(GOOD.length), (piece, at) => {
          const raw = `${GOOD.slice(0, at)} ${piece} ${GOOD.slice(at)}`;
          const r = clean(raw, people);
          return !r.ok;
        }),
        { numRuns: 150 },
      );
    });
  }

  it('names the reason', () => {
    expect(rejectReason('it called useEffect() once', nobody)).toBe('code');
    expect(rejectReason('see https://x.org', nobody)).toBe('url');
    expect(rejectReason('key AKIAIOSFODNN7EXAMPLE here', nobody)).toBe('secret');
    expect(rejectReason('write to a@b.io', nobody)).toBe('email');
    expect(rejectReason('Bob wrote it', people)).toBe('author');
  });

  it('allows the file\'s own name and its path, and plain words that look like keywords', () => {
    for (const ok of [
      'index.ts kept the lanterns lit.',
      'Here lies app/lib/db/queries/recommendations.ts, which suggested more than anyone asked. It rests unread.',
      'Let it rest; no.'.replace(';', ','),
      'It returned to dust, a class of its own. Let it rest.',
      'It would import nothing and export only silence.',
    ]) {
      expect(rejectReason(ok, nobody), ok).toBeNull();
    }
  });
});

describe('P11: reasoning blocks', () => {
  it('never reach a eulogy: closed, unclosed or upper-case, before or around the answer', () => {
    const thought = fc.stringMatching(/^[a-z ]{0,40}$/);
    fc.assert(
      fc.property(fc.constantFrom('think', 'thinking', 'THINK', 'Thinking'), thought, fc.constantFrom('closed', 'unclosed', 'stray-close'), (tag, inner, form) => {
        const raw =
          form === 'closed' ? `<${tag}>${inner} useEffect() maybe</${tag}>\n${GOOD}` : form === 'unclosed' ? `${GOOD}\n<${tag}>${inner}` : `${inner} useEffect()</${tag}>${GOOD}`;
        const r = clean(raw);
        return form === 'unclosed' ? (r.ok ? r.text === GOOD : false) : r.ok && r.text === GOOD;
      }),
      { numRuns: 200 },
    );
  });

  it('leaves nothing when the whole answer is an unclosed block', () => {
    expect(stripReasoning('<think>I should mention the lanterns')).toBe('');
    expect(clean('<think>I should mention the lanterns')).toEqual({ ok: false, reason: 'empty' });
    expect(clean('<think>I should mention the lanterns…</think>Here lies the router, which kept every path in order. It never once got lost.')).toEqual({
      ok: true,
      text: 'Here lies the router, which kept every path in order. It never once got lost.',
    });
  });
});

describe('quotes', () => {
  it('rejects an answer that leaves a quote open', () => {
    expect(clean('In frames it whispered, "Fade, unfold. It never finished.')).toEqual({ ok: false, reason: 'quotes' });
    expect(clean('It said “wait” and then “go. It went.')).toEqual({ ok: false, reason: 'quotes' });
    expect(clean('“Fade,” it said, and the lamp went out.')).toEqual({ ok: false, reason: 'quotes' });
  });

  it('keeps a quotation that ends the eulogy, and removes quotes around the whole of it', () => {
    expect(clean('It never spoke. Once it whispered, "Fade."')).toEqual({ ok: true, text: 'It never spoke. Once it whispered, "Fade."' });
    expect(clean('"It kept the gate. It still does."')).toEqual({ ok: true, text: 'It kept the gate. It still does.' });
    expect(clean('“It kept the gate.')).toEqual({ ok: true, text: 'It kept the gate.' });
  });

  it('keeps apostrophes, which are not quotes', () => {
    expect(clean("'Twas the keeper's lamp that lit the way.")).toEqual({ ok: true, text: "Twas the keeper's lamp that lit the way." });
  });
});

describe('line breaks', () => {
  const input = (contents: string): EulogyInput => ({
    kind: 'file', path: 'src/recenter-trigger.ts', name: 'recenter-trigger.ts', state: 'Fresh', flags: [], lines: 9, subject: 'x',
    contents: { text: contents, cut: false, kind: 'text' }, decayState: 'fresh', unused: false, ageDays: 3,
  });

  it('joins a line broken inside a sentence, with no capital in the middle', () => {
    expect(cleanEulogy('The trigger waits,\nMocking the headset as it turns.', { people: nobody, input: input('') })).toEqual({
      ok: true,
      text: 'The trigger waits, mocking the headset as it turns.',
    });
    expect(clean('The fetcher, once swift and sure,\nNow steady, its task forever pure.')).toEqual({ ok: true, text: 'The fetcher, once swift and sure, now steady, its task forever pure.' });
  });

  it('keeps the capital of a name the file itself spells that way, and of "I"', () => {
    expect(cleanEulogy('It waits for the\nMeta button and the headset.', { people: nobody, input: input('// the Meta button\n') })).toEqual({
      ok: true,
      text: 'It waits for the Meta button and the headset.',
    });
    expect(clean('It said that\nI would see it again.')).toEqual({ ok: true, text: 'It said that I would see it again.' });
  });

  it('leaves a break after a full sentence as a new sentence', () => {
    expect(clean('The trigger waits.\nIt never sleeps.')).toEqual({ ok: true, text: 'The trigger waits. It never sleeps.' });
  });

  it('never leaves a capital after a comma that the answer broke a line at', () => {
    const word = fc.stringMatching(/^[A-Z][a-z]{2,8}$/);
    fc.assert(
      fc.property(word, (w) => {
        const r = cleanEulogy(`The keeper waits,\n${w} the gate at night.`, { people: nobody, input: input('') });
        return r.ok && r.text === `The keeper waits, ${w.toLowerCase()} the gate at night.`;
      }),
    );
  });
});

describe('the facts of the grave', () => {
  const fileOf = (decayState: 'fresh' | 'stale' | 'ancient', unused: boolean, ageDays = 30): EulogyInput => ({
    kind: 'file', path: 'app/lib/logger.ts', name: 'logger.ts', state: decayState, flags: [], lines: 40, subject: 'x',
    contents: { text: 'export const log = 1;\n', cut: false, kind: 'text' }, decayState, unused, ageDays,
  });
  const ghost: EulogyInput = { kind: 'ghost', path: 'src/old.ts', name: 'old.ts', deletedDay: '2026-01-01', subject: 'x', contents: { text: '', cut: false, kind: 'empty' } };
  const check = (text: string, input: EulogyInput) => cleanEulogy(text, { people: nobody, input });

  it('rejects "unused" and its like for a used file, and allows them for an unused one', () => {
    for (const claim of ['Though old and unused, its cries still echo.', 'It lies unused in the dark.', 'It is no longer used by anyone.', 'Nothing imports it now.', 'It was never used.']) {
      expect(check(claim, fileOf('stale', false)), claim).toEqual({ ok: false, reason: 'facts' });
      expect(check(claim, fileOf('ancient', true)).ok, claim).toBe(true);
    }
  });

  it('allows "unused" when it is not about the file', () => {
    for (const ok of ['It swept away unused imports every night.', 'It was never unused, not for a day.', 'It kept count of unused slots and empty cells.', 'It was far from unused.']) {
      expect(check(ok, fileOf('fresh', false)), ok).toEqual({ ok: true, text: ok });
    }
  });

  it('rejects "ancient" for a file that is not ancient, and allows it for one that is', () => {
    for (const claim of ['Though ancient, it still serves.', 'The ancient router keeps the paths.']) {
      expect(check(claim, fileOf('stale', false)), claim).toEqual({ ok: false, reason: 'facts' });
      expect(check(claim, fileOf('fresh', true)), claim).toEqual({ ok: false, reason: 'facts' });
      expect(check(claim, fileOf('ancient', false)).ok, claim).toBe(true);
    }
  });

  it('allows "ancient" when it is not about the file', () => {
    for (const ok of ['It keeps the ancient art of counting days.', 'It is far from ancient, and keeps the clock.', 'It is not ancient yet, only careful.', 'Its rules read like ancient lore.']) {
      expect(check(ok, fileOf('fresh', false)), ok).toEqual({ ok: true, text: ok });
    }
  });

  it('rejects a living file called forgotten, silent or dormant, and allows those words for old, unused and deleted files', () => {
    for (const dead of ['It lies forgotten by the gate.', 'Now silent, it waits.', 'Its functions lie dormant.']) {
      expect(check(dead, fileOf('fresh', false)), dead).toEqual({ ok: false, reason: 'facts' });
      expect(check(dead, fileOf('fresh', true)).ok, dead).toBe(true);
      expect(check(dead, fileOf('ancient', true)).ok, dead).toBe(true);
      expect(check(dead, ghost).ok, dead).toBe(true);
    }
    expect(check('It works silently through the night.', fileOf('fresh', false)).ok).toBe(true);
    expect(check('The session clock keeps time, never forgotten. It pauses only when asked.', fileOf('fresh', false)).ok).toBe(true);
    expect(check('It is not dormant, only patient.', fileOf('fresh', false)).ok).toBe(true);
  });

  it('any claim of "unused" put into a good eulogy of a used file rejects it; of an unused file it does not', () => {
    const GOOD_ALIVE = 'The keeper watches every gate at night. No traveller passes unseen.';
    fc.assert(
      fc.property(fc.constantFrom('Though unused,', 'Unused,', 'Now unused,', 'Lying unused,'), fc.constantFrom('stale', 'ancient') as fc.Arbitrary<'stale' | 'ancient'>, (claim, state) => {
        const raw = `${claim} ${GOOD_ALIVE[0]!.toLowerCase()}${GOOD_ALIVE.slice(1)}`;
        const used = check(raw, fileOf(state, false));
        const unused = check(raw, fileOf(state, true));
        return !used.ok && used.reason === 'facts' && unused.ok;
      }),
    );
  });

  it('the fact check (kept behind the time rule) counts years, ages and time immemorial as wrong for a file under a year old', () => {
    for (const claim of [
      'It has stood watch for decades.',
      'The guardian has watched these paths for years.',
      'It has served since time immemorial.',
      'It has kept the gate since ancient times.',
      'It has waited for ages by the gate.',
      'It has stood here since the dawn of time.',
      'It was written years ago and still serves.',
      'Its words have not changed in aeons.',
      'It has kept watch over many years.',
    ]) {
      for (const [state, unused] of [['stale', false], ['ancient', false], ['ancient', true], ['fresh', false]] as const) {
        expect(contradictsFacts(claim, fileOf(state, unused, 364)), `${claim} at 364 days`).toBe(true);
      }
      expect(contradictsFacts(claim, fileOf('ancient', false, 365)), `${claim} at 365 days`).toBe(false);
      expect(check(claim, fileOf('stale', false, 40)), 'and cleaning drops it as a time sentence').toEqual({ ok: false, reason: 'empty' });
    }
  });

  it('allows words about time that claim no age', () => {
    for (const ok of ['It counts the years of every account.', 'It keeps the ages of the users.', 'It waits through the night for the next query.', 'It was weathered by many seasons of change.']) {
      expect(check(ok, fileOf('stale', false, 40)), ok).toEqual({ ok: true, text: ok });
    }
  });

  it('has nothing to contradict for a ghost', () => {
    expect(contradictsFacts('An ancient, unused, forgotten thing.', ghost)).toBe(false);
  });
});

describe('copies of the examples', () => {
  it('rejects any former example, whole or in part', () => {
    for (const example of FORMER_EXAMPLES) expect(clean(example)).toEqual({ ok: false, reason: 'example' });
    expect(clean('Every dawn the query route still guides the comparison. No ghost has ever caught it napping.')).toEqual({ ok: false, reason: 'example' });
    expect(clean('Every dusk the lantern keeper still lights the paths, and travelers find their way because of it.')).toEqual({ ok: false, reason: 'example' });
    expect(clean('The router, a lantern keeper of requests, guides each call.')).toEqual({ ok: false, reason: 'example' });
  });

  it('allows four words in a row from one, and common words', () => {
    expect(copiesExample('No ghost has ever doubted it. The router guides every call.')).toBe(false);
    expect(copiesExample('It lit every path through the accounts at dusk.')).toBe(false);
  });

  it('any five words in a row from an example, put into a good eulogy, reject it', () => {
    const runs = FORMER_EXAMPLES.flatMap((e) => {
      const words = e.replace(/[.,:]/g, '').split(' ');
      return words.slice(0, words.length - 4).map((_, i) => words.slice(i, i + 5).join(' '));
    });
    fc.assert(
      fc.property(fc.constantFrom(...runs), (run) => {
        const r = clean(`The router guides each call, and ${run.toLowerCase()} all night.`);
        return !r.ok && r.reason === 'example';
      }),
    );
  });
});

describe('a file name written as a heading', () => {
  it('is removed, on its own line, before a colon or dash, or before a capital', () => {
    expect(clean('daily-flow.test.ts\nEvery dawn it checks the puzzles.')).toEqual({ ok: true, text: 'Every dawn it checks the puzzles.' });
    expect(clean('ComparePanel.tsx\nEvery dawn it still watches over accounts.')).toEqual({ ok: true, text: 'Every dawn it still watches over accounts.' });
    expect(clean('surface-placement.ts Once the placement rule kept slabs in order.')).toEqual({ ok: true, text: 'Once the placement rule kept slabs in order.' });
    expect(clean('**src/data/daily.ts**: The day keeper counts the puzzles.')).toEqual({ ok: true, text: 'The day keeper counts the puzzles.' });
    expect(clean('"index.ts" — It gathers every export.')).toEqual({ ok: true, text: 'It gathers every export.' });
  });

  it('stays when it is the subject of the first sentence', () => {
    expect(clean('route.ts has marked these paths, and it still guides travellers.')).toEqual({ ok: true, text: 'route.ts has marked these paths, and it still guides travellers.' });
    expect(clean('Challenge-system.ts, puzzle master, guides the quest.')).toEqual({ ok: true, text: 'Challenge-system.ts, puzzle master, guides the quest.' });
  });

  it('does not lowercase the word after a file name that ends a line', () => {
    expect(clean('It guides the requests of route.ts\nEvery call finds its way.')).toEqual({ ok: true, text: 'It guides the requests of route.ts Every call finds its way.' });
  });

  it('for any source file name as a heading, the eulogy is the text after it', () => {
    const name = fc.stringMatching(/^[a-zA-Z][a-zA-Z-]{0,12}(\.test)?\.(ts|tsx|js|mjs)$/);
    const sep = fc.constantFrom('\n', '\n\n', ': ', ' — ', ' ');
    fc.assert(fc.property(name, sep, (n, s) => {
      const r = clean(`${n}${s}Every night it keeps the gate.`);
      return r.ok && r.text === 'Every night it keeps the gate.';
    }));
  });
});

describe('cleaning version 4', () => {
  const fileOf = (ageDays: number, unused = false, contents = 'export const log = 1;\n'): EulogyInput => ({
    kind: 'file', path: 'src/data/join.ts', name: 'join.ts', state: 'x', flags: [], lines: 40, subject: 'x',
    contents: { text: contents, cut: false, kind: 'text' }, decayState: ageDays > 45 ? 'ancient' : ageDays > 21 ? 'stale' : 'fresh', unused, ageDays,
  });
  const ghost: EulogyInput = { kind: 'ghost', path: 'src/old.ts', name: 'old.ts', deletedDay: '2026-01-01', subject: 'x', contents: { text: '', cut: false, kind: 'empty' } };
  const check = (text: string, input: EulogyInput) => cleanEulogy(text, { people: nobody, input });

  describe('(1) ages', () => {
    it('rejects years with a number word or "the" before them, for a file under a year old', () => {
      for (const claim of ['Its purpose unaltered for two decades.', 'It stands steadfast despite the years.', 'It has guided us through the years.', 'It has kept watch for 3 centuries.']) {
        expect(contradictsFacts(claim, fileOf(20)), claim).toBe(true);
        expect(contradictsFacts(claim, fileOf(400)), claim).toBe(false);
      }
    });

    it('rejects a number of days, weeks or months that is not the file\'s age', () => {
      const cases: Array<[string, number, boolean]> = [
        ['Last updated 17 days ago, it keeps watch.', 17, true],
        ['Last updated 17 days ago, it keeps watch.', 18, true],
        ['Last updated 17 days ago, it keeps watch.', 20, false],
        ['Forty days and nights have passed since it changed.', 16, false],
        ['Forty days and nights have passed since it changed.', 40, true],
        ['It has watched for over a month.', 20, false],
        ['It has watched for over a month.', 31, true],
        ['It has watched for over two months.', 65, true],
        ['It changed a fortnight ago.', 14, true],
        ['It changed a fortnight ago.', 30, false],
        ['Six days young, it keeps the clock.', 6, true],
        ['Six days young, it keeps the clock.', 60, false],
        ['It counts the commits in the last 30 days.', 3, true],
        ['It was never unused, not for a day.', 30, true],
        ['It keeps a month of balances.', 3, true],
        ['Twenty-three days have passed since it last changed.', 23, true],
        ['Twenty-three days have passed since it last changed.', 40, false],
      ];
      for (const [text, age, ok] of cases) expect(wrongStatedAge(text, age), `${text} at ${age} days`).toBe(!ok);
    });

    it('for any age, the true number of days is accepted and one off by more than a day is not', () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 360 }), fc.integer({ min: 2, max: 50 }), (age, off) => {
          return !wrongStatedAge(`Last changed ${age} days ago, it still keeps the gate.`, age) && wrongStatedAge(`Last changed ${age + off} days ago, it still keeps the gate.`, age);
        }),
      );
    });
  });

  describe('(2) echoes of the prompt', () => {
    it('rejects the prompt\'s labels and instructions in the answer', () => {
      for (const echo of [
        'Begin by speaking to the file directly and keep the tone alive.',
        'It stands firm. State: stale and steady, it waits.',
        'Mourned like a real grave, it rests undisturbed.',
        'It keeps watch. Flags: none, so it stays.',
        'Opening: it guards the gate.',
      ]) {
        expect(clean(echo), echo).toEqual({ ok: false, reason: 'prompt' });
      }
    });

    it('allows the same words used plainly', () => {
      for (const ok of ['It keeps the age of every account.', 'It sets the opening hours of the gate.', 'Its state is kept with care.']) expect(clean(ok), ok).toEqual({ ok: true, text: ok });
    });
  });

  describe('(3) "here lies" only for the unused and the deleted', () => {
    it('rejects mourning words for a used file, and allows them for an unused file and a ghost', () => {
      for (const mourning of ['Here lies utils.ts, weathered but still in use.', 'It rests in peace among the living.', 'Laid to rest, it still serves.', 'R.I.P. old button.']) {
        expect(check(mourning, fileOf(65)), mourning).toEqual({ ok: false, reason: 'facts' });
        expect(check(mourning, fileOf(65, true)).ok, mourning).toBe(true);
        expect(check(mourning, ghost).ok, mourning).toBe(true);
      }
      expect(check('It rests a moment, then works again.', fileOf(5)).ok).toBe(true);
    });
  });

  describe('(4) copies of the contents', () => {
    const doc = '/**\n * Shared CockroachDB Managed MCP Server client: server-side only, never import into a client file.\n */\nexport const client = 1;\n';
    it('rejects eight words in a row from the file\'s contents, and allows seven', () => {
      expect(check('Shared CockroachDB Managed MCP Server client: server-side only, it connects.', fileOf(30, false, doc))).toEqual({ ok: false, reason: 'contents' });
      expect(check('A shared CockroachDB Managed MCP Server client keeps the queries.', fileOf(30, false, doc)).ok).toBe(true);
    });

    it('any eight words in a row of the contents, put into a eulogy, reject it', () => {
      const words = doc.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w) => w !== '');
      fc.assert(
        fc.property(fc.integer({ min: 0, max: words.length - 8 }), (i) => {
          const r = check(`The keeper said ${words.slice(i, i + 8).join(' ')} and went on.`, fileOf(30, false, doc));
          return !r.ok && r.reason === 'contents';
        }),
      );
    });
  });

  describe('(5) headings and capitals', () => {
    it('drops a single word written as a heading line', () => {
      expect(clean('PanelSystem\nA lively guardian of the welcome page.')).toEqual({ ok: true, text: 'A lively guardian of the welcome page.' });
      expect(clean('WelcomePage\n\nIt greets every visitor.')).toEqual({ ok: true, text: 'It greets every visitor.' });
    });

    it('keeps a capital after a joined line only if the contents use the word mid-sentence', () => {
      const withComments = fileOf(30, false, '// Last of the build steps.\n// Re-exports the primitives.\nconst a = 1;\n');
      expect(check('A weathered component still standing tall,\nLast of its kind, it holds the gate.', withComments)).toEqual({ ok: true, text: 'A weathered component still standing tall, last of its kind, it holds the gate.' });
      expect(check('Here lies index.ts,\nRe-exporting the primitives.', { ...withComments, unused: true } as EulogyInput)).toEqual({ ok: true, text: 'Here lies index.ts, re-exporting the primitives.' });
      const withName = fileOf(30, false, '// press the Meta button to recenter\n');
      expect(check('It waits for the\nMeta button and the headset.', withName)).toEqual({ ok: true, text: 'It waits for the Meta button and the headset.' });
    });
  });

  it('is cleaning version 6', async () => {
    expect((await import('./eulogy-clean')).CLEANING_VERSION).toBe(6);
  });
});

describe('cleaning versions 5 and 6: no ages, times or seasons', () => {
  it('drops each sentence that states an age or a time, and keeps the others', () => {
    for (const [raw, kept] of [
      ['A lively guardian of the welcome page. Last updated just four days ago.', 'A lively guardian of the welcome page.'],
      ['Keeps watch over player reach. Last measured just nine days ago.', 'Keeps watch over player reach.'],
      ['Nine days young, it keeps close watch. It guards the tables.', 'It guards the tables.'],
      ['Recently updated, it guards the gate. It never sleeps.', 'It never sleeps.'],
      ['It was changed a fortnight past. It counts the coins.', 'It counts the coins.'],
      ['Last changed on a cool October morn, it keeps watch. It guards the accounts.', 'It guards the accounts.'],
      ['It has stood since time immemorial. Its rules hold.', 'Its rules hold.'],
      ['It has watched for over a month. It keeps the gate.', 'It keeps the gate.'],
      ['It has guarded the data for many days. It keeps the gate.', 'It keeps the gate.'],
      ['Stays busy, updated just last week. It shines.', 'It shines.'],
      ['Twenty-three days have passed since it changed. It waits.', 'It waits.'],
      ['Dawn breaks, and it watches over the graveyard. 6 days young, it still casts its gaze far.', 'Dawn breaks, and it watches over the graveyard.'],
      ['At dawn of another day, you stood steadfast. Still used, though long since changed.', 'At dawn of another day, you stood steadfast.'],
      ['A flicker of light still watches over the code. Though young, it keeps vigil.', 'A flicker of light still watches over the code.'],
      ['It keeps the voice sessions, a beacon of recent activity. It smooths every turn.', 'It smooths every turn.'],
      ['Still in service after all these days, it animates. It eases every frame.', 'It eases every frame.'],
      ['It checks the puzzles. Still active, though restless lately.', 'It checks the puzzles.'],
      ['Morning has brought a fresh change to the flags. It toggles features.', 'It toggles features.'],
      ['Autumn breeze stirs this leaf, silent since the summer\'s heat. The joins stand firm.', 'The joins stand firm.'],
      // Seasons (review of the demos, CLEANING_VERSION 6).
      ["Here lies recommendations.ts, last used in spring's embrace, now winter's chill claims it. It holds one line.", 'It holds one line.'],
      ['Autumn\'s chill finds it still standing. It routes every request.', 'It routes every request.'],
      ['It sleeps through the winter. It routes every request.', 'It routes every request.'],
      ['In the fall it rests. It routes every request.', 'It routes every request.'],
      ['A summer breeze passes over it. It routes every request.', 'It routes every request.'],
      ['It was written in early spring. It routes every request.', 'It routes every request.'],
    ] as const) {
      expect(withoutTimeSentences(raw), raw).toBe(kept);
      expect(clean(raw), raw).toEqual({ ok: true, text: kept });
    }
  });

  it('leaves nothing when every sentence states a time, which cleaning rejects as empty', () => {
    expect(withoutTimeSentences('Last updated 17 days ago.')).toBe('');
    expect(clean('Still vital. Last updated 17 days ago.')).toEqual({ ok: true, text: 'Still vital.' });
    expect(clean('Last updated 17 days ago. It changed recently updated.')).toEqual({ ok: false, reason: 'empty' });
  });

  it('keeps sentences whose words about time state no age', () => {
    for (const ok of [
      'Every dawn it watches the gate.',
      'It keeps the time for every session.',
      'It counts the commits in each month of the ledger.',
      'It was never unused, not for a day.',
      'Every query looks here for today\'s date.',
      'It sorts transactions by the month.',
      'It keeps the last word on every route.',
      'May it keep watch a while longer.',
      'It holds the first day of each week.',
      'It tracks the rise and fall of every balance.',
      'A spring of fresh data feeds it.',
      'When errors fall, it catches them.',
      'It lets the pages fall silent.',
    ]) {
      expect(statesTime(ok), ok).toBe(false);
      expect(clean(ok), ok).toEqual({ ok: true, text: ok });
    }
  });

  it('any time sentence added to a eulogy is dropped, and the eulogy is what it was', () => {
    const time = fc.constantFrom(
      'Last updated 4 days ago.', 'Recently updated, it hums.', 'Six days young, it shines.', 'It changed a week ago.',
      'Last seen 14 days back.', 'It has stood for decades.', 'It has waited since time immemorial.', 'Last changed in October.',
    );
    const good = fc.constantFrom('The keeper watches the gate.', 'It counts every coin in the ledger.', 'It guards the welcome page.');
    fc.assert(
      fc.property(good, time, fc.boolean(), (g, t, first) => {
        const r = clean(first ? `${t} ${g}` : `${g} ${t}`);
        return r.ok && r.text === g && !statesTime(r.text);
      }),
    );
  });
});
