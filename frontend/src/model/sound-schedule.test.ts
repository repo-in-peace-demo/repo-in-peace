import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DIG_CYCLE_S, ENTER_S, phasesOf } from './gravedigger';
import { FORM_AT_S, MOUTH_S, RISE_S, SOLID_S } from './pr-scene';
import { OWL_MAX_S, OWL_MIN_S, OWL_NOTES, THRUST_AT, diggerSounds, dueBetween, initialSound, moanChanges, owlCalls, riseSounds, toggleSound } from './sound-schedule';

describe('the mute state', () => {
  it('starts muted on every visit, and toggles', () => {
    expect(initialSound()).toEqual({ on: false });
    expect(toggleSound(initialSound())).toEqual({ on: true });
    expect(toggleSound(toggleSound(initialSound()))).toEqual({ on: false });
  });
});

describe('the owl', () => {
  it('P: calls 25 to 60 s apart, panned to a side, the same calls for the same seed', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), (seed) => {
        const calls = owlCalls(60, seed);
        for (const c of calls) {
          expect(c.delay).toBeGreaterThanOrEqual(OWL_MIN_S);
          expect(c.delay).toBeLessThanOrEqual(OWL_MAX_S);
          expect(Math.abs(c.pan)).toBeGreaterThanOrEqual(0.25);
          expect(Math.abs(c.pan)).toBeLessThanOrEqual(0.65);
        }
        expect(owlCalls(60, seed)).toEqual(calls);
        expect(new Set(calls.map((c) => Math.sign(c.pan))).size).toBe(2); // both sides
      }),
      { numRuns: 50 },
    );
    expect(owlCalls(5, 'a')).not.toEqual(owlCalls(5, 'b'));
  });

  it('hoots "hoo-hoo… hoo": two quick notes, a pause, a longer one', () => {
    const [a, b, c] = OWL_NOTES;
    expect(b!.at - (a!.at + a!.length)).toBeLessThan(0.2);
    expect(c!.at - (b!.at + b!.length)).toBeGreaterThan(0.4);
    expect(c!.length).toBeGreaterThan(a!.length);
  });
});

describe('the gravedigger\'s sounds', () => {
  it('P: a thrust and a toss in every dig, only while he digs, then two pats and the stake on success; nothing for the shrug', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), fc.integer({ min: 0, max: 20_000 }), fc.constantFrom('success' as const, 'failure' as const), (start, wait, kind) => {
        const job = { start, outcome: { kind, at: start + wait } };
        const events = diggerSounds(job, Infinity);
        const dig = phasesOf(job).find((s) => s.phase === 'dig')!;
        const cycles = Math.round((dig.to - dig.from) / (DIG_CYCLE_S * 1000));
        expect(events.filter((e) => e.kind === 'thrust')).toHaveLength(cycles);
        expect(events.filter((e) => e.kind === 'toss')).toHaveLength(cycles);
        for (const e of events.filter((x) => x.kind === 'thrust' || x.kind === 'toss')) {
          expect(e.at).toBeGreaterThan(dig.from);
          expect(e.at).toBeLessThan(dig.to);
        }
        expect(events.filter((e) => e.kind === 'pat')).toHaveLength(kind === 'success' ? 2 : 0);
        expect(events.filter((e) => e.kind === 'stake')).toHaveLength(kind === 'success' ? 1 : 0);
        for (let i = 1; i < events.length; i++) expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
      }),
    );
  });

  it('keeps digging for as long as the request runs: an open job has thrusts up to now', () => {
    const job = { start: 0 };
    const now = ENTER_S * 1000 + 10 * DIG_CYCLE_S * 1000;
    const thrusts = diggerSounds(job, now).filter((e) => e.kind === 'thrust');
    expect(thrusts).toHaveLength(10);
    expect(thrusts[0]!.at).toBeCloseTo(ENTER_S * 1000 + THRUST_AT * DIG_CYCLE_S * 1000);
  });
});

describe('the resurrection\'s sounds', () => {
  it('a wail for the whole rise, a rumble as the stone forms, the thunk as it stands: about 2 s', () => {
    const [wail, rumble, thunk] = riseSounds(1000);
    expect(wail).toEqual({ kind: 'wail', at: 1000, length: MOUTH_S + RISE_S });
    expect(rumble).toEqual({ kind: 'rumble', at: 1000 + FORM_AT_S * 1000, length: SOLID_S });
    expect(thunk!.at).toBeCloseTo(1000 + (FORM_AT_S + SOLID_S) * 1000);
    expect((thunk!.at - 1000) / 1000).toBeGreaterThan(1.8);
    expect((thunk!.at - 1000) / 1000).toBeLessThan(2.4);
  });
});

describe('dueBetween', () => {
  it('P: every event is played once over any run of frames, and stale ones after a long gap are dropped', () => {
    const events = riseSounds(100);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 80 }), (steps) => {
        let t = 0;
        const played: string[] = [];
        for (const s of steps) {
          played.push(...dueBetween(events, t, t + s).map((e) => e.kind));
          t += s;
        }
        expect(played).toEqual(events.filter((e) => e.at <= t).map((e) => e.kind));
      }),
    );
    expect(dueBetween(events, 0, 5000)).toEqual([]); // one frame after the tab was hidden for seconds: none of them
  });
});

describe('the ghost\'s moan', () => {
  const set = (...p: string[]) => new Set(p);
  it('starts when a Resurrect request starts, rises into the wail when it opens, fades when it fails', () => {
    expect(moanChanges(set(), set('g'), set())).toEqual([{ path: 'g', change: 'start' }]);
    expect(moanChanges(set('g'), set('g'), set())).toEqual([]); // still waiting: keeps moaning
    expect(moanChanges(set('g'), set(), set('g'))).toEqual([{ path: 'g', change: 'rise' }]);
    expect(moanChanges(set('g'), set(), set())).toEqual([{ path: 'g', change: 'fade' }]);
  });

  it('P: after applying the changes, the ghosts moaning are exactly the ghosts waiting', () => {
    const paths = fc.subarray(['a', 'b', 'c', 'd']).map((xs) => new Set(xs));
    fc.assert(
      fc.property(paths, paths, paths, (moaning, waiting, opened) => {
        const next = new Set(moaning);
        for (const c of moanChanges(moaning, waiting, opened)) {
          if (c.change === 'start') next.add(c.path);
          else next.delete(c.path);
          if (c.change === 'rise') expect(opened.has(c.path)).toBe(true);
          if (c.change === 'fade') expect(opened.has(c.path)).toBe(false);
        }
        expect([...next].sort()).toEqual([...waiting].sort());
      }),
    );
  });
});
