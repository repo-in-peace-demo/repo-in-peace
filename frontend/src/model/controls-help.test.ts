import { describe, expect, it } from 'vitest';
import { CONTROL_GROUPS, DOCUMENTED_CODES, FLYING_CODES } from './controls-help';
import { FLY_FAST_FACTOR } from './fly-controls';

const entries = CONTROL_GROUPS.flatMap((g) => g.entries);
const entryFor = (keys: string) => entries.find((e) => e.keys === keys);

describe('controls help', () => {
  it('documents every key the camera flies with, and both Shift keys', () => {
    for (const code of FLYING_CODES) expect(DOCUMENTED_CODES.has(code), code).toBe(true);
  });

  it('documents Home, R and Escape, and the reset also clears the selection', () => {
    for (const code of ['Home', 'KeyR', 'Escape']) expect(DOCUMENTED_CODES.has(code), code).toBe(true);
    expect(entryFor('Home or R')!.action.toLowerCase()).toContain('reset');
    expect(entryFor('Home or R')!.action.toLowerCase()).toContain('selection');
  });

  it('says what Q and E do, and which way the arrows go', () => {
    expect(entryFor('E')!.action).toBe('Fly up');
    expect(entryFor('Q')!.action).toBe('Fly down');
    expect(entryFor('D or →')!.action).toBe('Move right');
    expect(entryFor('A or ←')!.action).toBe('Move left');
    expect(entryFor('W or ↑')!.action).toBe('Move forward');
    expect(entryFor('S or ↓')!.action).toBe('Move back');
  });

  it('lists the mouse actions: drag, right-drag, scroll, hover and click, and the ? key', () => {
    for (const keys of ['Drag', 'Right-drag', 'Scroll', 'Hover', 'Click a stone or ghost', 'Click empty ground', 'Double-click a stone or ghost', 'Double-click empty space', '?', 'Shift']) {
      expect(entryFor(keys), keys).toBeDefined();
    }
    expect(entryFor('Shift')!.action).toContain(String(FLY_FAST_FACTOR));
  });

  it('has text for every entry, and no code documented twice', () => {
    expect(entries.every((e) => e.keys.trim() !== '' && e.action.trim() !== '')).toBe(true);
    const all = entries.flatMap((e) => e.codes ?? []);
    expect(new Set(all).size).toBe(all.length);
  });
});
