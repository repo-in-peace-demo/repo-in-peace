import { describe, expect, it, vi } from 'vitest';
import { hasWebGL } from './webgl';

type FakeCanvas = ReturnType<NonNullable<Parameters<typeof hasWebGL>[0]>>;

/** A canvas that gives a context for the kinds listed and null for the others. */
const canvasWith = (...supported: string[]): (() => FakeCanvas) =>
  () => ({ getContext: vi.fn((kind: string) => (supported.includes(kind) ? {} : null)) }) as unknown as FakeCanvas;

describe('hasWebGL', () => {
  it('is true when WebGL 2 is available', () => {
    expect(hasWebGL(canvasWith('webgl2'))).toBe(true);
  });

  it('is true when only WebGL 1 is available', () => {
    expect(hasWebGL(canvasWith('webgl'))).toBe(true);
  });

  it('is false when neither is available', () => {
    expect(hasWebGL(canvasWith())).toBe(false);
    expect(hasWebGL(canvasWith('2d'))).toBe(false);
  });

  it('is false, and does not throw, when asking for a context throws', () => {
    const throwing = () => ({ getContext: () => { throw new Error('blocked'); } }) as unknown as FakeCanvas;
    expect(hasWebGL(throwing)).toBe(false);
  });

  it('is false, and does not throw, when there is no page to make a canvas on', () => {
    expect(hasWebGL()).toBe(false); // the tests run in Node, with no document
  });

  it('asks for WebGL 2 first and stops when it is there', () => {
    const getContext = vi.fn(() => ({}));
    hasWebGL(() => ({ getContext }) as unknown as FakeCanvas);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl2');
  });
});
