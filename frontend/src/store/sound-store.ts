import { useSyncExternalStore } from 'react';
import { initialSound, toggleSound, type SoundEvent, type SoundState } from '../model/sound-schedule';
import type { SoundEngine } from '../sound/engine';

/**
 * Sound on or off (sound request). Muted on every fresh visit; the choice lasts for the visit in memory, across the landing page,
 * the boot screen and the scenes. It is also written to localStorage (best effort), but never read back to unmute: sound always
 * waits for the user's own action. The audio engine is loaded and created on the first unmute, so a silent visit costs nothing.
 */
const STORAGE_KEY = 'repo-in-peace.sound';

let state: SoundState = initialSound();
let engine: SoundEngine | null = null;
let loading: Promise<SoundEngine | null> | null = null;
const listeners = new Set<() => void>();

export const getSound = (): SoundState => state;
export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const useSound = (): SoundState => useSyncExternalStore(subscribeSound, getSound, getSound);

function loadEngine(): Promise<SoundEngine | null> {
  loading ??= import('../sound/engine')
    .then(({ SoundEngine: Engine }) => {
      engine = new Engine();
      return engine;
    })
    .catch(() => null); // no Web Audio here: the button still toggles, and nothing plays
  return loading;
}

export function setSoundOn(on: boolean): void {
  if (state.on === on) return;
  state = { on };
  for (const l of [...listeners]) l();
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // storage refused (private mode, quotas): the choice still holds for the visit
  }
  if (engine) engine.setOn(on);
  else if (on) void loadEngine().then((e) => e?.setOn(state.on));
}

export const toggleSoundOn = (): void => setSoundOn(toggleSound(state).on);

/** The ghost's moan (sound/engine.ts): start, rise into the wail, or fade. Nothing when muted or before the engine is up. */
export function moan(path: string, change: 'start' | 'rise' | 'fade'): void {
  if (!engine) return;
  if (change === 'start') {
    if (state.on) engine.startMoan(path);
  } else if (change === 'rise') engine.riseMoan(path);
  else engine.fadeMoan(path);
}

/** Plays one of the scene's sounds, if sound is on and the engine is up; otherwise nothing at all. */
export function playSound(event: SoundEvent, pan = 0): void {
  if (state.on && engine) engine.play(event, pan);
}
