import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './atmosphere';
import { clearingCeilingDeg, FRAMING_TREE_AZIMUTHS_DEG } from './horizon';
import {
  BATS_S,
  BAT_BEYOND_DEG,
  CANOPY_TOP_DEG,
  GLOW_LOWEST_DEG,
  GLOW_PEAK,
  LIGHTNING_EVERY_MIN_S,
  LIGHTNING_S,
  MAX_FLASHES,
  MOON_ANGULAR_RADIUS_DEG,
  QUIET_MAX_S,
  QUIET_MIN_S,
  STAR_HIGHEST_DEG,
  STAR_LOWEST_DEG,
  STAR_MAX_S,
  STAR_MIN_S,
  STAR_MOON_CLEARANCE_DEG,
  batAt,
  batFlight,
  distanceToSegmentDeg,
  flashLevel,
  glowAt,
  lightningOf,
  skyDistanceDeg,
  skyEventAt,
  skySchedule,
  starAt,
  starPath,
} from './sky-director';
import { PASS_S, SKY_TOP_DEG, firstPassStart } from './witch';

const MOON = { azimuthDeg: MOON_AZIMUTH_DEG, elevationDeg: MOON_ELEVATION_DEG };
const FIRST = firstPassStart(0);
const seedArb = fc.string({ minLength: 1, maxLength: 12 });
const schedule = (seed: string) => skySchedule(FIRST, 3000, seed);

describe('the sky director', () => {
  it('P: never two events at once, and always a quiet gap of 9 to 14 s between them; the same for the same seed', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const events = schedule(seed);
        expect(events.length).toBeGreaterThan(50);
        for (let i = 1; i < events.length; i++) {
          const quiet = events[i]!.start - (events[i - 1]!.start + events[i - 1]!.duration);
          expect(quiet).toBeGreaterThanOrEqual(QUIET_MIN_S);
          expect(quiet).toBeLessThanOrEqual(QUIET_MAX_S);
        }
        expect(skySchedule(FIRST, 3000, seed)).toEqual(events);
      }),
      { numRuns: 40 },
    );
  });

  it('P: sampled at any moment, at most one event is in the sky', () => {
    fc.assert(
      fc.property(seedArb, fc.double({ min: 0, max: 2500, noNaN: true }), (seed, t) => {
        const live = schedule(seed).filter((e) => t >= e.start && t <= e.start + e.duration);
        expect(live.length).toBeLessThanOrEqual(1);
        const at = skyEventAt(t, FIRST, false, seed);
        expect(at === null ? null : at.index).toBe(live[0]?.index ?? null);
      }),
      { numRuns: 300 },
    );
  });

  it('P: the witch first, then the other three in some order; witch 45 s apart, lightning 30 s apart, nothing twice in a row', () => {
    const orders = new Set<string>();
    fc.assert(
      fc.property(seedArb, (seed) => {
        const events = schedule(seed);
        expect(events[0]).toMatchObject({ kind: 'witch', start: FIRST, duration: PASS_S });
        const next3 = events.slice(1, 4).map((e) => e.kind);
        expect([...next3].sort()).toEqual(['bats', 'lightning', 'star']);
        orders.add(next3.join());
        expect(events[3]!.start).toBeLessThan(FIRST + 60);
        for (let i = 1; i < events.length; i++) expect(events[i]!.kind).not.toBe(events[i - 1]!.kind);
        for (const kind of ['witch', 'lightning'] as const) {
          const starts = events.filter((e) => e.kind === kind).map((e) => e.start);
          for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(kind === 'witch' ? 45 : LIGHTNING_EVERY_MIN_S);
        }
        for (const e of events) {
          if (e.kind === 'star') expect(e.duration >= STAR_MIN_S && e.duration <= STAR_MAX_S).toBe(true);
          if (e.kind === 'bats') expect(e.duration).toBe(BATS_S);
          if (e.kind === 'lightning') expect(e.duration).toBe(LIGHTNING_S);
        }
      }),
      { numRuns: 60 },
    );
    expect(orders.size).toBeGreaterThan(2); // varied order
    expect(new Set(schedule('repo-in-peace/sky').map((e) => e.kind)).size).toBe(4);
  });

  it('nothing under reduced motion, and nothing before the first event', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 5000, noNaN: true }), (t) => skyEventAt(t, FIRST, true) === null));
    expect(skyEventAt(FIRST - 0.01, FIRST, false)).toBeNull();
  });
});

describe('shooting stars', () => {
  it('P: never cross the moon or its halo; stay in the upper sky, above every treetop, in view', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), seedArb, fc.double({ min: 0, max: 1, noNaN: true }), (index, seed, u) => {
        const path = starPath(index, seed);
        expect(distanceToSegmentDeg(MOON, path.from, path.to)).toBeGreaterThanOrEqual(STAR_MOON_CLEARANCE_DEG);
        const { head, tail, brightness } = starAt(path, u * path.duration);
        for (const p of [path.from, path.to, head, tail]) {
          expect(p.elevationDeg).toBeGreaterThanOrEqual(STAR_LOWEST_DEG - 1e-9);
          expect(p.elevationDeg).toBeLessThanOrEqual(STAR_HIGHEST_DEG);
          expect(p.elevationDeg).toBeGreaterThan(CANOPY_TOP_DEG + 1);
          expect(skyDistanceDeg(p, MOON)).toBeGreaterThanOrEqual(STAR_MOON_CLEARANCE_DEG - 1e-9);
        }
        expect(brightness >= 0 && brightness <= 1).toBe(true);
        expect(path.duration >= 0.6 && path.duration <= 1).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('streaks: the head moves on, the tail follows, and it is gone at the end', () => {
    const path = starPath(3);
    expect(starAt(path, 0).brightness).toBe(0);
    expect(starAt(path, path.duration).brightness).toBe(0);
    expect(starAt(path, path.duration * 0.4).brightness).toBeGreaterThan(0.9);
    const a = starAt(path, 0.2);
    const b = starAt(path, 0.5);
    expect(distanceToSegmentDeg(b.head, path.to, path.to)).toBeLessThan(distanceToSegmentDeg(a.head, path.to, path.to));
  });
});

describe('bats', () => {
  it('P: 4 to 7 bats, from the side toward the moon, across or beside its disc, ending past it, smaller, faded', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), seedArb, (index, seed) => {
        const bats = batFlight(index, seed);
        expect(bats.length >= 4 && bats.length <= 7).toBe(true);
        for (const bat of bats) {
          const side = Math.sign(bat.from.azimuthDeg - MOON_AZIMUTH_DEG);
          // Passes across or beside the moon: within a disc and a bit of its middle.
          expect(distanceToSegmentDeg(MOON, bat.from, bat.to)).toBeLessThan(MOON_ANGULAR_RADIUS_DEG + 0.5);
          // Ends past the moon, on the other side from where it came.
          expect(Math.sign(bat.to.azimuthDeg - MOON_AZIMUTH_DEG)).toBe(-side);
          expect(Math.abs(bat.to.azimuthDeg - MOON_AZIMUTH_DEG)).toBeGreaterThanOrEqual(BAT_BEYOND_DEG - 1e-9);
          const start = batAt(bat, bat.delay)!;
          const end = batAt(bat, BATS_S)!;
          expect(end.at).toEqual(bat.to);
          expect(end.halfSizeDeg).toBeLessThan(start.halfSizeDeg / 2);
          expect(end.opacity).toBe(0);
          // In the sky the whole way: above the treetops (and the framing trees), below the top of the frame.
          for (let k = 0; k <= 20; k++) {
            const b = batAt(bat, bat.delay + ((BATS_S - bat.delay) * k) / 20)!;
            expect(b.at.elevationDeg - b.halfSizeDeg).toBeGreaterThan(Math.min(clearingCeilingDeg(b.at.azimuthDeg), CANOPY_TOP_DEG) + 0.4);
            expect(b.at.elevationDeg - b.halfSizeDeg).toBeGreaterThan(6.6); // the framing trees' tops
            expect(b.at.elevationDeg + b.halfSizeDeg).toBeLessThan(SKY_TOP_DEG);
            expect(Math.abs(b.wings)).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 300 },
    );
    expect(FRAMING_TREE_AZIMUTHS_DEG.length).toBeGreaterThan(0);
  });
});

describe('distant lightning', () => {
  it('P: at most 2 flashes an event and never more than 3 in any one second, with the events 30 s or more apart', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const events = schedule(seed).filter((e) => e.kind === 'lightning');
        const flashStarts: number[] = [];
        for (const e of events) {
          const l = lightningOf(e.index, seed);
          expect(l.flashes.length).toBeGreaterThanOrEqual(1);
          expect(l.flashes.length).toBeLessThanOrEqual(MAX_FLASHES);
          // Counted from the light itself: rising past half, sampled every 5 ms.
          let rises = 0;
          let was = 0;
          for (let t = 0; t <= LIGHTNING_S; t += 0.005) {
            const v = flashLevel(l, t);
            if (v >= 0.5 && was < 0.5) rises++;
            was = v;
          }
          expect(rises).toBe(l.flashes.length);
          for (const f of l.flashes) {
            expect(f.start + f.duration).toBeLessThanOrEqual(LIGHTNING_S);
            flashStarts.push(e.start + f.start);
          }
        }
        for (const s of flashStarts) expect(flashStarts.filter((x) => x >= s && x < s + 1).length).toBeLessThanOrEqual(3);
      }),
      { numRuns: 60 },
    );
  });

  it('P: its light stays in the sky over the forest: none below 4 degrees up, far from the moon, and dim', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -30, max: 40, noNaN: true }), (index, az, el) => {
        const l = lightningOf(index);
        const g = glowAt(l, { azimuthDeg: az, elevationDeg: el });
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(GLOW_PEAK);
        // The graveyard is below the horizon (elevation under 0) from every camera: the light never gets there.
        if (el < GLOW_LOWEST_DEG) expect(g).toBe(0);
        expect(skyDistanceDeg(l.at, MOON)).toBeGreaterThanOrEqual(13.9);
        for (const p of [...(l.fork ?? []), ...l.branch]) expect(p.elevationDeg).toBeGreaterThanOrEqual(GLOW_LOWEST_DEG);
      }),
      { numRuns: 1000 },
    );
    expect(GLOW_LOWEST_DEG).toBeGreaterThan(4);
    expect(GLOW_PEAK).toBeLessThanOrEqual(0.25); // a quarter at most, added on the dark sky
  });
});
