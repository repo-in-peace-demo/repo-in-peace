// P12: the dates must not depend on the time zone the viewer (or this test) is in. Set an offset zone before any Date is made.
process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: a date near midnight UTC is on another calendar day here

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry, Ghost, RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { thresholdsArb } from '../../test/arbitraries';
import { loadRealGraveyard } from '../../test/real-data';
import { ageDays, MS_PER_DAY } from './age';
import { buryOffered, calendarDay, factRule, ghostSummary, hotDetail, hotText, linesText, shortenPath, stateName, stateSentence, stoneSummary } from './grave-facts';
import { ghostTagText } from './ghost-tag';

const SNAPSHOT = Date.parse('2026-08-18T00:38:17.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

/** The analyser's rule (analyser/src/core/decay.ts), as the reference. */
const stateOf = (age: number, t: Thresholds): FileEntry['decayState'] => (age < t.staleAfterDays ? 'fresh' : age <= t.ancientAfterDays ? 'stale' : 'ancient');

const metaOf = (t: Thresholds, snapshot = SNAPSHOT): RepoMeta => ({ name: 'r', snapshotSha: 'a'.repeat(40), snapshotDate: iso(snapshot), analysedAt: iso(snapshot), schemaVersion: 2, thresholds: t });

const fileArb = (t: Thresholds) =>
  fc.record({ age: fc.integer({ min: 0, max: 2000 }), extraMs: fc.integer({ min: 0, max: MS_PER_DAY - 1 }), lines: fc.integer({ min: 0, max: 20_000 }), unused: fc.boolean(), recent: fc.integer({ min: 0, max: 40 }), name: fc.stringMatching(/^[a-z]{1,8}\.(ts|tsx|js)$/) }).map(
    ({ age, extraMs, lines, unused, recent, name }): FileEntry => ({
      path: `src/${name}`,
      folder: 'src',
      linesOfCode: lines,
      lastCommitDate: iso(SNAPSHOT - age * MS_PER_DAY - extraMs),
      lastCommitAuthor: 'Ann',
      recentCommits: recent,
      unused,
      decayScore: 0.5,
      decayState: stateOf(age, t),
      hot: recent >= t.hotCommits,
      eulogy: '',
    }),
  );

const withFile = fc.tuple(thresholdsArb, fc.constant(null)).chain(([t]) => fc.tuple(fc.constant(t), fileArb(t)));

describe('P5: the state sentence', () => {
  it('names the decay state, counts the file\'s age in days, and quotes the data file\'s threshold for that state', () => {
    fc.assert(
      fc.property(withFile, ([t, f]) => {
        const s = stateSentence(f, metaOf(t));
        const days = ageDays(f.lastCommitDate, metaOf(t).snapshotDate);
        const unit = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'day' : 'days'}`;
        return s === `${stateName(f)}: last changed ${unit(days)} before the snapshot (${stateName(f)} is ${factRule(f.decayState, t)})`;
      }),
    );
  });

  it('agrees with both real files: every stone\'s sentence names its state and its age', () => {
    for (const name of ['demo.oikosledger', 'demo.spatialql'] as const) {
      const g = loadRealGraveyard(name);
      for (const f of g.files) {
        const s = stateSentence(f, g.meta);
        expect(s.startsWith(stateName(f))).toBe(true);
        expect(stateOf(ageDays(f.lastCommitDate, g.meta.snapshotDate), g.meta.thresholds)).toBe(f.decayState);
      }
    }
  });

  it('uses the singular for one day', () => {
    const t: Thresholds = { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 };
    const f = { ...fc.sample(fileArb(t), 1)[0]!, lastCommitDate: iso(SNAPSHOT - MS_PER_DAY), decayState: 'fresh' as const };
    expect(stateSentence(f, metaOf(t))).toBe('Fresh: last changed 1 day before the snapshot (Fresh is under 21 days)');
  });
});

describe('P11: the hover line', () => {
  it('starts with the state, carries the date and the lines, and has exactly the flags that apply', () => {
    fc.assert(
      fc.property(withFile, ([t, f]) => {
        const meta = metaOf(t);
        const parts = stoneSummary(f, meta).split(' · ');
        const flags = parts.slice(3);
        const expectedFlags = [...(f.unused ? ['Unused'] : []), ...(f.hot ? [hotText(f)!] : [])];
        return parts[0] === stateName(f) && parts[1] === `last changed ${calendarDay(f.lastCommitDate, meta.snapshotDate)}` && parts[2] === linesText(f.linesOfCode) && JSON.stringify(flags) === JSON.stringify(expectedFlags);
      }),
    );
  });

  it('reads as in the spec for the oikos stone voice/index.ts, and for a ghost', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const voice = g.files.find((f) => f.path === 'app/components/voice/index.ts')!;
    expect(stoneSummary(voice, g.meta)).toMatch(/^Fresh · last changed [A-Z][a-z]{2} \d{1,2} · [\d,]+ lines? · Unused$/);
    const s = loadRealGraveyard('demo.spatialql');
    for (const ghost of s.ghosts) expect(ghostSummary(ghost, s.meta)).toBe(`Ghost · deleted ${calendarDay(ghost.deletedDate, s.meta.snapshotDate)} · ${ghostTagText(ghost.path)}`);
  });

  it('uses the singulars', () => {
    expect(linesText(1)).toBe('1 line');
    expect(linesText(26)).toBe('26 lines');
    const hot1 = { hot: true, recentCommits: 1 } as FileEntry;
    expect(hotText(hot1)).toBe('Hot (1 commit)');
    expect(hotText({ hot: false, recentCommits: 9 } as FileEntry)).toBeNull();
    expect(hotDetail({ hot: false, recentCommits: 1 } as FileEntry, metaOf({ staleAfterDays: 1, ancientAfterDays: 2, decayCapDays: 4, hotCommits: 5, hotWindowDays: 30 }))).toBe('Not hot: 1 commit in the 30 days before the snapshot (Hot is 5+)');
  });
});

describe('P12: dates in UTC', () => {
  it('is the UTC day whatever the time zone, with the year exactly when it is not the snapshot\'s', () => {
    expect(new Date('2026-06-13T23:30:00.000Z').getDate()).not.toBe(13); // this test really runs in another zone
    fc.assert(
      fc.property(fc.integer({ min: Date.parse('2020-01-01T00:00:00Z'), max: Date.parse('2030-12-31T23:59:59Z') }), fc.integer({ min: Date.parse('2020-01-01T00:00:00Z'), max: Date.parse('2030-12-31T23:59:59Z') }), (ms, snap) => {
        const d = new Date(ms);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
        const sameYear = d.getUTCFullYear() === new Date(snap).getUTCFullYear();
        return calendarDay(iso(ms), iso(snap)) === (sameYear ? day : `${day}, ${d.getUTCFullYear()}`);
      }),
    );
    expect(calendarDay('2026-06-13T23:30:00.000Z', '2026-08-18T00:38:17.000Z')).toBe('Jun 13');
    expect(calendarDay('2025-12-31T23:59:59.000Z', '2026-01-02T00:00:00.000Z')).toBe('Dec 31, 2025');
  });
});

describe('P13: Bury', () => {
  it('is offered exactly on unused stones, whatever their state', () => {
    fc.assert(fc.property(withFile, ([, f]) => buryOffered(f) === f.unused));
    const g = loadRealGraveyard('demo.oikosledger');
    expect(buryOffered(g.files.find((f) => f.path === 'app/components/voice/index.ts')!)).toBe(true); // fresh and unused
    const ancientUsed = g.files.find((f) => f.decayState === 'ancient' && !f.unused)!;
    expect(buryOffered(ancientUsed)).toBe(false);
  });
});

describe('P10: shortening a path', () => {
  it('keeps the whole file name, is never longer than asked unless the name alone is, and leaves a path that fits as it is', () => {
    const segment = fc.stringMatching(/^[a-z_()[\].-]{1,14}$/);
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 8 }), fc.integer({ min: 4, max: 60 }), (segments, max) => {
        const path = segments.join('/');
        const name = segments[segments.length - 1]!;
        const out = shortenPath(path, max);
        if (Array.from(path).length <= max) return out === path;
        if (!out.endsWith(name)) return false;
        if (segments.length === 1) return out === path;
        return Array.from(out).length <= max || out === `…/${name}`;
      }),
    );
    expect(shortenPath('app/components/dashboard/widgets/ui/index.ts', 28)).toBe('app/compo…idgets/ui/index.ts') // 28: the name (8), "/" and "…", and 9 of the folder at each end;
  });
});

describe('ghost words', () => {
  it('names the type as the toe tag does', () => {
    const ghost: Ghost = { path: 'Makefile', deletedInSha: 'b'.repeat(40), deletedDate: iso(SNAPSHOT - 3 * MS_PER_DAY), deletedBy: 'Bob', lastExistingSha: 'c'.repeat(40) };
    expect(ghostSummary(ghost, metaOf({ staleAfterDays: 1, ancientAfterDays: 2, decayCapDays: 4, hotCommits: 5, hotWindowDays: 30 }))).toBe('Ghost · deleted Aug 15 · ·');
  });
});
