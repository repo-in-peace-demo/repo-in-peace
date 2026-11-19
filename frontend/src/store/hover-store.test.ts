import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHover, getHover, getPointer, setHover, setPointer, subscribeHover, subscribePointer } from './hover-store';

const unsubscribers: Array<() => void> = [];
const listenHover = (listener: () => void) => {
  const off = subscribeHover(listener);
  unsubscribers.push(off);
  return off;
};
const listenPointer = (listener: () => void) => {
  const off = subscribePointer(listener);
  unsubscribers.push(off);
  return off;
};

beforeEach(() => clearHover());
afterEach(() => {
  for (const off of unsubscribers.splice(0)) off();
  vi.restoreAllMocks();
});

describe('the hover target', () => {
  it('starts as nothing, and holds a file or a ghost once set', () => {
    expect(getHover()).toBeNull();
    setHover({ kind: 'file', path: 'a.ts' });
    expect(getHover()).toEqual({ kind: 'file', path: 'a.ts' });
    setHover({ kind: 'ghost', path: 'b.ts' });
    expect(getHover()).toEqual({ kind: 'ghost', path: 'b.ts' });
    clearHover();
    expect(getHover()).toBeNull();
  });

  it('tells listeners about each change, and about nothing when the target is the same', () => {
    const listener = vi.fn();
    listenHover(listener);
    setHover({ kind: 'file', path: 'a.ts' });
    setHover({ kind: 'file', path: 'a.ts' });
    expect(listener).toHaveBeenCalledTimes(1);
    clearHover();
    clearHover();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('gives the same object until the target changes, and keeps its own frozen copy', () => {
    const given = { kind: 'file' as const, path: 'a.ts' };
    setHover(given);
    const held = getHover();
    setHover({ kind: 'file', path: 'a.ts' });
    expect(getHover()).toBe(held);
    given.path = 'changed.ts';
    expect(getHover()).toEqual({ kind: 'file', path: 'a.ts' });
    expect(Object.isFrozen(getHover())).toBe(true);
  });

  it('stops telling a listener once it unsubscribes, and survives one that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    const off = listenHover(good);
    listenHover(() => {
      throw new Error('broken');
    });
    setHover({ kind: 'file', path: 'a.ts' });
    expect(good).toHaveBeenCalledTimes(1);
    off();
    setHover({ kind: 'file', path: 'b.ts' });
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('the pointer position', () => {
  it('holds the last position and tells its own listeners, not the target listeners', () => {
    const onPointer = vi.fn();
    const onTarget = vi.fn();
    listenPointer(onPointer);
    listenHover(onTarget);
    setPointer(10, 20);
    setPointer(30, 40);
    expect(getPointer()).toEqual({ x: 30, y: 40 });
    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onTarget).not.toHaveBeenCalled();
  });
});
