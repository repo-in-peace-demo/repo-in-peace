import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanEulogy, contradictsFacts, quotesBalanced, rejectReason, sentencesOf, stripReasoning } from './eulogy-clean';
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
    const first = `The lantern keeper ${'walks the paths '.repeat(6).trim()} at dusk.`;
    const second = `It ${'keeps every flame '.repeat(8).trim()} burning.`;
    expect(clean(`${first} It rests.`)).toEqual({ ok: true, text: `${first} It rests.` });
    expect(Array.from(`${first} ${second}`).length).toBeGreaterThan(EULOGY_MAX_CHARS);
    expect(clean(`${first} ${second}`)).toEqual({ ok: true, text: first });
    expect(clean(`The keeper ${'waited and '.repeat(30)}waited.`)).toEqual({ ok: false, reason: 'long' });
  });

  it('whatever the length, an accepted eulogy is whole sentences of the answer, never cut inside one', () => {
    const sentence = fc.stringMatching(/^[A-Z][a-z]{1,8}( [a-z]{1,8}){0,30}[.!?]$/);
    fc.assert(
      fc.property(fc.array(sentence, { minLength: 1, maxLength: 4 }), (sentences) => {
        const r = clean(sentences.join(' '));
        if (!r.ok) return r.reason === 'long' && Array.from(sentences[0]!).length > EULOGY_MAX_CHARS;
        return r.text === sentences.slice(0, sentencesOf(r.text).length).join(' ');
      }),
    );
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
    contents: { text: contents, cut: false, kind: 'text' }, decayState: 'fresh', unused: false,
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
  const fileOf = (decayState: 'fresh' | 'stale' | 'ancient', unused: boolean): EulogyInput => ({
    kind: 'file', path: 'app/lib/logger.ts', name: 'logger.ts', state: decayState, flags: [], lines: 40, subject: 'x',
    contents: { text: 'export const log = 1;\n', cut: false, kind: 'text' }, decayState, unused,
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

  it('has nothing to contradict for a ghost', () => {
    expect(contradictsFacts('An ancient, unused, forgotten thing.', ghost)).toBe(false);
  });
});
