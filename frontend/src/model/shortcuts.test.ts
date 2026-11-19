import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLY_KEY_CODES } from './fly-controls';
import { SHORTCUT_CODES, shortcutFor, type KeyPress } from './shortcuts';

const press = (over: Partial<KeyPress>): KeyPress => ({
  code: 'KeyX',
  key: 'x',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  typing: false,
  ...over,
});

describe('shortcutFor', () => {
  it('resets the view on Home and on R', () => {
    expect(shortcutFor(press({ code: 'Home', key: 'Home' }))).toBe('reset');
    expect(shortcutFor(press({ code: 'KeyR', key: 'r' }))).toBe('reset');
    expect(shortcutFor(press({ code: 'KeyR', key: 'R' }))).toBe('reset'); // with Shift or Caps Lock
  });

  it('toggles the help on ?, whichever key makes it', () => {
    expect(shortcutFor(press({ code: 'Slash', key: '?' }))).toBe('help');
    expect(shortcutFor(press({ code: 'Digit7', key: '?' }))).toBe('help'); // another layout
  });

  it('does nothing for the flying keys, Escape, or any other key', () => {
    for (const code of [...FLY_KEY_CODES, 'ShiftLeft', 'Escape', 'Space', 'Enter', 'KeyX']) {
      expect(shortcutFor(press({ code, key: code }))).toBeUndefined();
    }
  });

  it.each(['ctrlKey', 'altKey', 'metaKey', 'repeat', 'typing'] as const)('does nothing when %s is set, so browser shortcuts and typing are left alone', (flag) => {
    expect(shortcutFor(press({ code: 'KeyR', key: 'r', [flag]: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'Home', key: 'Home', [flag]: true }))).toBeUndefined();
    expect(shortcutFor(press({ code: 'Slash', key: '?', [flag]: true }))).toBeUndefined();
  });

  it('shares no key with flying', () => {
    expect(SHORTCUT_CODES).toEqual(['Home', 'KeyR']);
    expect(SHORTCUT_CODES.some((code) => FLY_KEY_CODES.has(code))).toBe(false);
  });

  it('only ever answers for Home, R and ?', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), fc.boolean(), fc.boolean(), (code, key, ctrlKey, repeat) => {
        const answer = shortcutFor(press({ code, key, ctrlKey, repeat }));
        const wanted = code === 'Home' || code === 'KeyR' || key === '?';
        return answer === undefined || (wanted && !ctrlKey && !repeat);
      }),
      { numRuns: 300 },
    );
  });
});
