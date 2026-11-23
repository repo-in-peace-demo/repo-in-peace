import { describe, expect, it } from 'vitest';
import { sceneCursor } from './scene-cursor';

describe('sceneCursor', () => {
  it('grabs while dragging, glows over a stone or ghost, and points otherwise', () => {
    expect(sceneCursor(true, true)).toBe('grab');
    expect(sceneCursor(true, false)).toBe('grab');
    expect(sceneCursor(false, true)).toBe('over');
    expect(sceneCursor(false, false)).toBe('point');
  });
});
