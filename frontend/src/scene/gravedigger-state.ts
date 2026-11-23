import { diggerPose, diggerSpot, sinkAtOf, STAKE_RISE_AT_S, STAKE_RISE_S, type DiggerJob, type DiggerPhase } from '../model/gravedigger';
import type { GraveOverride } from '../model/pr-scene';
import type { SceneModel } from '../model/scene-model';
import { getPrSession, subscribePrSession } from '../store/pr-store';
import { isReducedMotion } from './animation-clock';

/**
 * The gravediggers of this scene (model/gravedigger.ts), one per Bury, from the pull-request store: a job starts when a stone's
 * request starts (Bury confirmed), and ends with the request's outcome (a pull request recorded, or an error, or the request
 * given up). It listens to the store itself, not through React, so a request that returns at once still gets its job.
 * A job is kept after the figure has gone: the stone's sink is timed from it for the rest of the session.
 */

let jobs = new Map<string, DiggerJob>();
let version = 0;
const listeners = new Set<() => void>();
const changed = (): void => {
  version++;
  for (const listener of [...listeners]) listener();
};

export const getDiggerJobs = (): ReadonlyMap<string, DiggerJob> => jobs;
export const getDiggerVersion = (): number => version;
export function subscribeDiggers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts watching the store for this scene. `camera` gives the camera's place on the ground when a Bury is confirmed. */
export function startGravediggers(model: SceneModel, camera: () => { x: number; z: number }, now: () => number = () => performance.now()): () => void {
  jobs = new Map();
  changed();
  const update = (): void => {
    const { requests, prs } = getPrSession();
    let next: Map<string, DiggerJob> | null = null;
    const edit = (): Map<string, DiggerJob> => (next ??= new Map(jobs));
    for (const [key, request] of requests) {
      if (!key.startsWith('file:') || request.state !== 'opening') continue;
      const path = key.slice('file:'.length);
      if (jobs.get(path)?.start === request.startedAt) continue;
      const found = model.lookup.get(path);
      if (found?.kind !== 'file' || isReducedMotion()) continue;
      const spot = diggerSpot(model, found.index, camera());
      if (spot === null) continue; // nowhere free beside this grave: the Bury shows without him
      edit().set(path, { path, start: request.startedAt, spot });
    }
    for (const [path, job] of next ?? jobs) {
      if (job.outcome !== undefined) continue;
      const pr = prs.get(`file:${path}`);
      const request = requests.get(`file:${path}`);
      if (pr !== undefined) edit().set(path, { ...job, outcome: { kind: 'success', at: Math.max(pr.openedAt, job.start) } });
      else if (request?.state !== 'opening') edit().set(path, { ...job, outcome: { kind: 'failure', at: Math.max(now(), job.start) } });
    }
    if (next !== null) {
      jobs = next;
      changed();
    }
  };
  update();
  const stop = subscribePrSession(update);
  return () => {
    stop();
    jobs = new Map();
    changed();
  };
}

/** A Bury with a gravedigger: the stone sinks when he stops digging, and the stake rises when he plants it. */
export function withDiggers(overrides: GraveOverride[]): GraveOverride[] {
  if (jobs.size === 0) return overrides;
  return overrides.map((o) => {
    if (o.kind !== 'buried') return o;
    const job = jobs.get(o.path);
    const sinkAt = job === undefined ? undefined : sinkAtOf(job);
    return sinkAt === undefined ? o : { ...o, startedAt: sinkAt, stakeAt: { at: STAKE_RISE_AT_S, duration: STAKE_RISE_S } };
  });
}

/** For the dev API and the browser tests: every gravedigger now, with where he stands. */
export function diggersNow(now: number = performance.now()): Array<{ path: string; phase: DiggerPhase; opacity: number; x: number; z: number; yaw: number }> {
  return [...jobs.values()].map((job) => {
    const pose = isReducedMotion() ? { phase: 'gone' as const, opacity: 0 } : diggerPose(job, now);
    return { path: job.path, phase: pose.phase, opacity: pose.opacity, x: job.spot.x, z: job.spot.z, yaw: job.spot.yaw };
  });
}
