import { DIG_CYCLE_S, PAT_S, phasesOf, type DiggerJob } from './gravedigger';
import { fnv1a32 } from './hash';
import { FORM_AT_S, MOUTH_S, RISE_S, SOLID_S } from './pr-scene';
import { mulberry32 } from './prng';

/**
 * When the sounds play (sound request): pure, so the timing is tested and the same as the animations it follows. The sounds
 * themselves are made in sound/engine.ts. Times are `performance.now()` milliseconds, like the animations'.
 */

// ---- The mute state ----

export interface SoundState {
  on: boolean;
}
/** Every visit starts muted, whatever was chosen before: sound needs the user's own action, and is never a surprise. */
export const initialSound = (): SoundState => ({ on: false });
export const toggleSound = (s: SoundState): SoundState => ({ on: !s.on });

// ---- The owl ----

export const OWL_MIN_S = 25;
export const OWL_MAX_S = 60;
export const OWL_SEED = 'repo-in-peace/owl';

export interface OwlCall {
  /** Seconds after the previous call (or after sound was turned on, for the first). */
  delay: number;
  /** -1 left to 1 right: slightly to one side, never in the middle. */
  pan: number;
  /** A small change of pitch, as a ratio. */
  pitch: number;
}

/** The owl's calls, one after another: 25 to 60 s apart, each panned a little left or right. Seeded: the same seed, the same calls. */
export function owlCalls(count: number, seed: string = OWL_SEED): OwlCall[] {
  const next = mulberry32(fnv1a32(seed));
  return Array.from({ length: count }, () => {
    const delay = OWL_MIN_S + (OWL_MAX_S - OWL_MIN_S) * next();
    const side = next() < 0.5 ? -1 : 1;
    return { delay, pan: side * (0.25 + 0.4 * next()), pitch: 0.94 + 0.12 * next() };
  });
}

/** One call: "hoo-hoo… hoo", as the start (seconds) and length of each note. */
export const OWL_NOTES: ReadonlyArray<{ at: number; length: number }> = [
  { at: 0, length: 0.32 },
  { at: 0.42, length: 0.3 },
  { at: 1.35, length: 0.55 },
];

// ---- The gravedigger and the resurrection ----

export type SoundKind = 'thrust' | 'toss' | 'pat' | 'stake' | 'wail' | 'rumble' | 'thunk';
export interface SoundEvent {
  kind: SoundKind;
  /** ms */
  at: number;
  /** For a sound that lasts (the wail, the rumble): how long, in seconds. */
  length?: number;
}

/** In a dig, when the blade bites (the end of the thrust) and when the soil leaves it in the toss, as shares of the cycle. */
export const THRUST_AT = 0.33;
export const TOSS_AT = 0.74;

/**
 * Every sound of a gravedigger's job, in order: a thrust and a toss for each dig (as long as he digs, so for an open job up to
 * `until`), two pats on the mound, and the stake's knock. The shrug and the walk away are silent.
 */
export function diggerSounds(job: Pick<DiggerJob, 'start' | 'outcome'>, until: number): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (const span of phasesOf(job)) {
    if (span.phase === 'dig') {
      const end = Math.min(span.to, until);
      const cycle = DIG_CYCLE_S * 1000;
      for (let t = span.from; t < end; t += cycle) {
        if (t + THRUST_AT * cycle < end) out.push({ kind: 'thrust', at: t + THRUST_AT * cycle });
        if (t + TOSS_AT * cycle < end) out.push({ kind: 'toss', at: t + TOSS_AT * cycle });
      }
    } else if (span.phase === 'pat') {
      // The two pats land at the bottom of each beat (diggerPose: sin of the beat, at a quarter and three quarters of the phase).
      for (const share of [0.25, 0.75]) out.push({ kind: 'pat', at: span.from + PAT_S * 1000 * share });
    } else if (span.phase === 'stake') {
      out.push({ kind: 'stake', at: (span.from + span.to) / 2 });
    }
  }
  return out;
}

/**
 * The resurrection's sounds, from when the pull request opened (`riseFrame`'s start): a wail from the mouth opening to the end of
 * the rise, rising and fading with the ghost; a rumble as the stone forms; the thunk as it stands.
 */
export function riseSounds(startedAt: number): SoundEvent[] {
  return [
    { kind: 'wail', at: startedAt, length: MOUTH_S + RISE_S },
    { kind: 'rumble', at: startedAt + FORM_AT_S * 1000, length: SOLID_S },
    { kind: 'thunk', at: startedAt + (FORM_AT_S + SOLID_S) * 1000 },
  ];
}

/** The events due in (from, to]: what a frame plays. Events more than `stale` ms old are dropped (after the tab was hidden). */
export const dueBetween = (events: readonly SoundEvent[], from: number, to: number, stale = 500): SoundEvent[] =>
  events.filter((e) => e.at > from && e.at <= to && to - e.at <= stale);

// ---- The ghost's moan while its Resurrect request runs ----

/** The moan swells in with the shiver (`ghostWait`'s ramp), fades over this long on a failure, and hands over to the wail this fast. */
export const MOAN_IN_S = 0.3;
export const MOAN_FADE_S = 1;
export const MOAN_TO_WAIL_S = 0.25;

export type MoanChange = { path: string; change: 'start' | 'rise' | 'fade' };

/**
 * What changes for the ghosts' moans between two frames. `moaning` is the ghosts moaning now; `waiting` the ghosts whose Resurrect
 * request runs; `opened` the ghosts with a pull request. A ghost that starts waiting starts to moan; one that stops waiting rises into
 * the wail if its pull request opened, and fades out otherwise (an error, or the page gave up).
 */
export function moanChanges(moaning: ReadonlySet<string>, waiting: ReadonlySet<string>, opened: ReadonlySet<string>): MoanChange[] {
  const out: MoanChange[] = [];
  for (const path of waiting) if (!moaning.has(path)) out.push({ path, change: 'start' });
  for (const path of moaning) if (!waiting.has(path)) out.push({ path, change: opened.has(path) ? 'rise' : 'fade' });
  return out;
}
