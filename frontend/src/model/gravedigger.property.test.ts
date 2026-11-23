import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FENCE_INSET } from './fences';
import {
  DIG_CYCLE_S,
  ENTER_S,
  EXIT_S,
  FOOT_HALF,
  MIN_DIG_CYCLES,
  STAKE_RISE_AT_S,
  WATCH_S,
  PAT_S,
  diggerPose,
  diggerSpot,
  freeSpots,
  shovelSweep,
  MOST_TOWARD_CAMERA,
  BEST_BEHIND,
  endOf,
  footprintOf,
  phasesOf,
  sinkAtOf,
  type DiggerOutcome,
} from './gravedigger';
import { STONE_D, STONE_W } from './layout-constants';
import { marksExtent } from './pr-scene';
import type { Rect } from './rect';
import { buildSceneModel } from './scene-model';
import { makeSyntheticGraveyard } from './synthetic';

const SUCCESS = ['enter', 'dig', 'watch', 'pat', 'stake', 'exit'];
const FAILURE = ['enter', 'dig', 'shrug', 'exit'];

const jobArb = fc.record({
  start: fc.integer({ min: 0, max: 1_000_000 }),
  wait: fc.integer({ min: 0, max: 40_000 }), // how long the request took, in ms
  kind: fc.constantFrom<DiggerOutcome['kind']>('success', 'failure'),
});
const toJob = ({ start, wait, kind }: { start: number; wait: number; kind: DiggerOutcome['kind'] }) => ({ start, outcome: { kind, at: start + wait } });

describe('the timeline', () => {
  it('P: the phases always run in order, back to back, and he always leaves', () => {
    fc.assert(
      fc.property(jobArb, (j) => {
        const job = toJob(j);
        const spans = phasesOf(job);
        expect(spans.map((s) => s.phase)).toEqual(j.kind === 'success' ? SUCCESS : FAILURE);
        expect(spans[0]!.from).toBe(job.start);
        for (let i = 1; i < spans.length; i++) expect(spans[i]!.from).toBe(spans[i - 1]!.to);
        for (const s of spans) expect(s.to).toBeGreaterThan(s.from);
        const end = endOf(job);
        expect(Number.isFinite(end)).toBe(true);
        expect(diggerPose(job, end)).toMatchObject({ phase: 'gone', opacity: 0 });
        expect(diggerPose(job, end + 60_000).phase).toBe('gone');
      }),
    );
  });

  it('P: sampled at any times, the phase never goes back, and the dig lasts while the request runs', () => {
    fc.assert(
      fc.property(jobArb, fc.array(fc.integer({ min: -2000, max: 60_000 }), { minLength: 2, maxLength: 30 }), (j, offsets) => {
        const job = toJob(j);
        const order = ['gone-before', ...(j.kind === 'success' ? SUCCESS : FAILURE), 'gone'];
        const rank = (now: number): number => {
          const p = diggerPose(job, now).phase;
          return p === 'gone' ? (now < job.start ? 0 : order.length - 1) : order.indexOf(p);
        };
        const times = offsets.map((o) => job.start + o).sort((a, b) => a - b);
        for (let i = 1; i < times.length; i++) expect(rank(times[i]!)).toBeGreaterThanOrEqual(rank(times[i - 1]!));
        // Still digging at any moment between the end of the entrance and the request's end.
        const mid = job.start + ENTER_S * 1000 + (j.wait - ENTER_S * 1000) / 2;
        if (j.wait > ENTER_S * 1000 + 1) expect(diggerPose(job, mid).phase).toBe('dig');
      }),
    );
  });

  it('P: at least about 3 s in all, even for a request that returns at once; never waits more than one dig past the request', () => {
    fc.assert(
      fc.property(jobArb, (j) => {
        const job = toJob(j);
        const spans = phasesOf(job);
        const dig = spans.find((s) => s.phase === 'dig')!;
        expect(endOf(job) - job.start).toBeGreaterThanOrEqual(3000);
        expect(dig.to - dig.from).toBeGreaterThanOrEqual(MIN_DIG_CYCLES * DIG_CYCLE_S * 1000 - 1e-6);
        // The dig stops at the end of the cycle in progress: less than one cycle after the request ended, or the minimum.
        expect(dig.to - Math.max(job.outcome.at, dig.from + MIN_DIG_CYCLES * DIG_CYCLE_S * 1000)).toBeLessThan(DIG_CYCLE_S * 1000 + 1e-6);
      }),
    );
  });

  it('while the request runs he digs on, with no end', () => {
    const job = { start: 1000 };
    expect(phasesOf(job).map((s) => s.phase)).toEqual(['enter', 'dig']);
    expect(endOf(job)).toBe(Infinity);
    expect(diggerPose(job, 1000 + 25_000).phase).toBe('dig');
    expect(sinkAtOf(job)).toBeUndefined();
  });

  it('on success the stone sinks as he stops digging, and the stake rises while he plants it', () => {
    const job = { start: 0, outcome: { kind: 'success' as const, at: 2000 } };
    const spans = phasesOf(job);
    const dig = spans.find((s) => s.phase === 'dig')!;
    const stake = spans.find((s) => s.phase === 'stake')!;
    expect(sinkAtOf(job)).toBe(dig.to);
    expect(dig.to + STAKE_RISE_AT_S * 1000).toBeGreaterThanOrEqual(stake.from);
    expect(dig.to + STAKE_RISE_AT_S * 1000).toBeLessThan(stake.to);
    expect(stake.from - dig.to).toBe((WATCH_S + PAT_S) * 1000);
    expect(sinkAtOf({ start: 0, outcome: { kind: 'failure', at: 10 } })).toBeUndefined();
  });

  it('fades in and out, and digs with dirt in the air only during the toss', () => {
    const job = { start: 0, outcome: { kind: 'failure' as const, at: 0 } };
    expect(diggerPose(job, 0).opacity).toBe(0);
    expect(diggerPose(job, ENTER_S * 500).opacity).toBeCloseTo(0.5);
    const digFrom = ENTER_S * 1000;
    expect(diggerPose(job, digFrom + 100).clods).toEqual([]); // the thrust
    expect(diggerPose(job, digFrom + 0.85 * DIG_CYCLE_S * 1000).clods.length).toBeGreaterThan(0); // the toss
    const exit = phasesOf(job).find((s) => s.phase === 'exit')!;
    expect(diggerPose(job, exit.from + EXIT_S * 500).opacity).toBeCloseTo(0.5);
  });
});

// ---- Where he stands, checked against obstacles worked out again here ----

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.z < b.z + b.d - 1e-9 && b.z < a.z + a.d - 1e-9;

describe('where he stands', () => {
  const models = [1, 2, 3, 4].map((seed) => buildSceneModel(makeSyntheticGraveyard({ files: 40 + seed * 25, seed, ghosts: seed })));

  it('P: never on another stone or ghost cell, a fence, a plaque, or his own grave; in the cell or the aisle beside it; in front only when nothing else is free', () => {
    let placed = 0;
    let none = 0;
    fc.assert(
      fc.property(fc.constantFrom(...models), fc.nat(), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: 5, max: 80, noNaN: true }), (model, pick, angle, distance) => {
        const index = pick % model.stones.length;
        const s = model.stones[index]!.layout;
        const camera = { x: s.x + Math.cos(angle) * distance, z: s.z + Math.sin(angle) * distance };
        const spot = diggerSpot(model, index, camera);
        if (spot === null) {
          none++;
          return;
        }
        placed++;
        const foot = footprintOf(spot);
        expect(foot.w).toBe(2 * FOOT_HALF);
        model.stones.forEach((o, i) => {
          if (i !== index) expect(overlap(foot, o.layout.cell), `stone ${o.layout.path}`).toBe(false);
        });
        for (const g of model.ghosts) expect(overlap(foot, g.layout.cell)).toBe(false);
        for (const plot of model.layout.plots) {
          expect(overlap(foot, plot.sign.footprint), 'plaque').toBe(false);
          // No fence line runs under him.
          const fx0 = plot.rect.x + FENCE_INSET;
          const fx1 = plot.rect.x + plot.rect.w - FENCE_INSET;
          const fz0 = plot.rect.z + FENCE_INSET;
          const fz1 = plot.rect.z + plot.rect.d - FENCE_INSET;
          const crossesX = (x: number) => foot.x <= x && x <= foot.x + foot.w && foot.z + foot.d >= fz0 && foot.z <= fz1;
          const crossesZ = (z: number) => foot.z <= z && z <= foot.z + foot.d && foot.x + foot.w >= fx0 && foot.x <= fx1;
          expect(crossesX(fx0) || crossesX(fx1) || crossesZ(fz0) || crossesZ(fz1), `fence of ${plot.path}`).toBe(false);
        }
        // His own grave: the stone's base and the mound and stake to come.
        const m = marksExtent('buried');
        expect(overlap(foot, { x: s.x + m.minX, z: s.z + m.minZ, w: m.maxX - m.minX, d: m.maxZ - m.minZ })).toBe(false);
        expect(overlap(foot, { x: s.x - STONE_W / 2, z: s.z - STONE_D / 2, w: STONE_W, d: STONE_D })).toBe(false);
        // Within the cell grown by the aisle.
        expect(foot.x).toBeGreaterThanOrEqual(s.cell.x - 0.75 - 1e-9);
        expect(foot.x + foot.w).toBeLessThanOrEqual(s.cell.x + s.cell.w + 0.75 + 1e-9);
        expect(foot.z).toBeGreaterThanOrEqual(s.cell.z - 0.75 - 1e-9);
        expect(foot.z + foot.d).toBeLessThanOrEqual(s.cell.z + s.cell.d + 0.75 + 1e-9);
        // Facing the grave. In front of it (between it and the camera) only when every free place is; otherwise the free place
        // nearest beside it.
        const toward = { x: s.x - camera.x, z: s.z - camera.z };
        const off = { x: spot.x - s.x, z: spot.z - s.z };
        const score = (off.x * toward.x + off.z * toward.z) / (Math.hypot(off.x, off.z) * Math.hypot(toward.x, toward.z));
        // Facing the grave, or turned from it by at most 90 degrees to keep the shovel out of the stones.
        const facingDot = (Math.sin(spot.yaw) * -off.x + Math.cos(spot.yaw) * -off.z) / Math.hypot(off.x, off.z);
        expect(facingDot).toBeGreaterThanOrEqual(-1e-9);
        // The shovel, in every pose by the standing stone, never enters a stone (worked out here from the layout and the lean).
        const nearby = model.stones.filter((o) => Math.abs(o.layout.x - spot.x) < 5 && Math.abs(o.layout.z - spot.z) < 5); // the shovel reaches under 2
        for (const p of shovelSweep(spot, spot.yaw)) {
          for (const other of nearby) {
            const o = other.layout;
            const reach = o.height * Math.sin((other.visual.leanDegrees * Math.PI) / 180);
            const lx = reach * Math.cos(other.visual.leanDirection);
            const lz = reach * Math.sin(other.visual.leanDirection);
            const inBase = (cx: number, cz: number) => Math.abs(p.x - cx) < STONE_W / 2 && Math.abs(p.z - cz) < STONE_D / 2;
            expect(inBase(o.x, o.z) || inBase(o.x + lx, o.z + lz), `shovel in ${o.path}`).toBe(false);
          }
        }
        const free = freeSpots(model, index, camera);
        expect(free.some((f) => f.spot.x === spot.x && f.spot.z === spot.z)).toBe(true);
        const notInFront = free.filter((f) => f.score >= MOST_TOWARD_CAMERA);
        if (notInFront.length === 0) {
          expect(score).toBeCloseTo(Math.max(...free.map((f) => f.score)));
        } else {
          expect(score).toBeGreaterThanOrEqual(MOST_TOWARD_CAMERA - 1e-9);
          expect(Math.abs(score - BEST_BEHIND)).toBeLessThanOrEqual(Math.min(...notInFront.map((f) => Math.abs(f.score - BEST_BEHIND))) + 1e-9);
        }
      }),
      { numRuns: 400 },
    );
    // The test sees real placements, not only refusals.
    expect(placed).toBeGreaterThan(none);
  }, 20_000);

  it('stands beside the grave, never between it and the camera when a side is free: seen from the right, not on its right', () => {
    const model = models[0]!;
    let checked = 0;
    model.stones.forEach((st, index) => {
      const s = st.layout;
      for (const side of [1, -1]) {
        const camera = { x: s.x + side * 1e4, z: s.z };
        const free = freeSpots(model, index, camera);
        if (!free.some((f) => f.score >= MOST_TOWARD_CAMERA)) continue;
        const spot = diggerSpot(model, index, camera)!;
        expect(side * (spot.x - s.x)).toBeLessThanOrEqual(1e-9); // not on the camera's side
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('on both demos, from every camera direction, every unused stone gets a gravedigger, and he is never straight behind it', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ['demo.oikosledger', 'demo.spatialql']) {
      const model = buildSceneModel(JSON.parse(readFileSync(new URL(`../../public/graveyards/${name}.graveyard.json`, import.meta.url), 'utf8')));
      model.stones.forEach((st, index) => {
        if (!st.file.unused) return;
        for (let a = 0; a < 360; a += 5) {
          const r = (a * Math.PI) / 180;
          const camera = { x: st.layout.x + Math.sin(r) * 40, z: st.layout.z + Math.cos(r) * 40 };
          const spot = diggerSpot(model, index, camera);
          expect(spot, `${name} ${st.file.path} from ${a} degrees`).not.toBeNull();
          const off = { x: spot!.x - st.layout.x, z: spot!.z - st.layout.z };
          const toward = { x: st.layout.x - camera.x, z: st.layout.z - camera.z };
          const score = (off.x * toward.x + off.z * toward.z) / (Math.hypot(off.x, off.z) * Math.hypot(toward.x, toward.z));
          // Straight behind is within 25 degrees of the camera's line through the stone (0.9): the stone would hide him there.
          expect(score, `${name} ${st.file.path} from ${a} degrees`).toBeLessThan(0.9);
        }
      });
    }
  });
});
