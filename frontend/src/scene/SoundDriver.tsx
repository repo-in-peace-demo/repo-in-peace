import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { diggerSounds, dueBetween, riseSounds } from '../model/sound-schedule';
import type { SceneModel } from '../model/scene-model';
import { getSound, playSound } from '../store/sound-store';
import { isReducedMotion } from './animation-clock';
import { getDiggerJobs } from './gravedigger-state';
import { currentOverrides } from './pr-overrides';

/**
 * Plays the scene's sounds as its animations reach them (sound request): the gravedigger's shovel (model/sound-schedule.ts,
 * `diggerSounds`, from the same timeline he moves by) and the resurrection (`riseSounds`, from `riseFrame`'s start). Each frame plays
 * what fell due since the last one. Nothing under reduced motion (the change is instant and silent), and nothing while muted.
 */
export function SoundDriver({ model }: { model: SceneModel }) {
  const last = useRef(performance.now());
  useFrame(() => {
    const now = performance.now();
    const from = last.current;
    last.current = now;
    if (!getSound().on || isReducedMotion()) return;
    for (const job of getDiggerJobs().values()) for (const e of dueBetween(diggerSounds(job, now), from, now)) playSound(e);
    for (const o of currentOverrides(model)) {
      if (o.kind !== 'risen') continue;
      for (const e of dueBetween(riseSounds(o.startedAt), from, now)) playSound(e);
    }
  });
  return null;
}
