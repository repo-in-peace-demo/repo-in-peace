import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cleanEulogy, rejectReason, sentencesOf, stripReasoning } from './eulogy-clean';
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
  it('an accepted eulogy is at most two sentences and 240 characters, on one line, with no markdown or wrapping quotes', () => {
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
          !/^["'“”‘’«»]|["'“”‘’«»]$/.test(t) &&
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

  it('cuts a long answer at a word and ends it with a full stop', () => {
    const long = `Here lies ${'a very patient helper '.repeat(20)}that never once complained`;
    const r = clean(long);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Array.from(r.text).length).toBeLessThanOrEqual(EULOGY_MAX_CHARS);
      expect(r.text.endsWith('.')).toBe(true);
      expect(r.text.endsWith(' .')).toBe(false);
    }
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
