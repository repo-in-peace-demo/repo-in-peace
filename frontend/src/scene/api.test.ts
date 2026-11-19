import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFlyTargets, flyToPose, type CameraPose } from '../model/camera-pose';
import { layout } from '../model/layout';
import { graveyardFrom } from '../../test/make-graveyard';
import { flyTo, registerScene } from './api';

const g = graveyardFrom({ files: ['src/a.ts', 'src/b.ts', 'x.ts'], ghosts: ['src/gone.ts'] });
const targets = buildFlyTargets(layout(g));

// The registration is one shared value, so every test removes what it registered.
const unregister: Array<() => void> = [];
const register = (fly: (to: CameraPose) => void = () => {}) => {
  const remove = registerScene({ targets, fly });
  unregister.push(remove);
  return remove;
};
afterEach(() => {
  for (const remove of unregister.splice(0)) remove();
});

describe('flyTo', () => {
  it('does nothing, and says so, before a scene is on the screen', () => {
    expect(flyTo('src/a.ts')).toBe(false);
  });

  it('starts a flight to the pose for the path, and says so', () => {
    const fly = vi.fn();
    register(fly);
    expect(flyTo('src/a.ts')).toBe(true);
    expect(fly).toHaveBeenCalledTimes(1);
    expect(fly).toHaveBeenCalledWith(flyToPose(targets, 'src/a.ts'));
  });

  it('can fly to a ghost as well as a file', () => {
    const fly = vi.fn();
    register(fly);
    expect(flyTo('src/gone.ts')).toBe(true);
    expect(fly).toHaveBeenCalledWith(flyToPose(targets, 'src/gone.ts'));
  });

  it('does nothing for a path that is neither a file nor a ghost, and for a folder', () => {
    const fly = vi.fn();
    register(fly);
    expect(flyTo('nope.ts')).toBe(false);
    expect(flyTo('src')).toBe(false);
    expect(flyTo('')).toBe(false);
    expect(fly).not.toHaveBeenCalled();
  });

  it('can fly to every file and ghost of the scene', () => {
    const fly = vi.fn();
    register(fly);
    for (const path of targets.keys()) expect(flyTo(path)).toBe(true);
    expect(fly).toHaveBeenCalledTimes(targets.size);
  });

  it('does nothing once the scene has gone', () => {
    const fly = vi.fn();
    const remove = register(fly);
    remove();
    expect(flyTo('src/a.ts')).toBe(false);
    expect(fly).not.toHaveBeenCalled();
  });

  it('talks to the newest scene, and an older scene going away late does not remove it', () => {
    const oldFly = vi.fn();
    const newFly = vi.fn();
    const removeOld = register(oldFly);
    register(newFly);
    removeOld();
    expect(flyTo('x.ts')).toBe(true);
    expect(newFly).toHaveBeenCalledTimes(1);
    expect(oldFly).not.toHaveBeenCalled();
  });

  it('can have the same scene removed twice without harm', () => {
    const remove = register();
    remove();
    expect(() => remove()).not.toThrow();
  });
});
