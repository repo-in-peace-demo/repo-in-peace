import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { diggerSounds, dueBetween, moanChanges, riseSounds } from '../model/sound-schedule';
import type { SceneModel } from '../model/scene-model';
import { getSound, moan, playSound } from '../store/sound-store';
import { getPrSession } from '../store/pr-store';
import { isReducedMotion } from './animation-clock';
import { getDiggerJobs } from './gravedigger-state';
import { currentOverrides } from './pr-overrides';

/**
 * Plays the scene's sounds as its animations reach them (sound request): the gravedigger's shovel (model/sound-schedule.ts,
 * `diggerSounds`, from the same timeline he moves by), the ghost's moan while its Resurrect request runs (rising into the wail on
 * success, fading on failure), and the resurrection (`riseSounds`, from `riseFrame`'s start). Each frame plays
 * what fell due since the last one. Nothing under reduced motion (the change is instant and silent), and nothing while muted.
 */
export function SoundDriver({ model }: { model: SceneModel }) {
  const last = useRef(performance.now());
  // The ghosts moaning now, while their Resurrect request runs (model/sound-schedule.ts, `moanChanges`).
  const moaning = useRef(new Set<string>());
  useEffect(() => () => {
    for (const path of moaning.current) moan(path, 'fade');
    moaning.current.clear();
  }, []);
  useFrame(() => {
    const now = performance.now();
    const from = last.current;
    last.current = now;
    if (!getSound().on || isReducedMotion()) {
      for (const path of moaning.current) moan(path, 'fade');
      moaning.current.clear();
      return;
    }
    const { requests, prs } = getPrSession();
    const waiting = new Set<string>();
    for (const [key, r] of requests) {
      const path = key.slice('ghost:'.length);
      if (key.startsWith('ghost:') && r.state === 'opening' && model.lookup.get(path)?.kind === 'ghost') waiting.add(path);
    }
    const opened = new Set<string>();
    for (const [key, pr] of prs) if (key.startsWith('ghost:') && !pr.found) opened.add(key.slice('ghost:'.length));
    for (const c of moanChanges(moaning.current, waiting, opened)) {
      moan(c.path, c.change);
      if (c.change === 'start') moaning.current.add(c.path);
      else moaning.current.delete(c.path);
    }
    for (const job of getDiggerJobs().values()) for (const e of dueBetween(diggerSounds(job, now), from, now)) playSound(e);
    for (const o of currentOverrides(model)) {
      if (o.kind !== 'risen') continue;
      for (const e of dueBetween(riseSounds(o.startedAt), from, now)) playSound(e);
    }
  });
  return null;
}
